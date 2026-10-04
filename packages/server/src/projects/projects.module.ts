import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { QuotasModule } from '../quotas/quotas.module';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AccessModule, ApiKeysModule, QuotasModule],
  controllers: [ProjectsController],
  providers: [ProjectsRepository, ProjectsService],
  exports: [ProjectsService, ProjectsRepository],
})
export class ProjectsModule {}
