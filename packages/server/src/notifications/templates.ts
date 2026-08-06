import {
  Alert,
  describeSchedule,
  downtimeSeconds,
  formatDuration,
  formatInstant,
} from './alert';

/**
 * Message rendering shared by every channel.
 *
 * An alert is read at 3am by someone who has just been woken up: it says which
 * job, in which environment, since when, and what to click. Nothing else.
 */

export interface RenderedAlert {
  subject: string;
  /** Single line summary, used by chat channels. */
  headline: string;
  text: string;
  html: string;
  fields: Array<{ label: string; value: string }>;
}

export function renderAlert(alert: Alert): RenderedAlert {
  const { check, project, incident, kind } = alert;
  const scope = check.environment === null ? project.name : `${project.name} / ${check.environment}`;
  const outage = formatDuration(downtimeSeconds(incident));

  const subject =
    kind === 'down'
      ? `[SilenceWatch] DOWN — ${check.name} (${scope})`
      : `[SilenceWatch] UP — ${check.name} recovered (${scope})`;

  const headline =
    kind === 'down'
      ? `${check.name} stopped checking in (${scope})`
      : `${check.name} is checking in again after ${outage} (${scope})`;

  const fields: Array<{ label: string; value: string }> = [
    { label: 'Check', value: check.name },
    { label: 'Project', value: project.name },
    { label: 'Environment', value: check.environment ?? '—' },
    { label: 'Schedule', value: describeSchedule(check) },
    { label: 'Grace period', value: formatDuration(check.graceSeconds) },
    { label: 'Last ping', value: formatInstant(check.lastPingAt) },
    { label: 'Expected by', value: formatInstant(check.nextDueAt) },
    {
      label: kind === 'down' ? 'Silent since' : 'Was down for',
      value: kind === 'down' ? formatInstant(incident.startedAt) : outage,
    },
  ];
  if (check.tags.length > 0) fields.push({ label: 'Tags', value: check.tags.join(', ') });
  if (kind === 'down' && incident.cause === 'reported') {
    fields.push({ label: 'Cause', value: 'the job reported a failure' });
  }

  const text = [
    headline,
    '',
    ...fields.map((field) => `${field.label}: ${field.value}`),
    '',
    alert.url,
  ].join('\n');

  return { subject, headline, text, html: renderHtml(alert, headline, fields), fields };
}

function renderHtml(
  alert: Alert,
  headline: string,
  fields: Array<{ label: string; value: string }>,
): string {
  const accent = alert.kind === 'down' ? '#b3261e' : '#146c2e';
  const badge = alert.kind === 'down' ? 'DOWN' : 'RECOVERED';

  const rows = fields
    .map(
      (field) => `
        <tr>
          <td style="padding:6px 16px 6px 0;color:#5f6368;font-size:13px;white-space:nowrap">${escapeHtml(field.label)}</td>
          <td style="padding:6px 0;color:#202124;font-size:13px">${escapeHtml(field.value)}</td>
        </tr>`,
    )
    .join('');

  // Inline styles and a table layout: email clients are not browsers.
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e0e0e0">
    <tr><td style="padding:24px">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${accent};color:#fff;font-size:11px;font-weight:700;letter-spacing:.6px">${badge}</span>
      <h1 style="margin:16px 0 4px;font-size:18px;line-height:1.35;color:#202124">${escapeHtml(headline)}</h1>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;width:100%">${rows}</table>
      <a href="${escapeAttribute(alert.url)}" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#8b4bf1;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Open check</a>
      <p style="margin:20px 0 0;color:#80868b;font-size:12px;line-height:1.5">
        You are receiving this because a SilenceWatch notification channel for
        ${escapeHtml(alert.project.name)} points at this address.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Check names, tags and cron expressions are user input and end up in HTML mail.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] as string);
}

function escapeAttribute(value: string): string {
  // Only our own BASE_URL-derived links reach this, but a URL is still an
  // attribute value: keep quotes and angle brackets out of it.
  return escapeHtml(value);
}
