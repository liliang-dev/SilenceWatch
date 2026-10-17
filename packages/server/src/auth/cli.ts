#!/usr/bin/env node
/**
 * Account tasks for whoever runs the server, from the command line:
 *
 *   node dist/auth/cli.js create-admin    --email <address>
 *   node dist/auth/cli.js reset-password  --email <address>   (AUTH_MODE=password)
 *   node dist/auth/cli.js recovery-codes  --email <address>   (AUTH_MODE=passkey)
 *
 * Deliberately not endpoints: each of these hands out access, and the only person
 * entitled to ask for it is one who can already run commands on the server.
 *
 * Every command prints what it produced to the terminal and nowhere else. The
 * password and the codes are shown once and are not recoverable afterwards.
 */
import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';
import { loadConfig, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { RecoveryCodesService } from './recovery/recovery-codes.service';
import { SetupLinkService } from './signup/setup-link.service';
import { UsersRepository } from './users/users.repository';

const USAGE = `Usage: node dist/auth/cli.js <command> --email <address>

Commands:
  create-admin     Print a one-time link that creates an account for the address,
                   whether or not sign-up is open. Use it for the first account.
  reset-password   Set a new random password for the account and print it once.
                   Only when AUTH_MODE=password. Ends the account's sessions.
  recovery-codes   Replace the account's recovery codes and print the new set once.
                   Only when AUTH_MODE=passkey.`;

async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const email = emailOption(rest);
  if (command === undefined || email === null) {
    throw new UsageError(USAGE);
  }

  const config = loadConfig();
  const prisma = new PrismaService(config);
  await prisma.$connect();
  try {
    const users = new UsersRepository(prisma);

    switch (command) {
      case 'create-admin': {
        const { url, expiresAt } = await new SetupLinkService(config, prisma).issue(email);
        print(`Open this link once, before ${expiresAt.toISOString()}:\n\n  ${url}`);
        return;
      }
      case 'reset-password': {
        requireMode(config, 'password', 'reset-password');
        const user = await existing(users, email);
        const password = randomBytes(18).toString('base64url');
        await users.replacePasswordAndEndSessions(user.id, await hashPassword(password));
        print(
          `New password for ${email} (shown once, change it after signing in):\n\n  ${password}`,
        );
        return;
      }
      case 'recovery-codes': {
        requireMode(config, 'passkey', 'recovery-codes');
        const user = await existing(users, email);
        const codes = await new RecoveryCodesService(config, prisma).replaceAll(user.id);
        print(`Recovery codes for ${email} (shown once; the previous ones no longer work):\n\n  ${codes.join('\n  ')}`);
        return;
      }
      default:
        throw new UsageError(USAGE);
    }
  } finally {
    await prisma.onModuleDestroy();
  }
}

class UsageError extends Error {}

function emailOption(args: string[]): string | null {
  const at = args.indexOf('--email');
  const value = at === -1 ? undefined : args[at + 1];
  return value !== undefined && /^[^@\s]+@[^@\s]+$/.test(value) ? value.toLowerCase() : null;
}

function requireMode(config: AppConfig, mode: AppConfig['AUTH_MODE'], command: string): void {
  if (config.AUTH_MODE !== mode) {
    throw new UsageError(`${command} only applies when AUTH_MODE=${mode} (this instance runs ${config.AUTH_MODE}).`);
  }
}

async function existing(users: UsersRepository, email: string): Promise<{ id: string }> {
  const user = await users.findByEmail(email);
  if (user === null) throw new UsageError(`No account for ${email}.`);
  return user;
}

const print = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

run(process.argv.slice(2)).catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
