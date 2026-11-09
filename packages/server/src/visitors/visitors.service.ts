import { Inject, Injectable, Logger } from '@nestjs/common';
import { addressOf } from '../auth/signup/network';
import { deriveKey, hmacSha256Hex } from '../common/crypto.util';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';

/**
 * Crawlers, link previews, uptime probes and scripts: they load the page without
 * anyone reading it. Most never run the script that reports a visit; this catches
 * the ones that do and say what they are.
 */
const NOT_A_VISITOR =
  /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|java\/|okhttp|go-http|httpclient|headless|lighthouse|pagespeed|facebookexternalhit|embedly|quora link/i;

/**
 * Counts the people who open the web application, once per day each, for the
 * administrator's statistics.
 *
 * Nothing is kept that names a visitor: no cookie is set, and the address is never
 * stored. What is stored is a keyed hash of the connection's address (an IPv4
 * address, an IPv6 /64), the browser's user agent and the day. The key comes from
 * SECRET_KEY, so a copy of the database cannot be used to test a guess, and the day
 * is part of what is hashed, so the same person on two days is two unrelated rows:
 * a count per day, not a trail.
 */
@Injectable()
export class VisitorsService {
  private readonly logger = new Logger(VisitorsService.name);
  private readonly key: Buffer;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.key = deriveKey(config.SECRET_KEY, 'app-visitors');
  }

  /** Records one visit. Never throws: a lost count is not worth a failed page. */
  async record(ip: string | null | undefined, userAgent: string | undefined): Promise<void> {
    const agent = (userAgent ?? '').trim();
    if (agent === '' || NOT_A_VISITOR.test(agent)) return;

    const day = new Date().toISOString().slice(0, 10);
    const visitor = hmacSha256Hex(this.key, `${day}|${addressOf(ip)}|${agent.slice(0, 512)}`).slice(0, 32);

    await this.prisma.$executeRaw`
      INSERT INTO app_visitor (day, visitor)
      VALUES (${day}::date, ${visitor})
      ON CONFLICT (day, visitor) DO NOTHING`.catch((error: unknown) =>
      this.logger.warn(`Could not record a visit: ${String(error)}`),
    );
  }
}
