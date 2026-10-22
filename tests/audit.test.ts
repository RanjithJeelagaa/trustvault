import request from 'supertest';
import app from '../src/server';
import { PrismaClient, AuditStatus } from '@prisma/client';
import {
  auditLogger,
  calculateAuditHash,
  verifyAuditChain,
  GENESIS_HASH,
} from '../src/utils/auditLogger';
import './setup';

const prisma = new PrismaClient();

describe('Phase 3: Cryptographic Hash-Chained Audit Trail & Admin Activity Viewer', () => {
  let adminToken: string;
  let ownerToken: string;
  let viewerToken: string;

  let adminUserId: string;
  let ownerUserId: string;
  let viewerUserId: string;

  let testDocId: string;

  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeAll(async () => {
    const login = async (email: string) => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'Password123!' });
      return res.body.token;
    };

    adminToken = await login('admin@trustvault.local');
    ownerToken = await login('owner_a@trustvault.local');
    viewerToken = await login('viewer@trustvault.local');

    const [adminUser, ownerUser, viewerUser] = await Promise.all([
      prisma.user.findUnique({ where: { email: 'admin@trustvault.local' } }),
      prisma.user.findUnique({ where: { email: 'owner_a@trustvault.local' } }),
      prisma.user.findUnique({ where: { email: 'viewer@trustvault.local' } }),
    ]);

    adminUserId = adminUser!.id;
    ownerUserId = ownerUser!.id;
    viewerUserId = viewerUser!.id;

    // Upload a test document to use across document audit tests
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('title', 'Audit Test Document')
      .field('category', 'Audit')
      .attach('file', validPngBuffer, 'audit_test.png');

    testDocId = uploadRes.body.document?.id || uploadRes.body.id;
  });

  describe('1. Cryptographic Hash-Chaining & Audit Utility', () => {
    it('should format genesis entry with 64-zero previousHash and valid currentHash', async () => {
      // Clear logs to verify genesis behavior deterministically
      await prisma.auditLog.deleteMany();

      const genesisLog = await auditLogger.log({
        userId: adminUserId,
        action: 'UPLOAD',
        documentId: testDocId,
        status: AuditStatus.SUCCESS,
        ipAddress: '127.0.0.1',
        userAgent: 'JestTest',
        reason: 'Genesis upload event',
      });

      expect(genesisLog.previousHash).toBe(GENESIS_HASH);
      expect(genesisLog.currentHash).toHaveLength(64);

      const expectedHash = calculateAuditHash({
        previousHash: GENESIS_HASH,
        timestamp: genesisLog.timestamp,
        userId: genesisLog.userId,
        action: genesisLog.action,
        documentId: genesisLog.documentId,
        status: genesisLog.status,
      });

      expect(genesisLog.currentHash).toBe(expectedHash);
    });

    it('should cryptographically chain subsequent entries by linking previousHash to currentHash', async () => {
      const secondLog = await auditLogger.log({
        userId: viewerUserId,
        action: 'ACCESS_DENIED',
        documentId: testDocId,
        status: AuditStatus.DENIED,
        ipAddress: '127.0.0.1',
        userAgent: 'JestTest',
        reason: 'Unauthorized access',
      });

      const firstLog = await prisma.auditLog.findFirst({
        orderBy: { timestamp: 'asc' },
      });

      expect(secondLog.previousHash).toBe(firstLog!.currentHash);

      const expectedSecondHash = calculateAuditHash({
        previousHash: secondLog.previousHash,
        timestamp: secondLog.timestamp,
        userId: secondLog.userId,
        action: secondLog.action,
        documentId: secondLog.documentId,
        status: secondLog.status,
      });

      expect(secondLog.currentHash).toBe(expectedSecondHash);

      // Verify the chain is currently valid
      const chainVerdict = await verifyAuditChain();
      expect(chainVerdict.isValid).toBe(true);
    });
  });

  describe('2. Document Operations & Authorization Denials Emit Chained Logs', () => {
    it('should create valid chain entries on successful and denied operations', async () => {
      // 1. Successful download by owner
      const downloadRes = await request(app)
        .get(`/api/documents/${testDocId}/download`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(downloadRes.status).toBe(200);

      // 2. Denied download by viewer (BOLA/IDOR attempt)
      const deniedRes = await request(app)
        .get(`/api/documents/${testDocId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(deniedRes.status).toBe(403);

      // 3. Successful metadata edit
      const editRes = await request(app)
        .put(`/api/documents/${testDocId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated Audit Title' });
      expect(editRes.status).toBe(200);

      // Verify chain integrity over all recorded logs
      const verdict = await verifyAuditChain();
      expect(verdict.isValid).toBe(true);

      // Check that the last entry has both previousHash and currentHash defined and valid
      const latestLog = await prisma.auditLog.findFirst({
        orderBy: { timestamp: 'desc' },
      });
      expect(latestLog?.currentHash).toBeDefined();
      expect(latestLog?.previousHash).toBeDefined();
    });
  });

  describe('3. Chain Integrity Verification & Historical Tamper Detection', () => {
    it('should detect when historical log attributes (e.g. status) are modified in the database', async () => {
      // Fetch an existing audit log from the chain
      const allLogs = await prisma.auditLog.findMany({
        orderBy: { timestamp: 'asc' },
      });
      expect(allLogs.length).toBeGreaterThanOrEqual(2);

      const targetLog = allLogs[0];

      // Simulate malicious insider modifying a historical record (flipping status or action)
      const originalStatus = targetLog.status;
      const tamperedStatus = originalStatus === AuditStatus.DENIED ? AuditStatus.SUCCESS : AuditStatus.DENIED;

      await prisma.auditLog.update({
        where: { id: targetLog.id },
        data: { status: tamperedStatus },
      });

      // Chain integrity verification MUST fail and identify the corrupted record
      const verdict = await verifyAuditChain();
      expect(verdict.isValid).toBe(false);
      expect(verdict.corruptedAtId).toBe(targetLog.id);

      // Restore original state
      await prisma.auditLog.update({
        where: { id: targetLog.id },
        data: { status: originalStatus },
      });

      const restoredVerdict = await verifyAuditChain();
      expect(restoredVerdict.isValid).toBe(true);
    });

    it('should detect when previousHash link is broken in the database', async () => {
      const allLogs = await prisma.auditLog.findMany({
        orderBy: { timestamp: 'asc' },
      });
      const secondLog = allLogs[1];

      const originalPreviousHash = secondLog.previousHash;
      const fakePreviousHash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

      await prisma.auditLog.update({
        where: { id: secondLog.id },
        data: { previousHash: fakePreviousHash },
      });

      const verdict = await verifyAuditChain();
      expect(verdict.isValid).toBe(false);
      expect(verdict.corruptedAtId).toBe(secondLog.id);

      // Restore original state
      await prisma.auditLog.update({
        where: { id: secondLog.id },
        data: { previousHash: originalPreviousHash },
      });

      const restoredVerdict = await verifyAuditChain();
      expect(restoredVerdict.isValid).toBe(true);
    });
  });

  describe('4. Admin Activity Viewer & Verify API Endpoints', () => {
    it('should forbid non-ADMIN users from accessing /api/admin/audit-logs (Returns 403)', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests to /api/admin/audit-logs (Returns 401)', async () => {
      const res = await request(app).get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
    });

    it('should allow ADMIN to retrieve paginated audit logs with metadata', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.logs[0].currentHash).toBeDefined();
      expect(res.body.logs[0].previousHash).toBeDefined();
    });

    it('should support search filtering by status, userId, and documentId', async () => {
      const res = await request(app)
        .get(`/api/admin/audit-logs?status=DENIED`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
      for (const log of res.body.logs) {
        expect(log.status).toBe('DENIED');
      }

      // Filter by documentId
      const docRes = await request(app)
        .get(`/api/admin/audit-logs?documentId=${testDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(docRes.status).toBe(200);
      for (const log of docRes.body.logs) {
        expect(log.documentId).toBe(testDocId);
      }
    });

    it('should allow ADMIN to trigger /api/admin/audit-logs/verify and return chain integrity status', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs/verify')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(true);
      expect(res.body.status).toBe('VERIFIED');
    });

    it('should report TAMPER_DETECTED on /api/admin/audit-logs/verify when a row is corrupted', async () => {
      const latestLog = await prisma.auditLog.findFirst({
        orderBy: { timestamp: 'desc' },
      });

      const originalAction = latestLog!.action;

      await prisma.auditLog.update({
        where: { id: latestLog!.id },
        data: { action: 'FORGED_ACTION' },
      });

      const res = await request(app)
        .get('/api/admin/audit-logs/verify')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(false);
      expect(res.body.corruptedAtId).toBe(latestLog!.id);
      expect(res.body.status).toBe('TAMPER_DETECTED');

      // Cleanup
      await prisma.auditLog.update({
        where: { id: latestLog!.id },
        data: { action: originalAction },
      });
    });
  });
});
