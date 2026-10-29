import { Test } from '@nestjs/testing';
import type { Alert } from '../alert';
import { SafeHttpService } from '../safe-http.service';
import { DiscordSender, escapeSlack, SlackSender, TeamsSender } from './chat.senders';

function alert(name: string): Alert {
  return {
    kind: 'down',
    project: { id: 'p1', name: 'Billing' },
    check: {
      id: 'c1',
      name,
      state: 'DOWN',
      environment: 'production',
      tags: [],
      lastPingAt: null,
      nextDueAt: null,
      graceSeconds: 300,
      scheduleType: 'interval',
      periodSeconds: 3600,
      cronExpression: null,
      timezone: 'UTC',
    },
    incident: { id: 'i1', startedAt: new Date('2026-07-30T02:05:00Z'), resolvedAt: null, cause: 'missed' },
    url: 'https://silencewatch.com/checks/c1',
  } as Alert;
}

/** What a sender posted, as the receiving service would parse it. */
async function posted(sender: (http: SafeHttpService) => SlackSender | DiscordSender, name: string) {
  let body = '';
  const http = {
    send: (request: { body: string }) => {
      body = request.body;
      return Promise.resolve({ status: 200, body: '' });
    },
  } as unknown as SafeHttpService;
  await sender(http).send(alert(name), { url: 'https://hooks.example.test/x' });
  return JSON.parse(body) as Record<string, unknown>;
}

describe('chat senders', () => {
  it('escape what Slack would read as a mention or a link', () => {
    expect(escapeSlack('<!channel> & <https://evil.example|click>')).toBe(
      '&lt;!channel&gt; &amp; &lt;https://evil.example|click&gt;',
    );
  });

  it('never let a check name notify a whole Slack channel', async () => {
    const payload = await posted((http) => new SlackSender(http), 'Backup <!channel>');
    const text = JSON.stringify(payload);
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('tell Discord to notify nobody, whatever the text says', async () => {
    const payload = await posted((http) => new DiscordSender(http), '@everyone backup');
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  // Built by Nest, as in the application: a sender constructed by hand would
  // pass whether or not dependency injection can build it.
  it.each([SlackSender, TeamsSender, DiscordSender])('%p is built with its HTTP client, and sends', async (Sender) => {
    const sent: string[] = [];
    const http = { send: (request: { url: string }) => (sent.push(request.url), Promise.resolve({ status: 200, body: '' })) };
    const moduleRef = await Test.createTestingModule({
      providers: [Sender, { provide: SafeHttpService, useValue: http }],
    }).compile();

    await moduleRef.get(Sender).send(alert('Backup'), { url: 'https://hooks.example.test/x' });
    expect(sent).toEqual(['https://hooks.example.test/x']);
  });
});
