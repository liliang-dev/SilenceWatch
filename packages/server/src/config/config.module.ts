import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config';

/**
 * Configuration is validated once, frozen, and injected everywhere through the
 * CONFIG token — no `process.env` reads scattered across the codebase, and no
 * chance of a typo silently disabling a safeguard.
 */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
