/**
 * What the sign-in page needs before anyone is signed in. Never anything secret:
 * it is public, and tells a visitor only what they could learn by looking at the
 * page.
 */
export interface AuthConfigDto {
  mode: 'passkey' | 'password' | 'full';
  /** Sign in and register with a passkey. */
  passkey: boolean;
  /** Sign in with an email address and a password. */
  password: boolean;
  /** Providers offered as a button. */
  providers: Array<'google' | 'microsoft'>;
  /** Whether a lost passkey can be replaced with a recovery code. */
  recoveryCodes: boolean;
  /** Whether anyone may create an account, as opposed to being let in by a setup link. */
  signup: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}
