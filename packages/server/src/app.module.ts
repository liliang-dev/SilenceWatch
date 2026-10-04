import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AccessModule } from './access/access.module';
import { AuthGuard } from './access/auth.guard';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './auth/sessions/sessions.module';
import { ChannelsModule } from './channels/channels.module';
import { ChecksModule } from './checks/checks.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RateLimitGuard } from './common/rate-limit.guard';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DetectionModule } from './detection/detection.module';
import { HealthModule } from './health/health.module';
import { IngestModule } from './ingest/ingest.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { AuditModule } from './audit/audit.module';
import { QuotasModule } from './quotas/quotas.module';
import { RetentionModule } from './retention/retention.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
    AuditModule,
    AccessModule,
    ApiKeysModule,
    SessionsModule,
    AuthModule,
    IngestModule,
    NotificationsModule,
    DetectionModule,
    ChecksModule,
    ProjectsModule,
    ChannelsModule,
    QuotasModule,
    RetentionModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limiting runs before authentication, so an unauthenticated
    // flood is rejected without touching Argon2 or the database.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
