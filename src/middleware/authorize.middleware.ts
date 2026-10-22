import { Response, NextFunction } from 'express';
import { AccessLevel, AuditStatus, Role } from '@prisma/client';
import { auditService } from '../services/audit.service';
import { documentService } from '../services/document.service';
import { AuthenticatedRequest } from '../types';

export type RequiredAction = 'READ' | 'WRITE' | 'DELETE' | 'SHARE';

/**
 * Authorization Middleware for Document Access.
 * Enforces Architecture Rule 3:
 * "Every document read/download request MUST pass through server authorization middleware."
 * Enforces Architecture Rule 5:
 * "All security checks that fail must emit a DENIED audit log before returning HTTP 403."
 */
export function authorizeDocument(requiredAction: RequiredAction = 'READ') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const documentId = req.params.id;
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'User must be authenticated' });
      return;
    }

    if (!documentId) {
      res.status(400).json({ error: 'Document ID route parameter is required' });
      return;
    }

    const doc = await documentService.getRawDocumentById(documentId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    let isAuthorized = false;
    let denialReason = '';

    // 1. Role ADMIN has universal organizational access
    if (user.role === Role.ADMIN) {
      isAuthorized = true;
    }
    // 2. Document Owner has full access
    else if (doc.ownerId === user.id) {
      isAuthorized = true;
    }
    // 3. Evaluate Attribute-Based Access Control (ABAC) explicit permission grants
    else {
      const userPermission = doc.permissions?.find((p: any) => p.userId === user.id);

      if (requiredAction === 'READ') {
        if (userPermission && (userPermission.accessLevel === AccessLevel.READ || userPermission.accessLevel === AccessLevel.EDIT)) {
          isAuthorized = true;
        } else {
          denialReason = `User ${user.email} (${user.role}) lacks READ permission on document ${documentId}`;
        }
      } else if (requiredAction === 'WRITE' as any || (requiredAction as any) === 'EDIT') {
        if (userPermission && userPermission.accessLevel === AccessLevel.EDIT) {
          isAuthorized = true;
        } else {
          denialReason = `User ${user.email} lacks EDIT permission on document ${documentId}`;
        }
      } else if (requiredAction === 'DELETE' || requiredAction === 'SHARE') {
        denialReason = `Only the document owner or an ADMIN may execute action '${requiredAction}' on document ${documentId}`;
      }
    }

    if (!isAuthorized) {
      // Architecture Rule 5: Emit DENIED audit log BEFORE returning HTTP 403
      await auditService.logSecurityEvent({
        action: `DOCUMENT_${requiredAction}_DENIED`,
        status: AuditStatus.DENIED,
        userId: user.id,
        documentId: doc.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: denialReason || 'BOLA/IDOR security check failed: unauthorized resource access attempt',
      });

      res.status(403).json({
        error: 'Access denied: you do not possess permission to access this document resource',
        code: 'ACCESS_DENIED',
      });
      return;
    }

    // Attach resolved document to request for downstream controller handlers
    req.document = doc;
    next();
  };
}

/**
 * Role-Based Access Control (RBAC) Middleware.
 * Enforces Architecture Rule 5: Emits DENIED audit log before returning HTTP 403.
 */
export function requireRoles(...allowedRoles: Role[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'User must be authenticated' });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      await auditService.logSecurityEvent({
        action: 'RBAC_ROLE_DENIED',
        status: AuditStatus.DENIED,
        userId: user.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `User with role ${user.role} attempted to access route restricted to [${allowedRoles.join(', ')}]`,
      });

      res.status(403).json({
        error: 'Access denied: insufficient role privileges',
        code: 'ROLE_NOT_AUTHORIZED',
      });
      return;
    }

    next();
  };
}

/**
 * Role-Based Access Control (RBAC) Middleware supporting requireRole(['ADMIN']) or requireRole(Role.ADMIN).
 */
export function requireRole(allowedRoles: Role | Role[] | string | string[]) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return requireRoles(...(roles as Role[]));
}
