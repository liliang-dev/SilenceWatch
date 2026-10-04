import { Module } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';

/** Who may touch which project. Imported by every module that serves project data. */
@Module({
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class AccessModule {}
