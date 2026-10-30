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
| An identity | Google or Microsoft sign-in (`AUTH_MODE=full`) | An account at a provider, which has its own defences | One tap |
| Time | Per-network velocity | A hard ceiling per hour | Nothing |
| Place | One account per connection | A new connection per account | Nothing, unless they share one |
| Money | Payment on signup | Fatal | Fatal to your funnel too |

Layer the first three. The fourth is a business decision, not a security one.

**What changed with the sign-in rewrite.** SilenceWatch used to ask for a proof of
work in the browser and for an address that answered a confirmation email. Both are
gone: the second needed a mail service for sign-in to work at all, and neither stops
a determined attacker. In their place, an account made through Google or Microsoft
carries an address the provider has verified and an identity that is not free to
make — which is a stronger version of what the confirmation email was for. An account
made with a passkey or a password carries an address nothing has proven, so there
the ceiling and the connection limits are what hold. If strangers can reach your
sign-up form, `AUTH_MODE=full` is the posture that costs a bot the most.

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

### 1. Per-network velocity (`SIGNUP_MAX_PER_NETWORK_PER_HOUR`)

Accounts accepted per hour from one prefix, **counted in PostgreSQL**.

The in-memory rate limiter is per-instance and dies with the process, which
makes every deploy a free window and every extra replica a doubled budget. This
rule is the one that holds across both. Only *accepted* sign-ups count: letting
failures consume the budget would let anyone lock out a shared corporate NAT by
failing on purpose.

Start at 20/hour. Legitimate traffic almost never approaches it; a flood hits it
in seconds.

### 2. One account per connection (`SIGNUP_MAX_ACCOUNTS_PER_ADDRESS`)

The velocity rule limits how fast accounts appear. This one limits how many exist
at once from one connection (an IPv4 address, an IPv6 /64), which is what stops a
free plan from being multiplied by registering again.

It counts the accounts that **exist**, whatever way they sign in: one that is deleted
frees its place. Nothing here waits for an address to be proven, because none is —
an account counts from the moment it is made.

What is stored is a keyed hash of the address, never the address: the column can
be compared and cannot be read back, and a copy of the database does not let
anyone test a guess without the server's secret. Accounts created before the rule
carry nothing and are not counted.

**Be careful what it costs.** Everyone behind one address shares the budget: an
office, a school, a household, a mobile carrier. Set to 1, the second person at a
company cannot register from its network and has to be told to contact you. It is
a decision about who you are willing to turn away, not a free control; the hourly
rule above is the gentler version.

### 3. Throwaway addresses (`SIGNUP_BLOCK_DISPOSABLE_EMAIL`, `SIGNUP_BLOCKED_EMAIL_DOMAINS`)

A short list of known throwaway mailbox domains, plus any you add. It is the
cheapest control here and permanently out of date, as said above; it is useful mostly
because it removes the laziest way to make a fresh account for every limit you reach.

The **administrator's account** skips all three: it is created with its setup link
(see [`authentication.md`](authentication.md#the-administrator-account)), which is
you saying that this person may join.

## Once the account exists

The limits above decide who gets in. What a free account can then cost
is bounded separately, and each bound is a setting or a fixed ceiling:

- **Emails to an address of the account's choosing.** A test alert is limited per
  channel (`TEST_ALERT_COOLDOWN_SECONDS`) and per account
  (`TEST_ALERT_MAX_PER_HOUR`); the real alerts of a channel by
  `ALERT_MAX_PER_CHANNEL_PER_HOUR`. SilenceWatch sends no other email: sign-in
  needs none.
- **Rows.** History and resolved incidents are purged with the retention of the
  plan; a project holds at most 25 live API keys (a revoked key is deleted after
  30 days); an account keeps its 20 newest sessions signed in.
- **What one heartbeat can write.** `PING_RATE_LIMIT_PER_MINUTE` and
  `PING_BODY_MAX_BYTES` bound each check; their defaults suit a trusted team, and
  a deployment for strangers will want them lower.

Not covered: an email channel is not confirmed by its recipient, so the limits
above are what stands between it and somebody else's mailbox.

## Choosing your settings

```bash
# Self-hosted, private network — none of it applies
SIGNUP_ENABLED=false     # after the team is in: the strongest control there is
```

That deserves its own sentence. **For a self-hosted instance, the best protection
against bot sign-ups is not having open sign-up.** Create the administrator account
with its link, let the rest of the team sign up, set `SIGNUP_ENABLED=false`, and none
of the machinery above is load-bearing.

If your sign-up form is reachable by strangers, use `AUTH_MODE=full`, turn on the
per-network and per-connection limits, and watch the `signup_attempt` table: layers,
not one. Start from the recommendations in each section above, then adjust.
Deliberately not printed here: the settings any particular deployment ended up on. A
working configuration is operational detail about a specific target, and this file is
public.

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
*accepted*, lower the ceiling.

Rows older than seven days are purged with the rest of retention.

## Adding a CAPTCHA

If the layers above are not enough — you are being targeted specifically, or
somebody is paying humans — a challenge from Cloudflare Turnstile or hCaptcha is
the next step, and it is a deployment concern rather than a code change:

1. Terminate it at your reverse proxy in front of the sign-up endpoints
   (`/api/auth/sign-up/email`, `/api/auth/passkey/*`), so the CSP of the application
   is untouched and self-hosters inherit nothing.
2. Or add a verification call in `SignupPolicyService`, next to the existing rules,
   and extend the CSP with the vendor's origins.

## What none of this is

None of this protects against a **compromised account**, a **credential
stuffing** run against existing users (that is `AUTH_RATE_LIMIT_PER_MINUTE` and the
per-account lockout, and passkeys have nothing to stuff), or someone abusing a
legitimate account.
It answers one question: how expensive is it to create accounts you did not
want. [`security.md`](security.md) covers the threat model as a whole.
