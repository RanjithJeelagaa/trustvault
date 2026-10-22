import { Request, Response } from 'express';
import { AuditStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authService } from '../services/auth.service';
import { auditService } from '../services/audit.service';
import { AuthenticatedRequest } from '../types';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export class AuthController {
  public async login(req: Request, res: Response): Promise<void> {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid login payload', details: parseResult.error.format() });
      return;
    }

    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      await auditService.logSecurityEvent({
        action: 'AUTH_LOGIN_FAILED',
        status: AuditStatus.DENIED,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Login attempt for non-existent user ${email}`,
      });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValid = await authService.verifyPassword(password, user.passwordHash);

    if (!isValid) {
      await auditService.logSecurityEvent({
        action: 'AUTH_LOGIN_FAILED',
        status: AuditStatus.DENIED,
        userId: user.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: 'Password mismatch',
      });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const { token, jti, expiresIn } = authService.generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await auditService.logSecurityEvent({
      action: 'AUTH_LOGIN_SUCCESS',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `User logged in with jti ${jti}`,
    });

    res.status(200).json({
      message: 'Authentication successful',
      token,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  }

  public async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    await authService.revokeToken({
      jti: user.jti,
      userId: user.id,
      reason: 'User explicit logout',
    });

    await auditService.logSecurityEvent({
      action: 'AUTH_LOGOUT',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Token revoked for jti ${user.jti}`,
    });

    res.status(200).json({
      message: 'Successfully logged out and token invalidated',
    });
  }

  public async me(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ user: dbUser });
  }

  public async revokeUserTokens(req: AuthenticatedRequest, res: Response): Promise<void> {
    const targetUserId = req.params.userId;
    const reason = req.body.reason || 'Admin initiated token revocation';

    await authService.revokeAllForUser(targetUserId, reason);

    await auditService.logSecurityEvent({
      action: 'ADMIN_REVOKE_USER_TOKENS',
      status: AuditStatus.ALLOWED,
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Revocation executed for user ${targetUserId}: ${reason}`,
    });

    res.status(200).json({
      message: `All tokens for user ${targetUserId} have been invalidated`,
    });
  }
}

export const authController = new AuthController();
