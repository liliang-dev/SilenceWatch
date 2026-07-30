import { Global, Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ProjectAccessService } from './project-access.service';
import { TokenService } from './token.service';

/**
 * Global because authorisation is not a feature: every project-scoped module
 * needs ProjectAccessService, and the guard is registered application-wide.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, ApiKeyService, ProjectAccessService, AuthGuard],
  exports: [AuthService, TokenService, ApiKeyService, ProjectAccessService],
})
export class AuthModule {}
