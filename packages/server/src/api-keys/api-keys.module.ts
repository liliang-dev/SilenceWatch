import { Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeysRepository } from './api-keys.repository';

@Module({
  providers: [ApiKeysRepository, ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeysModule {}
