import { Router, Response } from 'express';
import { Role, AuditStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/authorize.middleware';
import { auditService } from '../services/audit.service';
import { storageService } from '../services/storage.service';
import { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/users
 * Authenticated & RBAC Guarded: Accessible strictly to ADMIN or OWNER.
 * Returns all registered users with their roles for user management, persona switching, and document sharing.
 */
router.get(
  '/',
  authenticate,
  requireRoles(Role.ADMIN, Role.OWNER),
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
        },
        orderBy: { email: 'asc' },
      });
      res.status(200).json({ users });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve users', details: err.message });
    }
  }
);

/**
 * PATCH /api/users/:id/role
 * Authenticated & RBAC Guarded: Accessible to ADMIN or OWNER.
 * Rules:
 * - Requester role check: If requester is OWNER and target user is ADMIN, return 403 Forbidden ("Owners cannot alter Admin roles").
 * - Promotes/demotes target user to VIEWER, OWNER, or ADMIN.
 */
router.patch(
  '/:id/role',
  authenticate,
  requireRoles(Role.ADMIN, Role.OWNER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const targetId = req.params.id;
    const { newRole } = req.body;

    if (!newRole || !['VIEWER', 'OWNER', 'ADMIN'].includes(newRole)) {
      res.status(400).json({ error: 'Invalid role. Must be VIEWER, OWNER, or ADMIN' });
      return;
    }

    try {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetId },
      });

      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Rule: Prevent an OWNER from demoting or modifying an existing ADMIN's role
      if (req.user!.role === Role.OWNER && targetUser.role === Role.ADMIN) {
        await auditService.logSecurityEvent({
          action: 'USER_ROLE_CHANGE_DENIED',
          status: AuditStatus.DENIED,
          userId: req.user!.id,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          reason: 'Owners cannot alter Admin roles',
        });

        res.status(403).json({ error: 'Owners cannot alter Admin roles' });
        return;
      }

      const updatedUser = await prisma.user.update({
        where: { id: targetId },
        data: { role: newRole as Role },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await auditService.logSecurityEvent({
        action: 'USER_ROLE_UPDATED',
        status: AuditStatus.SUCCESS,
        userId: req.user!.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Changed role of user ${targetUser.email} from ${targetUser.role} to ${newRole}`,
      });

      res.status(200).json({
        message: 'User role updated successfully',
        user: updatedUser,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update user role', details: err.message });
    }
  }
);

/**
 * DELETE /api/users/:id
 * Authenticated & RBAC Guarded: Accessible to ADMIN or OWNER.
 * Rules:
 * - Disallow users from deleting their own active session account (400 Bad Request).
 * - Requester role check: If requester is OWNER and target user has role ADMIN, return 403 Forbidden ("Owners cannot delete Admin accounts").
 * - Deletes owned documents from physical storage, and cascades DB relations.
 */
router.delete(
  '/:id',
  authenticate,
  requireRoles(Role.ADMIN, Role.OWNER),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const targetId = req.params.id;

    // Disallow users from deleting their own active session account
    if (req.user!.id === targetId) {
      res.status(400).json({ error: 'Cannot delete your own active session account' });
      return;
    }

    try {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetId },
      });

      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Rule: Prevent OWNER from deleting ADMIN accounts
      if (req.user!.role === Role.OWNER && targetUser.role === Role.ADMIN) {
        await auditService.logSecurityEvent({
          action: 'USER_DELETE_DENIED',
          status: AuditStatus.DENIED,
          userId: req.user!.id,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          reason: 'Owners cannot delete Admin accounts',
        });

        res.status(403).json({ error: 'Owners cannot delete Admin accounts' });
        return;
      }

      // Cleanup physical files of all documents owned by target user
      const ownedDocs = await prisma.document.findMany({
        where: { ownerId: targetId },
        select: { storageKey: true },
      });

      for (const doc of ownedDocs) {
        try {
          await storageService.deleteFile(doc.storageKey);
        } catch (err) {
          console.warn(`[USER-DELETE] Could not delete physical file ${doc.storageKey}:`, err);
        }
      }

      // Delete user from database (cascades to owned documents, permissions, revoked tokens)
      await prisma.user.delete({
        where: { id: targetId },
      });

      await auditService.logSecurityEvent({
        action: 'USER_DELETED',
        status: AuditStatus.SUCCESS,
        userId: req.user!.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Deleted user ${targetUser.email} (role: ${targetUser.role})`,
      });

      res.status(200).json({ message: 'User deleted successfully' });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete user', details: err.message });
    }
  }
);

export default router;
