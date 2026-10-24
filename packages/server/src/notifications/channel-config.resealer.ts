import { Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ChannelConfigError, ChannelConfigVault } from './channel-config.vault';

export interface ResealCounts {
  /** Plaintext, now sealed. */
  sealed: number;
  /** Sealed with another key, now sealed with this one. */
  resealed: number;
  /** Already sealed with this key. */
  unchanged: number;
  /** Could not be opened with either key: left alone. */
  failed: number;
}

const BATCH = 200;

/**
 * Brings every channel configuration under the current key.
 *
 * Run by the server at start, for configurations written before sealing existed, and
 * by `silencewatch reseal` after SECRET_KEY has changed. Idempotent, and safe with
 * several instances: a row is only written if it is still as it was read.
 */
export class ChannelConfigResealer {
  private readonly logger = new Logger('ChannelConfigVault');

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: ChannelConfigVault,
    /** The key SECRET_KEY had before, when it has been changed. */
    private readonly previous?: ChannelConfigVault,
  ) {}

  async run(): Promise<ResealCounts> {
    const counts: ResealCounts = { sealed: 0, resealed: 0, unchanged: 0, failed: 0 };
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; config: unknown }>>`
        SELECT id::text AS id, config FROM notification_channel
         WHERE id > ${after}::uuid ORDER BY id LIMIT ${BATCH}`;
      if (rows.length === 0) return counts;
      for (const row of rows) await this.one(row, counts);
      after = (rows[rows.length - 1] as { id: string }).id;
    }
  }

  private async one(row: { id: string; config: unknown }, counts: ResealCounts): Promise<void> {
    let config: unknown;
    let outcome: 'sealed' | 'resealed';
    if (!this.vault.isSealed(row.config)) {
      config = row.config;
      outcome = 'sealed';
    } else {
      try {
        this.vault.open(row.id, row.config);
        counts.unchanged += 1;
        return;
      } catch (error) {
        if (!(error instanceof ChannelConfigError) || this.previous === undefined) {
          counts.failed += 1;
          this.logger.error(`Channel ${row.id}: ${(error as Error).message}`);
          return;
        }
      }
      try {
        config = (this.previous as ChannelConfigVault).open(row.id, row.config);
        outcome = 'resealed';
      } catch (error) {
        counts.failed += 1;
        this.logger.error(`Channel ${row.id}: ${(error as Error).message}`);
        return;
      }
    }

    const sealed = JSON.stringify(this.vault.seal(row.id, config));
    // Only if the row is still as it was read: another instance may have got there first.
    const written = await this.prisma.$executeRaw`
      UPDATE notification_channel SET config = ${sealed}::jsonb
       WHERE id = ${row.id}::uuid AND config = ${JSON.stringify(row.config)}::jsonb`;
    if (written > 0) counts[outcome] += 1;
  }
}
