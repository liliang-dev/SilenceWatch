import { Module } from '@nestjs/common';
import { ProjectAccessRepository } from './project-access.repository';
import { ProjectAccessService } from './project-access.service';

/** Who may touch which project. Imported by every module that serves project data. */
@Module({
  providers: [ProjectAccessRepository, ProjectAccessService],
  exports: [ProjectAccessService],
})
export class AccessModule {}
