import { Module } from '@nestjs/common';
import { QuotasModule } from '../quotas/quotas.module';
import { IngestModule } from '../ingest/ingest.module';
import { CheckSyncService } from './check-sync.service';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';

@Module({
  // For CheckMetadataCache: a check edited through the API must stop being served
  // from the ingestion cache immediately.
  imports: [QuotasModule, IngestModule],
  controllers: [ChecksController],
  providers: [ChecksService, CheckSyncService],
  exports: [ChecksService],
})
export class ChecksModule {}
