import { Router, Response } from 'express';
import { AuditStatus, Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorize.middleware';
import { verifyAuditChain } from '../utils/auditLogger';
import { AuthenticatedRequest } from '../types';

const router = Router();

// Apply authentication and ADMIN role requirement across all admin audit routes
router.use(authenticate);
router.use(requireRole(['ADMIN']));

/**
 * GET /api/admin/audit-logs/verify
 * Triggers verifyAuditChain() and returns the tamper-status verdict.
 */
router.get('/audit-logs/verify', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const verdict = await verifyAuditChain();

    if (!verdict.isValid) {
      res.status(200).json({
        isValid: false,
        corruptedAtId: verdict.corruptedAtId,
        status: 'TAMPER_DETECTED',
        message: 'Cryptographic hash chain verification failed! Unauthorized log tampering detected.',
      });
      return;
    }

    res.status(200).json({
      isValid: true,
      status: 'VERIFIED',
      message: 'Audit log cryptographic chain is intact and valid.',
      totalLogs: verdict.totalLogs,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to verify audit chain', details: err.message });
  }
});

/**
 * GET /api/admin/audit-logs
 * Paginated log viewer with search filters (by userId, documentId, status, date range).
 */
router.get('/audit-logs', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.max(1, parseInt((req.query.limit as string) || '50', 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by userId
    if (req.query.userId) {
      where.userId = req.query.userId as string;
    }

    // Filter by documentId
    if (req.query.documentId) {
      where.documentId = req.query.documentId as string;
    }

    // Filter by status (SUCCESS / DENIED)
    if (req.query.status) {
      const statusStr = (req.query.status as string).toUpperCase();
      if (statusStr === 'SUCCESS' || statusStr === 'DENIED') {
        where.status = statusStr as AuditStatus;
      }
    }

    // Filter by date range (startDate/endDate or from/to)
    const startDate = (req.query.startDate || req.query.from) as string | undefined;
    const endDate = (req.query.endDate || req.query.to) as string | undefined;

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp.gte = new Date(startDate);
      }
      if (endDate) {
        where.timestamp.lte = new Date(endDate);
      }
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, role: true },
          },
          document: {
            select: { id: true, title: true },
          },
        },
      }),
    ]);

    res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      logs,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch audit logs', details: err.message });
  }
});

export default router;
