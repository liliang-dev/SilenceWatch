#!/usr/bin/env node
/**
 * Account tasks for whoever runs the server, from the command line. In the image it
 * is `silencewatch` (deploy/silencewatch); anywhere else, `node dist/auth/cli.js`.
 * Run it without arguments for the list of commands and what each one does.
 *
 * Deliberately not endpoints: each of these hands out access or changes an
 * account, and the only person entitled to ask for it is one who can already run
 * commands on the server.
 *
 * Every command prints what it produced to the terminal and nowhere else. The
 * password and the codes are shown once and are not recoverable afterwards. Every
 * command that changes something is recorded in the audit trail.
 */
import { loadConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { SupportCommands, SupportError } from './cli/support-commands';

const USAGE = `Usage: silencewatch <command> --email <address> [options]

Look:
  show             Print the account: plan, subscription, sign-in methods, live
                   sessions, lockout and projects. Changes nothing.

Let someone in:
  create-admin     Print a one-time link that creates an account for the address,
                   whether or not sign-up is open. Use it for the first account.
  recovery-codes   Replace the account's recovery codes and print the new set once.
                   Only when AUTH_MODE=passkey.
  reset-password   Set a new random password for the account and print it once.
                   Only when AUTH_MODE=password. Ends the account's sessions.
  unlock           End a lockout after too many wrong passwords.
  end-sessions     Sign the account out everywhere.

Fix an account:
  verify-email     Mark the address as verified. Needed before Google can be linked
                   to an account that was created with a passkey.
  set-plan         Change the plan: --plan <name> (a name from PLAN_LIMITS) or
                   --plan none for no limits. A Stripe event sets it again.`;

async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const email = option(rest, '--email')?.toLowerCase() ?? null;
  if (command === undefined || email === null || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new SupportError(USAGE);
  }

  const config = loadConfig();
  const prisma = new PrismaService(config);
  await prisma.$connect();
  try {
    const commands = new SupportCommands(config, prisma);
    print(await dispatch(commands, command, email, rest));
  } finally {
    await prisma.onModuleDestroy();
  }
}

function dispatch(commands: SupportCommands, command: string, email: string, args: string[]): Promise<string> {
  switch (command) {
    case 'show':
      return commands.show(email);
    case 'create-admin':
      return commands.createAdmin(email);
    case 'recovery-codes':
      return commands.recoveryCodes(email);
    case 'reset-password':
      return commands.resetPassword(email);
    case 'unlock':
      return commands.unlock(email);
    case 'end-sessions':
      return commands.endSessions(email);
    case 'verify-email':
      return commands.verifyEmail(email);
    case 'set-plan': {
      const plan = option(args, '--plan');
      if (plan === null) throw new SupportError('set-plan needs --plan <name>, or --plan none.');
      return commands.setPlan(email, plan);
    }
    default:
      throw new SupportError(USAGE);
  }
}

function option(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  const value = at === -1 ? undefined : args[at + 1];
  return value !== undefined && !value.startsWith('--') ? value : null;
}

const print = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

run(process.argv.slice(2)).catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error instanceof SupportError ? 2 : 1;
});
