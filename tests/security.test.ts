import { AuditStatus, Role, AccessLevel } from '@prisma/client';
import { computeAuditEntryHash, computeSha256 } from '../src/utils/crypto';
import { documentService } from '../src/services/document.service';
import { auditService, GENESIS_HASH } from '../src/services/audit.service';
import { authService } from '../src/services/auth.service';
import { prisma } from '../src/db/prisma';

// Mock Prisma for deterministic unit testing of security rules
jest.mock('../src/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    revokedToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    document: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    permission: {
      upsert: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe('TrustVault Security Architecture Directives', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rule 2: Never expose direct file system paths or public URLs', () => {
    it('should sanitize document objects and strip internal storageKey and disk paths', () => {
      const rawDocument = {
        id: '11111111-1111-1111-1111-111111111111',
        title: 'Financial_Q3.pdf',
        description: 'Confidential executive report',
        storageKey: 'd3b07384-d113-4672-8812-42173160a221',
        mimeType: 'application/pdf',
        size: 2048576,
        ownerId: '22222222-2222-2222-2222-222222222222',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const sanitized = documentService.sanitize(rawDocument);

      expect(sanitized).not.toHaveProperty('storageKey');
      expect(sanitized).not.toHaveProperty('filePath');
      expect(sanitized).not.toHaveProperty('path');
      expect(sanitized.id).toBe(rawDocument.id);
      expect(sanitized.title).toBe(rawDocument.title);
      expect(sanitized.size).toBe(rawDocument.size);
    });
  });

  describe('Rule 4: Token revocation must be verified against the database on every authenticated request', () => {
    it('should query the database for token revocation and reject revoked token jti', async () => {
      const testJti = 'test-jti-uuid-4444';

      (prisma.revokedToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'revoked-id-1',
        jti: testJti,
        userId: 'user-1',
        reason: 'User logout',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      const isRevoked = await authService.isTokenRevoked(testJti);

      expect(prisma.revokedToken.findUnique).toHaveBeenCalledWith({
        where: { jti: testJti },
      });
      expect(isRevoked).toBe(true);
    });

    it('should return false if token jti is not in the revoked tokens database table', async () => {
      const validJti = 'valid-jti-uuid-5555';
      (prisma.revokedToken.findUnique as jest.Mock).mockResolvedValue(null);

      const isRevoked = await authService.isTokenRevoked(validJti);

      expect(prisma.revokedToken.findUnique).toHaveBeenCalledWith({
        where: { jti: validJti },
      });
      expect(isRevoked).toBe(false);
    });
  });

  describe('Rule 5: All security checks that fail must emit a DENIED audit log before returning HTTP 403', () => {
    it('should emit a DENIED audit log with correct context when access is blocked', async () => {
      (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.auditLog.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: 'log-1', ...data }));

      await auditService.logSecurityEvent({
        action: 'DOCUMENT_READ_DENIED',
        status: AuditStatus.DENIED,
        userId: 'viewer-id-999',
        documentId: 'doc-id-888',
        reason: 'User lacks READ permission on target document',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const callData = (prisma.auditLog.create as jest.Mock).mock.calls[0][0].data;

      expect(callData.action).toBe('DOCUMENT_READ_DENIED');
      expect(callData.status).toBe(AuditStatus.DENIED);
      expect(callData.userId).toBe('viewer-id-999');
      expect(callData.documentId).toBe('doc-id-888');
      expect(callData.reason).toContain('User lacks READ permission');
      expect(callData.previousHash).toBe(GENESIS_HASH);
      expect(callData.entryHash).toBeDefined();
    });
  });

  describe('Threat Mitigation: Audit Tampering & Cryptographic Hash Chaining', () => {
    it('should detect unauthorized tampering if any record or hash in the chain is modified', async () => {
      const timestamp1 = new Date('2026-10-21T10:00:00Z');
      const hash1 = computeAuditEntryHash({
        previousHash: GENESIS_HASH,
        action: 'DOCUMENT_UPLOAD',
        status: AuditStatus.SUCCESS,
        userId: 'user-1',
        documentId: 'doc-1',
        timestamp: timestamp1,
        reason: 'Initial upload',
      });

      const timestamp2 = new Date('2026-10-21T10:05:00Z');
      const hash2 = computeAuditEntryHash({
        previousHash: hash1,
        action: 'DOCUMENT_READ_DENIED',
        status: AuditStatus.DENIED,
        userId: 'user-2',
        documentId: 'doc-1',
        timestamp: timestamp2,
        reason: 'Access denied',
      });

      const validChain = [
        {
          id: 'log-1',
          action: 'DOCUMENT_UPLOAD',
          status: AuditStatus.SUCCESS,
          userId: 'user-1',
          documentId: 'doc-1',
          timestamp: timestamp1,
          reason: 'Initial upload',
          previousHash: GENESIS_HASH,
          entryHash: hash1,
        },
        {
          id: 'log-2',
          action: 'DOCUMENT_READ_DENIED',
          status: AuditStatus.DENIED,
          userId: 'user-2',
          documentId: 'doc-1',
          timestamp: timestamp2,
          reason: 'Access denied',
          previousHash: hash1,
          entryHash: hash2,
        },
      ];

      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue(validChain);
      const verifyResult = await auditService.verifyChainIntegrity();
      expect(verifyResult.isValid).toBe(true);
      expect(verifyResult.totalVerified).toBe(2);

      // Now simulate attacker tampering with log-2 (changing DENIED to ALLOWED)
      const tamperedChain = [
        validChain[0],
        {
          ...validChain[1],
          status: AuditStatus.SUCCESS, // Tampered attribute!
        },
      ];

      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue(tamperedChain);
      const tamperedResult = await auditService.verifyChainIntegrity();
      expect(tamperedResult.isValid).toBe(false);
      expect(tamperedResult.corruptedEntryId).toBe('log-2');
      expect(tamperedResult.details).toContain('Content has been modified');
    });
  });
});
