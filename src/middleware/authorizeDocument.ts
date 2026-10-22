import { Response, NextFunction } from 'express';
import { AccessLevel, AuditStatus, Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { auditService } from '../services/audit.service';
import { AuthenticatedRequest } from '../types';

export type RequiredPermissionLevel = 'READ' | 'EDIT' | 'DELETE';

/**
 * Granular Document Authorization Middleware
 * 
 * Enforces:
 * - ADMIN: Full access to all actions.
 * - Document Owner: Full access to their created document.
 * - Explicit Permission: Checked in the Permission table for (userId, documentId). EDIT implies READ.
 * - Emits a DENIED audit log entry before returning HTTP 403 upon authorization failure.
 */
export function authorizeDocument(requiredLevel: RequiredPermissionLevel) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const documentId = req.params.id;
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'User must be authenticated' });
      return;
    }

    if (!documentId) {
      res.status(400).json({ error: 'Document ID parameter is required' });
      return;
    }

    // 1. Fetch document from database
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        permissions: true,
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    let isAuthorized = false;
    let denialReason = '';

    // 2. Check ADMIN privilege
    if (user.role === Role.ADMIN) {
      isAuthorized = true;
    }
    // 3. Check Document Owner privilege
    else if (document.ownerId === user.id) {
      isAuthorized = true;
    }
    // 4. Check explicit permissions table for (userId, documentId)
    else {
      // Look up permission for this user and document
      const explicitGrant = document.permissions.find(
        (p) => p.userId === user.id
      ) || (await prisma.permission.findUnique({
        where: {
          documentId_userId: {
            documentId: document.id,
            userId: user.id,
          },
        },
      }));

      if (requiredLevel === 'READ') {
        // EDIT implies READ
        if (
          explicitGrant &&
          (explicitGrant.accessLevel === AccessLevel.READ || explicitGrant.accessLevel === AccessLevel.EDIT)
        ) {
          isAuthorized = true;
        } else {
          denialReason = `User ${user.email} lacking READ/EDIT permission on document ${documentId}`;
        }
      } else if (requiredLevel === 'EDIT') {
        if (explicitGrant && explicitGrant.accessLevel === AccessLevel.EDIT) {
          isAuthorized = true;
        } else {
          denialReason = `User ${user.email} lacking EDIT permission on document ${documentId}`;
        }
      } else if (requiredLevel === 'DELETE') {
        denialReason = `DELETE requires OWNER or ADMIN role for document ${documentId}`;
      }
    }

    // 5. Handle Authorization Failure
    if (!isAuthorized) {
      // Emit DENIED audit log entry
      await auditService.logSecurityEvent({
        action: `DOCUMENT_${requiredLevel}_DENIED`,
        status: AuditStatus.DENIED,
        userId: user.id,
        documentId: document.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: denialReason || `Insufficient permissions for ${requiredLevel}`,
      });

      res.status(403).json({
        error: 'Access denied: insufficient document permissions',
      });
      return;
    }

    // Attach document to request
    req.document = document;
    next();
  };
}
