import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { QuotasModule } from '../quotas/quotas.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AccessModule, ApiKeysModule, QuotasModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
