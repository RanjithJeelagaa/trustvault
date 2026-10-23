import { Request, Response } from 'express';
import { Role, AuditStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authService } from '../services/auth.service';
import { auditService } from '../services/audit.service';
import { AuthenticatedRequest } from '../types';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.toUpperCase() : val),
      z.nativeEnum(Role)
    )
    .optional()
    .default(Role.VIEWER),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
});

export class AuthController {
  public async register(req: Request, res: Response): Promise<void> {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      console.warn('[AUTH-REGISTER] Validation failed:', parseResult.error.format());
      res.status(400).json({
        error: 'Invalid registration payload',
        details: parseResult.error.format(),
      });
      return;
    }

    const { email, password, role } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    console.log(`[AUTH-REGISTER] Processing registration for email: "${normalizedEmail}", role: ${role}`);

    const existingUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
    });

    if (existingUser) {
      console.warn(`[AUTH-REGISTER] Conflict: Email "${normalizedEmail}" is already registered`);
      await auditService.logSecurityEvent({
        action: 'AUTH_REGISTER_FAILED',
        status: AuditStatus.DENIED,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Registration conflict: Email ${normalizedEmail} already exists`,
      });
      res.status(409).json({ error: 'Email already in use' });
      return;
    }

    const passwordHash = await authService.hashPassword(password);
    console.log(
      `[AUTH-REGISTER] Password hashed successfully with salt rounds 12 (prefix: ${passwordHash.substring(0, 7)})`
    );

    // Enforce role = VIEWER strictly on registration regardless of incoming overrides
    const assignedRole = Role.VIEWER;

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: assignedRole,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    console.log(`[AUTH-REGISTER] User created successfully: id=${newUser.id}, email="${newUser.email}", role=${newUser.role}`);

    await auditService.logSecurityEvent({
      action: 'AUTH_REGISTER_SUCCESS',
      status: AuditStatus.SUCCESS,
      userId: newUser.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `User registered successfully with role ${newUser.role}`,
    });

    res.status(201).json({
      message: 'Account created successfully! Please sign in',
      user: newUser,
    });
  }

  public async login(req: Request, res: Response): Promise<void> {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      console.warn('[AUTH-LOGIN] Validation failed:', parseResult.error.format());
      res.status(400).json({ error: 'Invalid login payload', details: parseResult.error.format() });
      return;
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    console.log(`[AUTH-LOGIN] Processing login attempt for email: "${normalizedEmail}"`);

    // Case-insensitive trimmed lookup guaranteeing passwordHash is retrieved
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      console.warn(`[AUTH-LOGIN] Failure: User not found for email "${normalizedEmail}"`);
      await auditService.logSecurityEvent({
        action: 'AUTH_LOGIN_FAILED',
        status: AuditStatus.DENIED,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Login attempt for non-existent user ${normalizedEmail}`,
      });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const hasValidHash =
      typeof user.passwordHash === 'string' &&
      (user.passwordHash.startsWith('$2a$') || user.passwordHash.startsWith('$2b$'));

    console.log(
      `[AUTH-LOGIN] User record found: id=${user.id}, email="${user.email}", role=${user.role}, hasValidBcryptHash=${hasValidHash}, hashPrefix="${user.passwordHash?.substring(0, 7)}..."`
    );

    if (!hasValidHash) {
      console.error(
        `[AUTH-LOGIN] Failure: User "${normalizedEmail}" has invalid or missing bcrypt passwordHash in database`
      );
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Bcrypt comparison
    const isMatch = await authService.verifyPassword(password, user.passwordHash);

    if (!isMatch) {
      console.warn(`[AUTH-LOGIN] Failure: Password hash mismatch for user "${normalizedEmail}"`);
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

    console.log(`[AUTH-LOGIN] Success: Password verified for user "${normalizedEmail}" (${user.role})`);

    const { token, jti, expiresIn } = authService.generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await auditService.logSecurityEvent({
      action: 'AUTH_LOGIN_SUCCESS',
      status: AuditStatus.SUCCESS,
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
      status: AuditStatus.SUCCESS,
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
      status: AuditStatus.SUCCESS,
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Revocation executed for user ${targetUserId}: ${reason}`,
    });

    res.status(200).json({
      message: `All tokens for user ${targetUserId} have been invalidated`,
    });
  }

  public async switchPersona(req: AuthenticatedRequest, res: Response): Promise<void> {
    const caller = req.user;
    if (!caller) {
      res.status(401).json({ error: 'User must be authenticated' });
      return;
    }

    if (caller.role !== Role.ADMIN && caller.role !== Role.OWNER) {
      await auditService.logSecurityEvent({
        action: 'ACCESS_DENIED',
        status: AuditStatus.DENIED,
        userId: caller.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Viewer ${caller.email} attempted unauthorized persona switch`,
      });
      res.status(403).json({ error: 'Only ADMIN and OWNER accounts are permitted to switch personas' });
      return;
    }

    const { email, userId } = req.body;
    if (!email && !userId) {
      res.status(400).json({ error: 'Target email or userId is required' });
      return;
    }

    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email: String(email).toLowerCase().trim() }] : []),
          ...(userId ? [{ id: String(userId) }] : []),
        ],
      },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Target persona user not found' });
      return;
    }

    const { token, jti } = authService.generateToken({
      id: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
    });

    await auditService.logSecurityEvent({
      action: 'SWITCH_PERSONA',
      status: AuditStatus.SUCCESS,
      userId: caller.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Persona switched by ${caller.email} (${caller.role}) to ${targetUser.email} (${targetUser.role}) with jti ${jti}`,
    });

    res.status(200).json({
      message: `Active persona switched to ${targetUser.email}`,
      token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
      },
    });
  }
}

export const authController = new AuthController();
