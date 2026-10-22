import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuditStatus } from '@prisma/client';
import { ENV } from '../config/env';
import { authService } from '../services/auth.service';
import { auditService } from '../services/audit.service';
import { AuthenticatedRequest, TokenPayload } from '../types';

/**
 * Authentication Middleware
 * Enforces Architecture Rule 4:
 * "Token revocation must be verified against the database on every authenticated request."
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as TokenPayload;

    if (!decoded.jti) {
      res.status(401).json({ error: 'Malformed token: missing jti' });
      return;
    }

    // Synchronous database revocation check on EVERY authenticated request
    const isRevoked = await authService.isTokenRevoked(decoded.jti);

    if (isRevoked) {
      await auditService.logSecurityEvent({
        action: 'AUTHENTICATION_REVOKED_TOKEN',
        status: AuditStatus.DENIED,
        userId: decoded.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: 'Attempted access with revoked or logged-out token (jti check failed)',
      });

      res.status(401).json({ error: 'Token has been revoked or invalidated' });
      return;
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      jti: decoded.jti,
    };

    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}
