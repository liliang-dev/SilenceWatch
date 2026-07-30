import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { AppConfig, CONFIG } from '../config/config';

export const CHECK_CHANGED_CHANNEL = 'silencewatch_check_changed';

type NotificationHandler = (payload: string) => void;

/**
 * A single long-lived connection dedicated to `LISTEN`. It lets one instance
 * tell the others to drop a cached check without introducing a message broker:
 * PostgreSQL is already there, and every added component would be one more
 * thing to monitor.
 *
 * The connection reconnects with backoff; while it is down, caches simply fall
 * back to their TTL, so a lost notification costs staleness, never correctness.
 */
@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgListenerService.name);
  private readonly handlers = new Map<string, Set<NotificationHandler>>();
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 1_000;
  private stopped = false;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Registers a handler. Callable at any point in the lifecycle: subscribers
   * that arrive after the connection is up (module init order is not guaranteed)
   * get their LISTEN issued immediately.
   */
  subscribe(channel: string, handler: NotificationHandler): void {
    const existing = this.handlers.get(channel);
    if (existing !== undefined) {
      existing.add(handler);
      return;
    }

    this.handlers.set(channel, new Set([handler]));
    const client = this.client;
    if (client === null) return;

    // Channel names are module constants, never user input.
    void client.query(`LISTEN "${channel}"`).catch((error: Error) => {
      this.logger.warn(`LISTEN ${channel} failed: ${error.message}`);
      this.scheduleReconnect();
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const client = new Client({
      connectionString: this.config.DATABASE_URL,
      application_name: 'silencewatch-listener',
    });
    client.on('error', (error) => {
      this.logger.warn(`Listener connection error: ${error.message}`);
      this.scheduleReconnect();
    });
    client.on('notification', (message) => {
      if (!message.payload) return;
      for (const handler of this.handlers.get(message.channel) ?? []) {
        try {
          handler(message.payload);
        } catch (error) {
          this.logger.warn(`Notification handler failed: ${(error as Error).message}`);
        }
      }
    });

    try {
      await client.connect();
      for (const channel of this.handlers.keys()) {
        // Channel names come from this module only, never from user input.
        await client.query(`LISTEN "${channel}"`);
      }
      this.client = client;
      this.reconnectDelayMs = 1_000;
      this.logger.log(`Listening on ${[...this.handlers.keys()].join(', ') || '(no channel)'}`);
    } catch (error) {
      this.logger.warn(`Listener connection failed: ${(error as Error).message}`);
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const client = this.client;
    this.client = null;
    void client?.end().catch(() => undefined);

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
