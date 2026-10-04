import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { QuotasModule } from '../quotas/quotas.module';
import { IngestModule } from '../ingest/ingest.module';
import { CheckSyncRepository } from './check-sync.repository';
import { CheckSyncService } from './check-sync.service';
import { ChecksController } from './checks.controller';
import { ChecksRepository } from './checks.repository';
import { ChecksService } from './checks.service';

@Module({
  // For CheckMetadataCache: a check edited through the API must stop being served
  // from the ingestion cache immediately.
  imports: [AccessModule, QuotasModule, IngestModule],
  controllers: [ChecksController],
  providers: [ChecksRepository, ChecksService, CheckSyncRepository, CheckSyncService],
  exports: [ChecksService],
})
export class ChecksModule {}
