import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ChannelConfigVault } from '../notifications/channel-config.vault';
import { ChannelConfigResealer } from '../notifications/channel-config.resealer';

/**
 * Seals, at start, the channel configurations an earlier version wrote in plaintext.
 *
 * Idempotent and cheap once done (a scan of the table that finds nothing to do), so
 * it runs on every start rather than being a step somebody has to remember. It never
 * stops the server from starting: a failure is logged, and the channels it did not
 * reach still work, because plaintext opens as it is.
 */
@Injectable()
export class ChannelConfigBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChannelConfigBackfill.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: ChannelConfigVault,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const counts = await new ChannelConfigResealer(this.prisma, this.vault).run();
      if (counts.sealed > 0) this.logger.log(`Sealed the configuration of ${counts.sealed} channel(s)`);
      if (counts.failed > 0) {
        this.logger.warn(`${counts.failed} channel configuration(s) could not be opened: see above`);
      }
    } catch (error) {
      this.logger.error(`Could not seal the channel configurations: ${(error as Error).message}`);
    }
  }
}
