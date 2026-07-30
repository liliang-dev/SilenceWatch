import { Inject, Injectable, Logger } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIPv4, isIPv6, type LookupFunction } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { AppConfig, CONFIG } from '../config/config';

/**
 * Outbound HTTP for user-supplied URLs (webhooks, chat integrations).
 *
 * A monitoring product that POSTs wherever it is told is an SSRF gateway into
 * the network it is deployed in. Two properties are enforced here:
 *
 *  1. Addresses are vetted *inside the DNS lookup used for the connection*, so
 *     a name that resolves to a public address on the first query and to
 *     169.254.169.254 on the second (DNS rebinding) cannot slip through.
 *  2. Redirects are never followed — a 302 to an internal host is the oldest
 *     trick in the book.
 *
 * Self-hosters whose alert targets legitimately live on a private network set
 * ALLOW_PRIVATE_NOTIFICATION_TARGETS=true and opt out of (1).
 */
@Injectable()
export class SafeHttpService {
  private readonly logger = new Logger(SafeHttpService.name);
  private readonly blocked = buildBlockList();

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Sends a request and returns the status code. Non-2xx responses throw, so
   * callers can let the delivery queue retry.
   */
  async send(options: {
    url: string;
    method?: 'POST' | 'PUT' | 'GET';
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<{ status: number; body: string }> {
    const url = new URL(options.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`unsupported protocol ${url.protocol}`);
    }
    if (url.username !== '' || url.password !== '') {
      throw new Error('URLs with embedded credentials are rejected');
    }

    const method = options.method ?? 'POST';
    const body = options.body;
    const timeoutMs = options.timeoutMs ?? this.config.NOTIFICATION_TIMEOUT_MS;
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const request = transport(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === '' ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method,
          lookup: this.guardedLookup,
          headers: {
            'user-agent': 'SilenceWatch/1.0 (+https://silencewatch.com)',
            accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
            ...(body === undefined
              ? {}
              : {
                  'content-type': options.contentType ?? 'application/json',
                  'content-length': Buffer.byteLength(body),
                }),
            ...options.headers,
          },
          timeout: timeoutMs,
        },
        (response) => {
          const status = response.statusCode ?? 0;

          // Never follow redirects: the destination has not been vetted.
          if (status >= 300 && status < 400) {
            response.destroy();
            reject(new Error(`redirect (${status}) not followed`));
            return;
          }

          // Read a bounded prefix for error reporting, discard the rest.
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            if (size < 2_048) {
              chunks.push(chunk);
              size += chunk.length;
            }
          });
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8').slice(0, 2_048);
            if (status >= 200 && status < 300) resolve({ status, body: text });
            else reject(new Error(`HTTP ${status}${text.length > 0 ? `: ${firstLine(text)}` : ''}`));
          });
          response.on('error', reject);
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error(`timed out after ${timeoutMs}ms`));
      });
      request.on('error', reject);
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  /**
   * DNS resolution with address vetting. Bound as a property so it can be
   * handed to Node's http client as the `lookup` option.
   */
  private readonly guardedLookup: LookupFunction = (hostname, options, callback): void => {
    const wantsAll = options.all === true;

    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, '', undefined);
        return;
      }

      const allowed = addresses.filter((entry) => this.isAllowedAddress(entry.address));
      if (allowed.length === 0) {
        this.logger.warn(`Refusing to contact ${hostname}: resolves only to blocked addresses`);
        callback(
          Object.assign(new Error(`${hostname} resolves to a blocked address range`), {
            code: 'EACCES',
          }),
          '',
          undefined,
        );
        return;
      }

      if (wantsAll) {
        callback(null, allowed);
        return;
      }
      const first = allowed[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };

  /**
   * Preflight used when a channel is created. Throws for what will *never* work
   * — a bad URL, a wrong scheme, an address inside a blocked range — and merely
   * warns when the name does not resolve: DNS at creation time is not a reliable
   * oracle (split-horizon resolvers, hosts provisioned later), and the "send a
   * test alert" button gives a better answer than a guess made here.
   */
  async assertTargetIsAllowed(rawUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('not a valid URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('only http(s) URLs are supported');
    }
    if (url.username !== '' || url.password !== '') {
      throw new Error('URLs with embedded credentials are rejected');
    }

    const addresses = await lookupAll(url.hostname).catch(() => null);
    if (addresses === null) {
      this.logger.warn(`Channel target ${url.hostname} does not resolve yet`);
      return;
    }
    if (!addresses.some((entry) => this.isAllowedAddress(entry.address))) {
      throw new Error(
        `${url.hostname} resolves to a private or reserved address; set ` +
          'ALLOW_PRIVATE_NOTIFICATION_TARGETS=true if this is intentional',
      );
    }
  }

  /** Exposed for tests and for the webhook creation preflight. */
  isAllowedAddress(address: string): boolean {
    if (this.config.ALLOW_PRIVATE_NOTIFICATION_TARGETS) return true;

    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const candidate = mapped?.[1] ?? address;

    if (isIPv4(candidate)) return !this.blocked.check(candidate, 'ipv4');
    if (isIPv6(candidate)) return !this.blocked.check(candidate, 'ipv6');
    return false;
  }
}

/**
 * Everything that is not a routable public address. Cloud metadata endpoints sit
 * in 169.254.0.0/16, which is why link-local matters most here.
 */
function buildBlockList(): BlockList {
  const list = new BlockList();

  list.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
  list.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC 1918
  list.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
  list.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
  list.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + cloud metadata
  list.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC 1918
  list.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
  list.addSubnet('192.0.2.0', 24, 'ipv4'); // TEST-NET-1
  list.addSubnet('192.88.99.0', 24, 'ipv4'); // 6to4 relay anycast
  list.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC 1918
  list.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
  list.addSubnet('198.51.100.0', 24, 'ipv4'); // TEST-NET-2
  list.addSubnet('203.0.113.0', 24, 'ipv4'); // TEST-NET-3
  list.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
  list.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved

  list.addAddress('::', 'ipv6'); // unspecified
  list.addAddress('::1', 'ipv6'); // loopback
  list.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64
  list.addSubnet('100::', 64, 'ipv6'); // discard-only
  list.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
  list.addSubnet('fc00::', 7, 'ipv6'); // unique local
  list.addSubnet('fe80::', 10, 'ipv6'); // link-local
  list.addSubnet('ff00::', 8, 'ipv6'); // multicast

  return list;
}

function lookupAll(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
