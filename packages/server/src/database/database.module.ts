import { Global, Module } from '@nestjs/common';
import { PgListenerService } from './pg-listener.service';
import { PgService } from './pg.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, PgService, PgListenerService],
  exports: [PrismaService, PgService, PgListenerService],
})
export class DatabaseModule {}
