import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { deriveKey, hmacSha256Hex } from '../../common/crypto.util';
import { AppConfig, CONFIG } from '../../config/config';
import { PrismaService } from '../../database/prisma.service';

/** How many codes an account holds at once. */
export const RECOVERY_CODE_COUNT = 8;

/** Crockford's alphabet: no I, L, O or U, so a code read off paper cannot be misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 3;
const GROUP_LENGTH = 4;

/** `ABCD-EFGH-JKMN`: 60 bits, which is out of reach at the rate sign-in allows. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    let text = '';
    for (let index = 0; index < GROUP_LENGTH; index += 1) {
      text += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(text);
  }
  return groups.join('-');
}

/** Case, dashes and spaces are for the eye; the letters that look alike are the same character. */
export function normaliseRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/**
 * The codes that get an account back in when every passkey is gone.
 *
 * Single-use and shown once: the database holds a keyed hash of each, so reading
 * it yields nothing that signs anyone in. A code is spent by a conditional update,
 * so two requests carrying the same code cannot both succeed.
 */
@Injectable()
export class RecoveryCodesService {
  private readonly key: Buffer;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.key = deriveKey(config.SECRET_KEY, 'recovery-codes');
  }

  /** Replaces whatever the account held with a fresh set, and returns it. The only time it is readable. */
  async replaceAll(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: this.hash(code) })),
      }),
    ]);
    return codes;
  }

  /** Spends a code for this account. True exactly once per code. */
  async spend(userId: string, code: string): Promise<boolean> {
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash: this.hash(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  /** How many codes are still good, which is all the settings page needs to say. */
  remaining(userId: string): Promise<number> {
    return this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
  }

  private hash(code: string): string {
    return hmacSha256Hex(this.key, normaliseRecoveryCode(code));
  }
}
