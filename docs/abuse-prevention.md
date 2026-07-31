# Keeping bot sign-ups out

This answers one question — *what actually stops a script from creating ten
thousand accounts?* — and it answers it in the order the defences are worth
having, not the order they are usually reached for.

Everything here is **off by default**. A self-hosted SilenceWatch behind a VPN,
or one with `SIGNUP_ENABLED=false` after the team is in, has no bot problem and
should not be made to solve one.

## The short answer

There is no single control. What works is making an account **cost** something,
in a currency a bot cannot mint:

| Currency | Control | Cost to a bot | Cost to a real person |
| --- | --- | --- | --- |
| CPU | Proof of work | 100× the common case; not a wall | ~0.2 s, once, invisible |
| A real mailbox | Email verification | A readable inbox per account | One click |
| Time | Per-network velocity | A hard ceiling per hour | Nothing |
| Money | Payment on signup | Fatal | Fatal to your funnel too |

Layer the first three. The fourth is a business decision, not a security one.

If you only take one thing: **the ceiling is the velocity rule, the floor is
verification, and proof of work is what keeps both from being tested.** Deployed
alone, none of the three is enough.

## What does *not* work, and why it is what everyone tries first

**Per-IP rate limiting.** This is the reflex, and it is the weakest link in the
list. Residential proxy pools sell traffic by the gigabyte, with millions of
addresses across real consumer ISPs; a registration request is a few kilobytes.
An attacker who has decided to flood you is paying pennies to make your per-IP
counter meaningless, while the same counter is busy blocking the twelve people
behind one corporate NAT. Keep it — it is the floor, and it stops the lazy
attempt — but do not mistake it for the answer.

SilenceWatch aggregates to a **network prefix** (IPv4 /24, IPv6 /48) rather than
an address for exactly this reason. Rotating addresses within a rented range is
free; renting many ranges is not.

**Blocking disposable email domains.** Useful, and permanently out of date.
There are thousands of these services and new ones weekly, so a list shipped in
a release is stale on arrival. It is here because the head of the distribution
is short and the check costs one Set lookup — not because it holds.

**Blocking free providers (Gmail, Outlook, Proton).** Do not. That is where most
of your legitimate users are. Choosing to lose customers to avoid a nuisance is
a bad trade, so the built-in list deliberately excludes them.

**A CAPTCHA.** Effective against unsophisticated bots, and genuinely the right
answer for some products. It is not the default here because it costs a
third-party script, a hole in a `default-src 'self'` CSP, a privacy story you
now owe your users, and — with solver farms charging under a dollar per thousand
— it stops automation rather than a determined attacker. If you want one, see
"Adding a CAPTCHA" below; nothing in the design fights you.

## What SilenceWatch implements

### 1. Proof of work (`SIGNUP_POW_DIFFICULTY`)

Before registering, the client asks `GET /api/auth/signup-challenge` for a
challenge and must find a nonce such that `SHA-256("<challenge>.<nonce>")`
starts with N zero bits. The browser does it in a worker; the server verifies
with one hash.

The asymmetry is the point: verification is a single hash, the search is `2^N`
of them.

**Be clear-eyed about the size of that asymmetry.** The numbers below are
measured, not assumed — browser figures from Chromium running the shipped
solver, attacker figures from `openssl speed sha256` at this input size on the
same machine:

| Difficulty | Expected hashes | Browser (340 k h/s) | Optimised CPU core (2 M h/s) | Accounts/hour/core |
| --- | --- | --- | --- | --- |
| 0 | — | off | off | unlimited |
| 14 | 16 384 | 0.05 s | 0.008 s | ~450 000 |
| 16 | 65 536 | 0.19 s | 0.03 s | ~110 000 |
| 18 | 262 144 | 0.77 s | 0.13 s | ~27 000 |
| 20 | 1 048 576 | 3.1 s | 0.52 s | ~7 000 |

**Recommended: 16.** It costs a laptop a fifth of a second and a mid-range phone
around a second. Eighteen is defensible if your users are on desktops; twenty
charges a five-year-old Android several seconds to sign up, which loses you real
users to inconvenience an attacker who can rent more cores.

Read that last column honestly: at any difficulty a browser will tolerate,
someone with native code and a few cores can still make thousands of accounts an
hour, and a GPU implementation is three orders of magnitude beyond that again.
**Proof of work does not stop a determined attacker.** What it does is destroy
the economics of the common case — replaying a form POST in a loop, or driving a
headless browser farm — by a factor of a hundred or more, and force anyone who
wants past it to write and maintain real code. The hard ceiling on volume is the
velocity rule; the hard requirement of owning a mailbox is verification. Proof of
work is the layer that makes those two rarely get tested.

One implementation note that is easy to get wrong: the solver hashes with a
synchronous SHA-256 rather than `crypto.subtle.digest`. Awaiting a promise per
attempt caps Chromium at about **64 000** hashes per second against 340 000 for
the synchronous routine — the async API, not the hash, is the bottleneck. Built
on WebCrypto, difficulty 16 would cost an honest user a full second instead of a
fifth of one, and the whole table above would have to shift down by two bits.

Three more properties separate this from a decorative implementation:

- **Challenges are stateless.** Issuing one costs no storage and no database
  round trip. An issuing endpoint that allocated per request would be a cheaper
  target than the one it protects.
- **A challenge is bound to the caller's network prefix**, inside the HMAC.
  Solving them cheaply in bulk on one host and spending the answers through a
  proxy pool does not work — the solution is only valid from the prefix it was
  issued to.
- **Single use, within limits.** Spent challenges are tracked in memory, so a
  multi-instance deployment allows at most one reuse per instance and a restart
  forgets what it had seen. This is a deliberate trade against a database write
  on an unauthenticated endpoint; the durable ceiling lives in the velocity
  rule, which counts *accepted* sign-ups and therefore survives both.

### 2. Email verification (`EMAIL_VERIFICATION_REQUIRED`)

An account cannot sign in until its address answers. Every account a bot creates
now needs a mailbox it can read.

Turning it on also makes registration **enumeration-safe**: the API answers
`{"status":"verification_sent"}` whether the address was new, already
registered, or already registered and verified. The truth is delivered to the
inbox — the only party entitled to it — and an existing owner gets a "someone
tried to sign up with your address" notice, which turns a probe into something
they can see.

Details that matter more than they look:

- The emailed link is a **GET into the SPA**; the state change is a **POST** the
  page makes. Corporate mail scanners and link previewers fetch every URL in an
  inbound message, and a single-use token behind a GET is spent before the
  recipient opens the mail — with a failure that looks exactly like an attack.
- Only the SHA-256 of the token is stored.
- Issuing a new token invalidates the previous ones. "Resend" must not leave a
  widening set of live credentials in a widening set of inboxes.
- Unverified accounts are **deleted** after `UNVERIFIED_ACCOUNT_TTL_DAYS`. Left
  alone they hold real addresses hostage against the unique index, so a flood
  you blocked would still deny those people an account later.

### 3. Per-network velocity (`SIGNUP_MAX_PER_NETWORK_PER_HOUR`)

Accounts accepted per hour from one prefix, **counted in PostgreSQL**.

The in-memory rate limiter is per-instance and dies with the process, which
makes every deploy a free window and every extra replica a doubled budget. This
rule is the one that holds across both. Only *accepted* sign-ups count: letting
failures consume the budget would let anyone lock out a shared corporate NAT by
failing on purpose.

Start at 20/hour. Legitimate traffic almost never approaches it; a flood hits it
in seconds.

## Choosing your settings

```bash
# Self-hosted, private network — none of it applies
SIGNUP_ENABLED=false     # after the team is in: the strongest control there is
```

That deserves its own sentence. **For a self-hosted instance, the best protection
against bot sign-ups is not having open sign-up.** Bootstrap the first account,
invite the rest, set `SIGNUP_ENABLED=false`, and none of the machinery above is
load-bearing.

If your sign-up form is reachable by strangers, turn on all three layers rather
than picking one — that is the whole argument of this document. Start from the
recommendations in each section above, then watch the `signup_attempt` table and
adjust. Deliberately not printed here: the settings any particular deployment
ended up on. A working configuration is operational detail about a specific
target, and this file is public.

## Watching it work

The `signup_attempt` table is the record. Rejected attempts are stored too, so a
flood is visible as data rather than only as a log line:

```sql
SELECT date_trunc('hour', created_at) AS hour,
       count(*) FILTER (WHERE accepted)     AS accepted,
       count(*) FILTER (WHERE NOT accepted) AS rejected,
       count(DISTINCT network)              AS networks
  FROM signup_attempt
 GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
```

A healthy hour is a handful of accepted sign-ups across a handful of networks. A
flood is hundreds of rejections across dozens — and if you see hundreds
*accepted*, raise the difficulty and lower the ceiling — in that order.

Rows older than seven days are purged with the rest of retention.

## Adding a CAPTCHA

If the layers above are not enough — you are being targeted specifically, or
somebody is paying humans — a challenge from Cloudflare Turnstile or hCaptcha is
the next step, and it is a deployment concern rather than a code change:

1. Terminate it at your reverse proxy in front of `/api/auth/register`, so the
   CSP of the application is untouched and self-hosters inherit nothing.
2. Or add a verification call in `SignupGuardService`, next to the existing
   rules, and extend the CSP with the vendor's origins.

Keep proof of work either way. It costs nothing to keep, it needs no third
party, and it is the only layer that still works when the vendor is down.

## What none of this is

None of this protects against a **compromised account**, a **credential
stuffing** run against existing users (that is `AUTH_RATE_LIMIT_PER_MINUTE`,
Argon2id and the per-account lockout), or someone abusing a legitimate account.
It answers one question: how expensive is it to create accounts you did not
want. [`security.md`](security.md) covers the threat model as a whole.
