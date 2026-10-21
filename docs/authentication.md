# Authentication

How people sign in to SilenceWatch, what each way costs you to run, and what to do
when someone is locked out.

Sign-in is [Better Auth](https://www.better-auth.com), configured by one setting,
`AUTH_MODE`. The mode decides which methods **exist**: the ones it does not name
have no endpoint at all, not a disabled one. API keys and heartbeat URLs are a
separate system and are not affected by anything on this page.

- [Choosing a mode](#choosing-a-mode)
- [Settings](#settings)
- [Passkeys](#passkeys-auth_modepasskey) · [Passwords](#passwords-auth_modepassword) · [Passkeys, Google and Microsoft](#passkeys-google-and-microsoft-auth_modefull)
- [The first account](#the-first-account)
- [Sessions and sensitive actions](#sessions-and-sensitive-actions)
- [When someone is locked out](#when-someone-is-locked-out)
- [Changing the mode later](#changing-the-mode-later)
- [Testing by hand](#testing-by-hand)
- [What is not here](#what-is-not-here)

## Choosing a mode

| `AUTH_MODE` | People sign in with | Pick it when |
| --- | --- | --- |
| `passkey` (default) | A passkey: fingerprint, face or device PIN. Recovery codes if every passkey is lost | Anyone can reach the instance and you want nothing to phish or leak |
| `password` | An email address and a password (12 characters at least) | A private instance where passkeys are more than the team wants to learn |
| `full` | Google, Microsoft, or a passkey added after the first sign-in | The people already have Google or Microsoft accounts, and you would rather not hold a credential for them |

Any other value stops the server at startup and lists the valid ones:

```
Invalid SilenceWatch configuration:
  - AUTH_MODE: "both" is not a sign-in mode. Valid values: passkey, password, full
```

There is no mix beyond what the table says: no passkey on top of a password, no
Google beside a password. Fewer methods is less to attack, and less to explain to
the person who is locked out.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTH_MODE` | `passkey` | `passkey`, `password` or `full` |
| `BASE_URL` | `http://localhost:8080` | What your users type. Must be `https://` in `passkey` and `full` unless it is `localhost` |
| `SECRET_KEY` | — | Signs session cookies. Rotating it signs everyone out |
| `SIGNUP_ENABLED` | `true` | When false, only someone holding a [setup link](#the-first-account) can create an account |
| `ADMIN_EMAIL` | — | The address of the first account. See [the first account](#the-first-account) |
| `AUTH_RP_ID` | host of `BASE_URL` | The domain passkeys are bound to. Decide once: see below |
| `AUTH_RP_NAME` | `SilenceWatch` | The name the browser shows when asking for a passkey |
| `AUTH_TRUSTED_ORIGINS` | — | Extra browser origins that may sign in (a development server, say), comma-separated |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Google sign-in (`AUTH_MODE=full`). The button shows only when both are set |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | — | Microsoft sign-in, same rule. `full` needs at least one provider |
| `MICROSOFT_TENANT_ID` | `common` | `common` accepts work, school and personal accounts; a tenant id restricts sign-in to that organisation |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `10` | Sign-in attempts per minute from one address, per endpoint |

The server **refuses to start** when this cannot work, rather than starting and
turning every sign-in away:

- `passkey` or `full` with a `BASE_URL` that is neither `https://` nor `localhost` —
  browsers refuse passkeys on any other origin;
- an `AUTH_RP_ID` that is not the host of `BASE_URL` or a parent domain of it
  (`example.com` is fine for `watch.example.com`; `other.com` is not), or that is a
  bare top-level domain;
- an `AUTH_TRUSTED_ORIGINS` entry outside that domain, not `https://`, or not an
  origin at all (a path is not an origin);
- `full` without all four provider credentials.

**Decide `AUTH_RP_ID` once.** A passkey belongs to a domain: change it and every
passkey made before stops working, with no way to move them. If you might move the
instance to another subdomain later, set `AUTH_RP_ID` to the parent domain now.

## Passkeys (`AUTH_MODE=passkey`)

**Creating an account** takes an email address and a passkey. There is no password
to choose, no email to confirm: the address is a label, nothing is sent to it. The
account is created only once the browser has produced a passkey that verifies.
Straight afterwards the page shows **eight recovery codes**, once.

**Signing in** is one button; the browser offers the passkeys it has for this site.

**Recovery codes** are for the day every device holding a passkey is gone. Each
works once. Only a keyed hash is stored, so reading the database yields nothing that
signs anyone in. Signing in with one asks you to make a new passkey on the device in
your hand. **Settings → Sign-in** says how many are left and makes a new set (which
replaces the old one, and needs a sign-in from the last ten minutes).

**Several passkeys** per account is the normal case: add one per device in
**Settings → Sign-in**, so that losing one never matters. The last one cannot be
removed from the page.

A passkey needs the page to be on the domain it was made for, in a secure context.
Behind a reverse proxy, `BASE_URL` has to be the address people type — not the
address of the container.

## Passwords (`AUTH_MODE=password`)

At least 12 characters, no composition rules (length is what counts). Passwords are
hashed with scrypt, Better Auth's default, with a salt per password; the hash lives
in `account.password` and nothing else holds it.

Guessing is slowed three ways: the per-endpoint rate limit
(`AUTH_RATE_LIMIT_PER_MINUTE`), a lockout after **10 failures in a row** that lasts
**15 minutes** and ends the moment the right password is given after it, and the
same answer ("Invalid email or password") whether the address exists, the password
is wrong or the account is locked.

**There is no "forgot my password" by email** — SilenceWatch sends no mail to prove
an address. Whoever runs the instance resets it:

```bash
docker compose exec silencewatch node packages/server/dist/auth/cli.js \
  reset-password --email jane@example.com
```

It prints a new random password once and ends the account's sessions. The person
changes it in **Settings → Sign-in**, which signs their other devices out.

## Passkeys, Google and Microsoft (`AUTH_MODE=full`)

People create their account with Google or Microsoft and sign in with either. Once
signed in, **a passkey is offered once** (and always available in
**Settings → Sign-in**); from then on it signs them in without the provider.

A passkey is only ever **added to an account that exists**. Creating an account from
a typed address is not offered here, because nothing would prove the address — and a
Google sign-in arriving later with the same address must not land in an account
somebody else made first.

**Recovery** is the provider: someone who lost their passkey signs in with Google
or Microsoft again, and adds a new one.

### Registering the applications

Redirect URIs are `BASE_URL` followed by `/api/auth/callback/google` and
`/api/auth/callback/microsoft`.

- **Google** — [Google Cloud console](https://console.cloud.google.com/) → APIs &
  Services → Credentials → *OAuth client ID*, type *Web application*. Authorised
  redirect URI: `https://watch.example.com/api/auth/callback/google`. Put the
  client id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Set the
  consent screen to *External* (or *Internal* for a Workspace-only instance) and
  publish it, or only test users can sign in.
- **Microsoft** — [Entra admin center](https://entra.microsoft.com/) → App
  registrations → *New registration*. Supported account types: *any organisational
  directory and personal Microsoft accounts* for `MICROSOFT_TENANT_ID=common`, or the
  single-tenant option together with your tenant id. Redirect URI (platform *Web*):
  `https://watch.example.com/api/auth/callback/microsoft`. Under Certificates &
  secrets, create a client secret and copy its **Value** (not its id) into
  `MICROSOFT_CLIENT_SECRET`; the *Application (client) ID* is `MICROSOFT_CLIENT_ID`.
  Client secrets expire: put the date in your calendar.

### One address, several ways in

An account is found by its address. What happens when the same address arrives by a
second route:

| The account was made with | A sign-in arrives with | Result |
| --- | --- | --- |
| Google | Google, same address | The same account |
| Google | Microsoft, same address | **Refused.** Microsoft cannot vouch for the address (see below) |
| Microsoft | Google, same address | **Refused.** The account's address was never proven |
| Anything | Google, address Google has not verified | **Refused** |

A refused sign-in lands on the sign-in page with a plain message and creates
nothing. The person signs in the way they first did.

Why Microsoft is not trusted: the address in a Microsoft token is whatever the
administrator of that tenant set, so trusting it would let anyone who runs a tenant
sign in as anyone. Better Auth identifies a Microsoft account by its immutable `oid`,
which is what keeps it from being confused with another.

## The first account

An instance with no account has nobody to invite the first one, and nothing proves
that an address typed into the sign-up form is its owner's. So while there is no
account, and `ADMIN_EMAIL` is set or `SIGNUP_ENABLED=false`, sign-up is closed to
everyone except a **one-time link**:

```
No account yet. Create the first one for jane@example.com with this link, once, before 2026-10-17T10:30:00.000Z:
  https://watch.example.com/setup?email=jane%40example.com#Tkj3…
```

- It is printed in the server log at every start while there is no account. It
  expires after **30 minutes** and works **once**, for that address only. The token
  is in the part of the URL after `#`, which a browser never sends to a server.
- Without `ADMIN_EMAIL` and with `SIGNUP_ENABLED=true`, the first account is simply
  whoever gets there first — fine on a private network, not on a public one.
- You can make a link at any time, for any address, whether or not sign-up is open —
  to add one more person to an instance that is closed:

  ```bash
  docker compose exec silencewatch node packages/server/dist/auth/cli.js \
    create-admin --email jane@example.com
  ```

A link also skips the abuse limits in [`abuse-prevention.md`](abuse-prevention.md):
it is you saying that this person may join.

Opening the link takes the person to the sign-in page with the address fixed; they
create their account in whichever way the mode allows.

## Sessions and sensitive actions

- A session lasts **30 days** and slides: using it after a day moves its end
  forward, so a person who comes every week stays signed in and one who stops is
  signed out a month later.
- It is a cookie named `sw.session_token` (`__Secure-sw.session_token` over HTTPS):
  `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS. The page cannot read it.
- A write made with a session cookie must come from `BASE_URL` or one of
  `AUTH_TRUSTED_ORIGINS`: the `Origin` header is checked, and anything else is
  answered 403. API keys are not cookies and are not subject to it.
- An account keeps at most **20** live sessions; the oldest are ended.
- **Deleting the account, creating or revoking an API key, adding or removing a
  passkey and making new recovery codes need a sign-in from the last 10 minutes.**
  The page asks the person to sign in again, with the method the instance has, and
  carries on. Over the API the refusal is `403` with
  `details.reauthRequired: true`.

The audit trail (**Settings → Security activity**) records sign-ins and failures
(with the address that tried, including addresses that have no account), sign-outs,
password changes, passkeys added and removed, recovery codes made and used, and
account creation and deletion.

## When someone is locked out

Everything below is for whoever runs the server; none of it is an endpoint.

| Mode | Situation | What to do |
| --- | --- | --- |
| `passkey` | Lost every passkey, still has recovery codes | They use a code on the sign-in page |
| `passkey` | Lost every passkey and the codes | `cli.js recovery-codes --email …` prints a new set, once |
| `password` | Forgot the password | `cli.js reset-password --email …` |
| `full` | Lost their passkey | They sign in with Google or Microsoft |
| `full` | Lost access to the Google or Microsoft account | Not recoverable here: that is the provider's to restore |
| any | Nobody can sign in at all | `cli.js create-admin --email …` makes a setup link for a new account |

Run them as `node packages/server/dist/auth/cli.js <command> --email <address>` in
the server container. The password and the codes are printed to the terminal and
nowhere else.

## Changing the mode later

Changing `AUTH_MODE` **never deletes an account, a project or a check.** It changes
how people prove who they are, so some of them have to be let back in once. Stop and
start the server with the new value; nothing needs migrating.

| From → to | What people find | What you do |
| --- | --- | --- |
| `password` → `passkey` | Their password no longer works; no passkey yet | Per account, `recovery-codes --email …` and hand over the codes: they sign in with one and add a passkey |
| `password` → `full` | Provider sign-in is refused: their address was never proven | If you know the address is theirs, `UPDATE "user" SET email_verified = true WHERE email = '…';` — then Google (only) links to it. Or let them make a new account |
| `passkey` → `password` | No password | Per account, `reset-password --email …` and hand over the password |
| `passkey` → `full` | Provider sign-in is refused: the address was never proven | As above; their passkeys keep working in `full` |
| `full` → `passkey` | No passkey, unless they added one | Per account, `recovery-codes --email …`; those who added a passkey sign in as before |
| `full` → `password` | No password | Per account, `reset-password --email …` |

Passkeys and passwords stay in the database when their mode is off, and come back
when it is on again.

## Testing by hand

**Passkeys without a device.** In Chrome or Edge, open DevTools → ⋮ → More tools →
**WebAuthn** → *Enable virtual authenticator environment* → *Add authenticator*
(protocol `ctap2`, transport `internal`, tick *resident keys* and *user
verification*). Create an account and sign in on `http://localhost:8080`; the
virtual authenticator answers for you.

**Providers locally.** In `full` mode with `BASE_URL=http://localhost:8080`, register
the redirect URIs with `http://localhost:8080` as the host: both Google and
Microsoft accept `localhost` over plain HTTP for development.

**The Angular dev server** (`pnpm dev:web`, on `http://localhost:4200`) is another
origin, so it has to be named, and `AUTH_RP_ID` stays `localhost`:

```bash
AUTH_TRUSTED_ORIGINS=http://localhost:4200
```

The repository's end-to-end tests run a software authenticator through the real
WebAuthn verification, and stand-ins for the two providers; see
[`development.md`](development.md#tests).

## What is not here

- **No email.** Nothing is sent to prove an address, to reset a password or to
  invite someone. That is deliberate: it removes a service the instance would have to
  keep up for sign-in to work. Alert emails are a separate thing.
- **No second factor on top of a password**, and no passkey beside a password: pick
  the method, not a stack of them.
- **No sign-in API for machines.** Scripts and CI use [API keys](api.md#authentication).
- **No selection of other providers.** Adding one is a code change, not a setting.
