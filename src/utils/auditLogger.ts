import crypto from 'crypto';
import { AuditStatus } from '@prisma/client';
import { prisma } from '../db/prisma';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  documentId?: string | null;
  status: AuditStatus | 'SUCCESS' | 'DENIED';
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  timestamp?: Date;
}

export interface VerifyChainResult {
  isValid: boolean;
  corruptedAtId?: string;
  totalLogs?: number;
}

/**
 * Calculates SHA-256 of: `${previousHash}:${timestamp}:${userId}:${action}:${documentId}:${status}`
 * in accordance with TrustVault Phase 3 Cryptographic Hash-Chaining specification.
 */
export function calculateAuditHash(params: {
  previousHash: string;
  timestamp: Date | string;
  userId?: string | null;
  action: string;
  documentId?: string | null;
  status: string;
}): string {
  const ts = params.timestamp instanceof Date ? params.timestamp.toISOString() : new Date(params.timestamp).toISOString();
  const userId = params.userId ?? '';
  const documentId = params.documentId ?? '';
  const payload = `${params.previousHash}:${ts}:${userId}:${params.action}:${documentId}:${params.status}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Logs an audit event with cryptographic hash-chaining.
 * 1. Fetches latest log entry's currentHash (or GENESIS_HASH if none exists).
 * 2. Calculates SHA-256 of: `${previousHash}:${timestamp}:${userId}:${action}:${documentId}:${status}`.
 * 3. Stores this SHA-256 string as currentHash.
 */
export async function logAudit(params: AuditLogInput) {
  const timestamp = params.timestamp || new Date();

  // Before inserting a new log, fetch the latest log entry's currentHash
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

  return await prisma.auditLog.create({
    data: {
      timestamp,
      userId: params.userId || null,
      action: params.action,
      documentId: params.documentId || null,
      status: params.status as AuditStatus,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      reason: params.reason || null,
      previousHash,
      currentHash,
      entryHash: currentHash,
    },
  });
}

export const logAuditEvent = logAudit;

/**
 * Iterates through the entire audit log ordered by createdAt/timestamp ascending.
 * Recomputes each hash and verifies that every row's previousHash matches the previous row's currentHash.
 * Returns { isValid: boolean, corruptedAtId?: string }.
 */
export async function verifyAuditChain(): Promise<VerifyChainResult> {
  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: 'asc' },
  });

  let expectedPreviousHash = GENESIS_HASH;

  for (const log of logs) {
    // 1. Verify previousHash matches previous row's currentHash
    if (log.previousHash !== expectedPreviousHash) {
      return {
        isValid: false,
        corruptedAtId: log.id,
        totalLogs: logs.length,
      };
    }

    // 2. Recompute currentHash
    const computedHash = calculateAuditHash({
      previousHash: log.previousHash,
      timestamp: log.timestamp,
      userId: log.userId,
      action: log.action,
      documentId: log.documentId,
      status: log.status,
    });

    const recordedHash = log.currentHash || log.entryHash;
    if (computedHash !== recordedHash) {
      return {
        isValid: false,
        corruptedAtId: log.id,
        totalLogs: logs.length,
      };
    }

    expectedPreviousHash = recordedHash;
  }

  return {
    isValid: true,
    totalLogs: logs.length,
  };
}

export const auditLogger = {
  log: logAudit,
  logAudit,
  logAuditEvent,
  calculateAuditHash,
  verifyAuditChain,
  GENESIS_HASH,
};

export default auditLogger;
