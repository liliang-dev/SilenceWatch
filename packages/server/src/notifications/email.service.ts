import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { AppConfig, CONFIG } from '../config/config';
import { SafeHttpService } from './safe-http.service';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Transactional email.
 *
 * Self-hosted SMTP is not offered on purpose: alerts that land in a spam folder
 * are worse than no alerts, and reputation is not something a monitoring server
 * can build on the side. The `smtp` provider relays through whatever the
 * operator already trusts; `postmark` and `brevo` talk to providers that do it
 * for a living.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  /** Created on first use: an unused provider costs no connection. */
  private smtpTransport: Transporter | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly http: SafeHttpService,
  ) {}

  async send(email: OutboundEmail): Promise<void> {
    switch (this.config.EMAIL_PROVIDER) {
      case 'postmark':
        await this.sendWithPostmark(email);
        return;
      case 'brevo':
        await this.sendWithBrevo(email);
        return;
      case 'smtp':
        await this.sendWithSmtp(email);
        return;
      case 'console':
        // Development only — configuration refuses this provider in production.
        this.logger.log(`[email:console] to=${email.to} subject=${email.subject}\n${email.text}`);
        return;
    }
  }

  private get from(): string {
    return `${this.config.EMAIL_FROM_NAME} <${this.config.EMAIL_FROM}>`;
  }

  private async sendWithPostmark(email: OutboundEmail): Promise<void> {
    await this.http.send({
      url: 'https://api.postmarkapp.com/email',
      headers: {
        'x-postmark-server-token': this.config.POSTMARK_TOKEN as string,
        accept: 'application/json',
      },
      body: JSON.stringify({
        From: this.from,
        To: email.to,
        Subject: email.subject,
        TextBody: email.text,
        HtmlBody: email.html,
        MessageStream: this.config.POSTMARK_MESSAGE_STREAM,
      }),
    });
  }

  private async sendWithBrevo(email: OutboundEmail): Promise<void> {
    await this.http.send({
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: {
        'api-key': this.config.BREVO_API_KEY as string,
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: this.config.EMAIL_FROM, name: this.config.EMAIL_FROM_NAME },
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      }),
    });
  }

  private async sendWithSmtp(email: OutboundEmail): Promise<void> {
    const transport = await this.getSmtpTransport();
    await transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }

  private async getSmtpTransport(): Promise<Transporter> {
    if (this.smtpTransport !== null) return this.smtpTransport;

    // Imported lazily so deployments using an HTTP provider never load it.
    const { createTransport } = await import('nodemailer');
    this.smtpTransport = createTransport({
      ...parseSmtpUrl(this.config.SMTP_URL as string),
      pool: true,
      maxConnections: 2,
      connectionTimeout: this.config.NOTIFICATION_TIMEOUT_MS,
      greetingTimeout: this.config.NOTIFICATION_TIMEOUT_MS,
      socketTimeout: this.config.NOTIFICATION_TIMEOUT_MS * 2,
    });
    return this.smtpTransport;
  }
}

interface SmtpConnection {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  requireTLS: boolean;
}

/**
 * `smtp://user:pass@host:587` / `smtps://…` is what operators already have in
 * their notes, so that is what the server accepts. Parsing it explicitly (rather
 * than handing the string to nodemailer) makes the TLS decision visible: implicit
 * TLS on 465, STARTTLS required otherwise.
 */
export function parseSmtpUrl(rawUrl: string): SmtpConnection {
  const url = new URL(rawUrl);
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
    throw new Error(`SMTP_URL must use smtp:// or smtps:// (got ${url.protocol})`);
  }

  const secure = url.protocol === 'smtps:';
  const port = url.port === '' ? (secure ? 465 : 587) : Number(url.port);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);

  return {
    host: url.hostname,
    port,
    secure,
    // Refuse to fall back to a plaintext session on a submission port.
    requireTLS: !secure,
    ...(user === '' ? {} : { auth: { user, pass } }),
  };
}
