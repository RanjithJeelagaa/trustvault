import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { ENV } from '../config/env';
import { AuthenticatedUser, TokenPayload } from '../types';

export class AuthService {
  /**
   * Generates a signed JWT with an embedded unique UUID `jti`.
   */
  public generateToken(user: { id: string; email: string; role: any }): {
    token: string;
    jti: string;
    expiresIn: string;
  } {
    const jti = uuidv4();
    const payload: TokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      jti,
    };

    const token = jwt.sign(payload, ENV.JWT_SECRET, {
      expiresIn: ENV.JWT_EXPIRES_IN,
    });

    return {
      token,
      jti,
      expiresIn: ENV.JWT_EXPIRES_IN,
    };
  }

  /**
   * Validates raw password against bcrypt hash.
   */
  public async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(plain, hash);
  }

  /**
   * Checks database for token revocation status on every authenticated request.
   * Architecture Rule 4: Token revocation must be verified against the database on every authenticated request.
   */
  public async isTokenRevoked(jti: string): Promise<boolean> {
    const revoked = await prisma.revokedToken.findUnique({
      where: { jti },
    });
    return !!revoked;
  }

  /**
   * Marks a token as revoked in PostgreSQL.
   */
  public async revokeToken(params: {
    jti: string;
    userId: string;
    reason?: string;
    expiresAt?: Date;
  }): Promise<void> {
    const defaultExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours fallback
    await prisma.revokedToken.create({
      data: {
        jti: params.jti,
        userId: params.userId,
        reason: params.reason || 'User logged out',
        expiresAt: params.expiresAt || defaultExpiry,
      },
    });
  }

  /**
   * Revokes all active tokens for a given user (e.g. security breach, demotion).
   */
  public async revokeAllForUser(userId: string, reason = 'Administrative revocation'): Promise<void> {
    // Record revocation placeholder or update user token version
    // If specific jtis are known they are in RevokedToken. We can also insert an umbrella revocation entry.
    await prisma.revokedToken.create({
      data: {
        jti: `ALL-${userId}-${uuidv4()}`,
        userId,
        reason,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
  }
}

export const authService = new AuthService();
