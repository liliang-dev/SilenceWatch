import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';

/**
 * Just enough of a browser to hold cookies between requests and say where each one
 * came from. Sign-in is a conversation (a challenge is set in a cookie and has to
 * come back), and a test that threads cookies by hand reads like a protocol
 * dump instead of what it checks.
 */
export class Browser {
  readonly jar = new Map<string, string>();

  constructor(
    private readonly app: NestFastifyApplication,
    readonly origin: string,
  ) {}

  async send(
    method: 'GET' | 'POST',
    url: string,
    options: { payload?: unknown; headers?: Record<string, string>; remoteAddress?: string } = {},
  ): Promise<LightMyRequestResponse> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await this.app.inject({
      method,
      url,
      headers: {
        origin: this.origin,
        ...(cookie === '' ? {} : { cookie }),
        ...options.headers,
      },
      ...(options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress }),
      ...(options.payload === undefined ? {} : { payload: options.payload as never }),
    });
    this.remember(response.headers['set-cookie']);
    return response;
  }

  /** Cookies a server sets are kept; a cookie it expires is dropped. */
  private remember(setCookie: string | string[] | undefined): void {
    for (const line of [setCookie ?? []].flat()) {
      const [pair = '', ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired =
        value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  get signedIn(): boolean {
    return this.jar.has('sw.session_token');
  }

  /** Forgets the session, as a browser does when its cookie is deleted. */
  forgetSession(): void {
    this.jar.delete('sw.session_token');
    this.jar.delete('sw.session_data');
  }
}
