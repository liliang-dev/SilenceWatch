import { escapeHtml } from '../../../notifications/templates';

export function verificationText(link: string, ttlHours: number): string {
  return [
    'Confirm your email address to finish setting up your SilenceWatch account.',
    '',
    link,
    '',
    `The link is valid for ${ttlHours} hours and can be used once.`,
    'If you did not create an account, ignore this message — nothing was activated.',
  ].join('\n');
}

export function verificationHtml(link: string, ttlHours: number): string {
  const href = escapeHtml(link);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Confirm your email address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      One click and your SilenceWatch account is ready.
    </p>
    <p style="margin:0 0 20px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#8b4bf1;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Confirm my address</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#667085">
      Or paste this into your browser:<br>
      <span style="word-break:break-all;color:#8b4bf1">${href}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#98a2b3">
      Valid for ${ttlHours} hours, usable once. If you did not create an account, ignore this message — nothing was activated.
    </p>
  </div>
</body></html>`;
}

export function alreadyRegisteredText(signInUrl: string): string {
  return [
    'Someone just tried to create a SilenceWatch account with this address.',
    'You already have one, so nothing changed and no second account was created.',
    '',
    `Sign in: ${signInUrl}`,
    '',
    'If that was you, sign in instead. If it was not, you can ignore this —',
    'nobody learned anything about your account. Consider changing your',
    'password if you reused it elsewhere.',
  ].join('\n');
}

export function alreadyRegisteredHtml(signInUrl: string): string {
  const href = escapeHtml(signInUrl);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Someone tried to sign up with your address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      You already have a SilenceWatch account with this address, so nothing changed and no second
      account was created.
    </p>
    <p style="margin:0 0 20px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#8b4bf1;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Sign in</a>
    </p>
    <p style="margin:0;font-size:12px;color:#98a2b3">
      If this was not you, you can ignore this message — nobody learned anything about your account.
      Change your password if you reused it elsewhere.
    </p>
  </div>
</body></html>`;
}
