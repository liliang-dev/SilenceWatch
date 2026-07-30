import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { AppConfig, CONFIG } from '../config/config';
import { deriveKey, randomToken, sha256Hex } from '../common/crypto.util';

const ISSUER = 'silencewatch';
const AUDIENCE = 'silencewatch-api';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Token issuing and verification.
 *
 * Access tokens are short-lived JWTs (stateless, no database round trip on every
 * request). Refresh tokens are opaque random strings stored only as SHA-256, so
 * a database leak does not hand over live sessions. Both keys are derived from
 * SECRET_KEY with HKDF under distinct labels, so one cannot be used in place of
 * the other.
 */
@Injectable()
export class TokenService {
  private readonly signingKey: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.signingKey = deriveKey(config.SECRET_KEY, 'access-token-hs256');
  }

  get accessTokenTtlSeconds(): number {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.signingKey);
  }

  /** Returns the claims, or null for anything that is not a valid, live token. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.signingKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        clockTolerance: 5,
      });
      const userId = payload.sub;
      const sessionId = payload.sid;
      if (typeof userId !== 'string' || typeof sessionId !== 'string') return null;
      return { userId, sessionId };
    } catch {
      return null;
    }
  }

  issueRefreshToken(): IssuedRefreshToken {
    const token = randomToken(32);
    return {
      token,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    };
  }

  hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }
}
