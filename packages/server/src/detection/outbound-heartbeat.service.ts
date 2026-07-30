import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { IntervalRunner } from '../common/interval-runner';
import { AppConfig, CONFIG } from '../config/config';
import { DetectionService } from './detection.service';

/**
 * SilenceWatch cannot watch itself.
 *
 * A monitoring server that dies quietly is the one outage there is no recovering
 * from commercially, so this sends a heartbeat *to a third party* — and only
 * while the detection loop is provably alive. If detection stalls, the heartbeat
 * stops, and the external dead man's switch raises the alarm.
 *
 * The URL comes from the environment (trusted operator configuration), which is
 * why it bypasses the SSRF guard applied to user-supplied webhook URLs: pointing
 * it at an internal uptime endpoint is a legitimate deployment.
 */
@Injectable()
export class OutboundHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboundHeartbeatService.name);
  private readonly runner: IntervalRunner;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly detection: DetectionService,
    schedulerRegistry: SchedulerRegistry,
  ) {
    this.runner = new IntervalRunner(
      'outbound-heartbeat',
      config.OUTBOUND_HEARTBEAT_INTERVAL_MS,
      () => this.beat(),
      schedulerRegistry,
    );
  }

  onApplicationBootstrap(): void {
    if (this.config.OUTBOUND_HEARTBEAT_URL === undefined) {
      this.logger.warn(
        'OUTBOUND_HEARTBEAT_URL is not set: nothing is watching this instance. ' +
          'See docs/deployment.md — a dead detection loop would go unnoticed.',
      );
      return;
    }
    this.runner.start();
  }

  onModuleDestroy(): void {
    this.runner.stop();
  }

  private async beat(): Promise<void> {
    const url = this.config.OUTBOUND_HEARTBEAT_URL;
    if (url === undefined) return;

    const health = this.detection.health();
    const staleAfterMs = this.config.DETECTION_INTERVAL_MS * 3;
    const lastSuccess = health.lastSuccessAt === null ? null : Date.parse(health.lastSuccessAt);

    if (lastSuccess === null || Date.now() - lastSuccess > staleAfterMs) {
      this.logger.error(
        'Detection loop has not completed a tick recently — withholding the outbound ' +
          'heartbeat so the external watchdog fires',
      );
      return;
    }

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
      headers: { 'user-agent': 'SilenceWatch/1.0 (self-monitoring)' },
    });
    if (!response.ok) {
      throw new Error(`outbound heartbeat returned HTTP ${response.status}`);
    }
  }
}
