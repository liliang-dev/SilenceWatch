import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * A software passkey: enough of an authenticator to take part in the two WebAuthn
 * ceremonies, so the tests exercise the real verification of the real library and
 * not a stand-in for it.
 *
 * It makes "none" attestations with ES256, which is what a browser sends by default,
 * and signs assertions the way a platform authenticator does. Nothing here is a
 * shortcut around the server: every byte it sends is checked by @simplewebauthn.
 */
export class VirtualAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicJwk = { x: jwk.x as string, y: jwk.y as string };
  }

  get id(): string {
    return this.credentialId.toString('base64url');
  }

  /** The browser's answer to `navigator.credentials.create()` for these options. */
  register(options: { challenge: string; rp: { id: string } }, origin: string): Record<string, unknown> {
    const clientData = this.clientData('webauthn.create', options.challenge, origin);
    const authData = Buffer.concat([
      sha256(options.rp.id),
      Buffer.from([0x45]), // user present, user verified, attested credential data
      uint32(this.counter),
      Buffer.alloc(16), // AAGUID: none
      uint16(this.credentialId.length),
      this.credentialId,
      this.coseKey(),
    ]);
    const attestationObject = cbor(new Map<unknown, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** The browser's answer to `navigator.credentials.get()` for these options. */
  assert(options: { challenge: string; rpId: string }, origin: string, tamper = false): Record<string, unknown> {
    this.counter += 1;
    const clientData = this.clientData('webauthn.get', options.challenge, origin);
    const authData = Buffer.concat([sha256(options.rpId), Buffer.from([0x05]), uint32(this.counter)]);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    if (tamper) signature[signature.length - 1] = (signature[signature.length - 1] as number) ^ 0xff;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: randomBytes(16).toString('base64url'),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private coseKey(): Buffer {
    return cbor(new Map<unknown, unknown>([
      [1, 2], // key type: EC2
      [3, -7], // algorithm: ES256
      [-1, 1], // curve: P-256
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]));
  }
}

const sha256 = (value: string | Buffer): Buffer => createHash('sha256').update(value).digest();

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/** The corner of CBOR a WebAuthn response uses: maps, byte and text strings, small integers. */
function cbor(value: unknown): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([
      head(5, value.size),
      ...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry)]),
    ]);
  }
  throw new Error(`cannot encode ${typeof value}`);
}

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
}
