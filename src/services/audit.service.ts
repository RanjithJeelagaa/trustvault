import { AuditStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { computeAuditEntryHash } from '../utils/crypto';
import { calculateAuditHash, GENESIS_HASH } from '../utils/auditLogger';

export { GENESIS_HASH };

export interface LogSecurityEventParams {
  action: string;
  status: AuditStatus;
  userId?: string | null;
  documentId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}

export class AuditService {
  /**
   * Records a security event with cryptographic hash chaining.
   * Ensures append-only tamper-evident logs.
   */
  public async logSecurityEvent(params: LogSecurityEventParams) {
    const timestamp = new Date();

    // Retrieve the most recent audit entry to link the hash chain
    const lastEntry = await prisma.auditLog.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { currentHash: true, entryHash: true },
    });

    const previousHash = lastEntry
      ? (lastEntry.currentHash && lastEntry.currentHash.length === 64
          ? lastEntry.currentHash
          : (lastEntry.entryHash && lastEntry.entryHash.length === 64 ? lastEntry.entryHash : GENESIS_HASH))
      : GENESIS_HASH;

    const currentHash = calculateAuditHash({
      previousHash,
      timestamp,
      userId: params.userId,
      action: params.action,
      documentId: params.documentId,
      status: params.status,
    });

    const entryHash = computeAuditEntryHash({
      previousHash,
      action: params.action,
      status: params.status,
      userId: params.userId || null,
      documentId: params.documentId || null,
      timestamp,
      reason: params.reason || null,
    });

    return await prisma.auditLog.create({
      data: {
        action: params.action,
        status: params.status,
        userId: params.userId || null,
        documentId: params.documentId || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        reason: params.reason || null,
        previousHash,
        currentHash,
        entryHash,
        timestamp,
      },
    });
  }

  /**
   * Verifies the cryptographic integrity of the entire audit log chain.
   * Detects tampering, modifications, or deletions of audit entries.
   */
  public async verifyChainIntegrity(): Promise<{
    isValid: boolean;
    totalVerified: number;
    corruptedEntryId?: string;
    corruptedAtId?: string;
    details?: string;
  }> {
    const entries = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'asc' },
    });

    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Check linkage with preceding block
      if (entry.previousHash !== expectedPreviousHash) {
        return {
          isValid: false,
          totalVerified: i,
          corruptedEntryId: entry.id,
          corruptedAtId: entry.id,
          details: `Broken hash chain link at entry #${i + 1} (id: ${entry.id}). Expected previousHash ${expectedPreviousHash}, got ${entry.previousHash}`,
        };
      }

      // Check entry contents against its cryptographic seal
      const computedCurrent = calculateAuditHash({
        previousHash: entry.previousHash,
        timestamp: entry.timestamp,
        userId: entry.userId,
        action: entry.action,
        documentId: entry.documentId,
        status: entry.status,
      });

      const computedEntryHash = computeAuditEntryHash({
        previousHash: entry.previousHash,
        action: entry.action,
        status: entry.status,
        userId: entry.userId,
        documentId: entry.documentId,
        timestamp: entry.timestamp,
        reason: entry.reason,
      });

      const recordedCurrent = (entry as any).currentHash;
      const recordedEntry = entry.entryHash;

      const isCurrentValid = recordedCurrent ? computedCurrent === recordedCurrent : false;
      const isEntryValid = recordedEntry ? computedEntryHash === recordedEntry : false;

      if (!isCurrentValid && !isEntryValid) {
        return {
          isValid: false,
          totalVerified: i,
          corruptedEntryId: entry.id,
          corruptedAtId: entry.id,
          details: `Hash mismatch at entry #${i + 1} (id: ${entry.id}). Content has been modified!`,
        };
      }

      expectedPreviousHash = recordedCurrent || recordedEntry || computedCurrent;
    }

    return {
      isValid: true,
      totalVerified: entries.length,
    };
  }
}

export const auditService = new AuditService();
