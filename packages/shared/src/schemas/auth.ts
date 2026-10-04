import { z } from 'zod';
import { LIMITS } from './limits';
import { emailSchema, passwordSchema, trimmedString } from './primitives';

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: trimmedString(LIMITS.nameMax).optional(),
  /**
   * Solved sign-up challenge, `<challenge>.<nonce>`. Required only when the
   * instance issues one (SIGNUP_POW_DIFFICULTY > 0); the client learns whether
   * it needs one from GET /api/auth/signup-challenge.
   */
  powSolution: z.string().trim().max(400).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * A sign-up may or may not open a session: with email verification on, the
 * account exists but cannot be used until the address is proven.
 */
export type RegisterResponse =
  | ({ status: 'active' } & SessionDto)
  | { status: 'verification_sent'; email: string };

export const verifyEmailRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const resendVerificationRequestSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

/**
 * The work a client must do before registering. `difficulty: 0` means the
 * instance asks for none, and the client submits without a solution.
 */
export interface SignupChallengeDto {
  /** Opaque, signed, single-use. Echoed back inside `powSolution`. */
  challenge: string;
  /** Leading zero bits required in SHA-256(`<challenge>.<nonce>`). */
  difficulty: number;
  expiresIn: number;
}

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The browser sends the refresh token as an HttpOnly cookie and this body is
 * empty. It stays optional for clients that have nowhere to put a cookie and
 * hold the token themselves.
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(500).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/**
 * Deleting an account asks for the password again, not just a signed-in session:
 * an unattended browser or a stolen access token should not be enough to destroy
 * everything an account holds, instantly and for good.
 */
export const deleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(LIMITS.passwordMax),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface SessionDto extends AuthTokens {
  user: UserDto;
}
