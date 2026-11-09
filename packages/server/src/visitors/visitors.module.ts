import { Module } from '@nestjs/common';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';

/** The count of unique visitors of the web application, for the administrator. */
@Module({
  controllers: [VisitorsController],
  providers: [VisitorsService],
})
export class VisitorsModule {}
