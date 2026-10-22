import crypto from 'crypto';

export function computeSha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export function computeAuditEntryHash(params: {
  previousHash: string;
  action: string;
  status: string;
  userId: string | null;
  documentId: string | null;
  timestamp: Date | string;
  reason: string | null;
}): string {
  const payload = [
    params.previousHash,
    params.action,
    params.status,
    params.userId || 'ANONYMOUS',
    params.documentId || 'NONE',
    new Date(params.timestamp).toISOString(),
    params.reason || 'NONE',
  ].join('|');

  return computeSha256(payload);
}
