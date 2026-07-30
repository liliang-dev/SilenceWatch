import { Module } from '@nestjs/common';
import { CheckMetadataCache } from './check-metadata.cache';
import { IngestService } from './ingest.service';

@Module({
  providers: [IngestService, CheckMetadataCache],
  exports: [IngestService, CheckMetadataCache],
})
export class IngestModule {}
