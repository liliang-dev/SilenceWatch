import { escapeHtml } from '../../notifications/templates';

export function resetText(link: string, ttlMinutes: number): string {
  return [
    'Somebody asked to reset the password on your SilenceWatch account.',
    '',
    link,
    '',
    `The link is valid for ${ttlMinutes} minutes and can be used once.`,
    'If it was not you, ignore this message — your password has not changed and',
    'nothing has been done to your account.',
  ].join('\n');
}

export function resetHtml(link: string, ttlMinutes: number): string {
  const href = escapeHtml(link);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Reset your password</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      Somebody asked to reset the password on your SilenceWatch account.
    </p>
    <p style="margin:0 0 20px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#8b4bf1;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Choose a new password</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#667085">
      Or paste this into your browser:<br>
      <span style="word-break:break-all;color:#8b4bf1">${href}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#98a2b3">
      Valid for ${ttlMinutes} minutes, usable once. If it was not you, ignore this message — your
      password has not changed and nothing has been done to your account.
    </p>
  </div>
</body></html>`;
}
