import { Response } from 'express';
import { prisma } from '../db/prisma';
import { auditService } from '../services/audit.service';
import { AuthenticatedRequest } from '../types';

export class AuditController {
  /**
   * Retrieves paginated audit logs (Admin only).
   */
  public async listLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const skip = (page - 1) * limit;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, role: true },
          },
        },
      }),
    ]);

    res.status(200).json({
      page,
      limit,
      total,
      logs,
    });
  }

  /**
   * Verifies the cryptographic hash chain of the audit log (Admin only).
   * Validates zero tampering.
   */
  public async verifyIntegrity(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await auditService.verifyChainIntegrity();

    if (!result.isValid) {
      res.status(409).json({
        status: 'TAMPER_DETECTED',
        message: 'Cryptographic hash chain verification failed! Unauthorized log tampering detected.',
        ...result,
      });
      return;
    }

    res.status(200).json({
      status: 'VERIFIED',
      message: 'Audit log cryptographic chain is intact and valid.',
      ...result,
    });
  }
}

export const auditController = new AuditController();
