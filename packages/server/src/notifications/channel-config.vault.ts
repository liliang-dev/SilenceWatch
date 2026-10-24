import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey, sha256Hex } from '../common/crypto.util';

/** What a channel's configuration looks like in the database once it is sealed. */
// A type, not an interface: it is stored as JSON, and Prisma only takes types with a known shape.
export type SealedConfig = { sealed: string };

/** The configuration cannot be opened: the message says why, in words an operator can act on. */
export class ChannelConfigError extends Error {}

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Keeps a channel's configuration unreadable in the database.
 *
 * A channel's configuration holds credentials: a Slack, Discord or Teams webhook URL
 * is a secret by its path, and a webhook channel has a signing secret. Sealed with
 * AES-256-GCM under a key derived from SECRET_KEY, a copy of the database (a backup,
 * a leaked dump) shows none of them without the key the server runs with.
 *
 * Three properties matter more than the cipher:
 *  - **It is bound to its channel.** The channel's id is authenticated with the
 *    ciphertext, so a sealed configuration copied onto another row does not open.
 *  - **A configuration written before this existed still opens.** Plaintext passes
 *    through untouched and is sealed by the backfill, so no deploy loses a channel.
 *  - **A wrong key says so.** Every seal records which key made it, so changing
 *    SECRET_KEY produces "sealed with another SECRET_KEY" rather than a bare
 *    authentication failure, and `silencewatch reseal` knows what to do.
 */
export class ChannelConfigVault {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(secret: string) {
    this.key = deriveKey(secret, 'channel-config');
    this.keyId = sha256Hex(this.key).slice(0, 8);
  }

  isSealed(stored: unknown): stored is SealedConfig {
    return (
      typeof stored === 'object' &&
      stored !== null &&
      typeof (stored as { sealed?: unknown }).sealed === 'string'
    );
  }

  seal(channelId: string, config: unknown): SealedConfig {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(channelId));
    const body = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
    const parts = [VERSION, this.keyId, iv, body, cipher.getAuthTag()].map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    );
    return { sealed: parts.join('.') };
  }

  /** The configuration, whether it was sealed or is still the plaintext of an older version. */
  open(channelId: string, stored: unknown): unknown {
    if (!this.isSealed(stored)) return stored;

    const [version, keyId, iv, body, tag] = stored.sealed.split('.');
    if (version !== VERSION || iv === undefined || body === undefined || tag === undefined) {
      throw new ChannelConfigError('the channel configuration is not in a format this version reads');
    }
    if (keyId !== this.keyId) {
      throw new ChannelConfigError(
        'the channel configuration was sealed with another SECRET_KEY: run `silencewatch reseal` ' +
          'with OLD_SECRET_KEY set to the previous value',
      );
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(channelId));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const text = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
      return JSON.parse(text.toString('utf8')) as unknown;
    } catch {
      throw new ChannelConfigError('the channel configuration is damaged or belongs to another channel');
    }
  }
}
