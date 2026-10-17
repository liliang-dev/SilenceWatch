# Migrations waiting for a decision

What is in here has been written and tested, and has **not** been applied. It is not
in `prisma/migrations`, so `prisma migrate deploy` — which the container runs at
start — never touches it.

## `20261020120000_drop_legacy_auth`

The switch to Better Auth (`prisma/migrations/20261020120000_better_auth`) added the
new tables and left the old ones in place, so that nothing which held an account was
lost by a deploy. This drops them:

| Dropped | What it was |
| --- | --- |
| `email_verification` | Tokens that confirmed an address by email |
| `password_reset` | Tokens that reset a password by email |
| `session_legacy` | The refresh-token sessions of the old sign-in |
| `user.password_hash` | The Argon2 hash. Better Auth keeps passwords in `account.password` |
| `user.email_verified_at` | Replaced by `user.email_verified` |

Nothing reads any of them any more. Apply it once the new sign-in has run in
production long enough that going back is no longer on the table:

1. Back up the database.
2. Move the folder into `prisma/migrations`, keeping its name — or rename it to a
   timestamp later than the last migration if one has been added since.
3. In `schema.prisma`, delete the models `LegacySession`, `EmailVerification` and
   `PasswordReset`, the fields `passwordHash` and `emailVerifiedAt` on `User`, and the
   relations `legacySessions`, `verifications` and `passwordResets` that point at them.
4. `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   must be empty once the migration has been applied.
