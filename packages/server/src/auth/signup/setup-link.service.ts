import { Inject, Injectable } from '@nestjs/common';
import { randomToken, sha256Hex } from '../../common/crypto.util';
import { AppConfig, CONFIG } from '../../config/config';
import { PrismaService } from '../../database/prisma.service';

/** How long a setup link works. Short: it is an invitation printed in a log. */
const SETUP_LINK_TTL_MS = 30 * 60_000;

const identifierOf = (token: string): string => `setup:${sha256Hex(token)}`;

/**
 * The one-time link that lets a given address create an account when sign-up is
 * otherwise closed.
 *
 * Two uses, one mechanism. The first account of an instance has no one to invite
 * it, and nothing proves the address it claims is its owner's: no mail is sent. The
 * link, printed in the server log or by the command line, stands in for that proof,
 * because only whoever runs the server can read it. And an instance that has closed
 * sign-up (SIGNUP_ENABLED=false) opens it for one more person the same way.
 *
 * The token is high-entropy and stored only as its SHA-256. It rides in the URL
 * fragment, which a browser never sends, so it reaches neither an access log nor a
 * `Referer` header.
 */
@Injectable()
export class SetupLinkService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async issue(email: string): Promise<{ url: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_MS);
    await this.prisma.verification.create({
      data: { identifier: identifierOf(token), value: email.toLowerCase(), expiresAt },
    });
    const query = new URLSearchParams({ email: email.toLowerCase() });
    return { url: `${this.config.baseUrl}/setup?${query.toString()}#${token}`, expiresAt };
  }

  /** Whether the token is live and was issued for this address. Does not spend it. */
  async accepts(token: string | null, email: string): Promise<boolean> {
    if (token === null || token === '') return false;
    const row = await this.prisma.verification.findFirst({
      where: { identifier: identifierOf(token), expiresAt: { gt: new Date() } },
    });
    return row !== null && row.value === email.toLowerCase();
  }

  /** Spends the token. Idempotent: a second call finds nothing to spend. */
  async spend(token: string): Promise<void> {
    await this.prisma.verification.deleteMany({ where: { identifier: identifierOf(token) } });
  }

  /** Expired links, and the passkey challenges Better Auth leaves in the same table. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.verification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }
}
