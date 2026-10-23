import request from 'supertest';
import app from '../src/server';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { seed } from '../seed';
import { REALISTIC_RECEIPT_PNG } from '../src/utils/sampleImages';
import './setup';

const prisma = new PrismaClient();

describe('Phase 2: Document Security & Access Control Suite', () => {
  jest.setTimeout(25000);
  let adminToken: string;
  let ownerAToken: string;
  let ownerBToken: string;
  let viewerToken: string;

  let viewerUserId: string;
  let documentAId: string;

  // Realistic sample PNG binary buffer (>100 bytes, visible in preview)
  const validPngBuffer = REALISTIC_RECEIPT_PNG;

  // Fake executable disguised as a PDF
  const fakePdfBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00This is an executable disguised as PDF');

  beforeAll(async () => {
    // Authenticate and grab tokens for all personas
    const loginUser = async (email: string) => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'Password123!' });
      return res.body.token;
    };

    adminToken = await loginUser('admin@trustvault.local');
    ownerAToken = await loginUser('owner_a@trustvault.local');
    ownerBToken = await loginUser('owner_b@trustvault.local');
    viewerToken = await loginUser('viewer@trustvault.local');

    const viewerUser = await prisma.user.findUnique({
      where: { email: 'viewer@trustvault.local' },
    });
    viewerUserId = viewerUser!.id;
  });

  describe('1. File Upload & Magic-Byte Validation', () => {
    it('should reject a spoofed executable disguised with a .pdf extension', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .attach('file', fakePdfBuffer, 'exploit.pdf');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid file format|magic byte mismatch/i);
    });

    it('should successfully upload a legitimate binary matching magic bytes', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .field('title', 'Quarterly Financials')
        .field('category', 'Finance')
        .attach('file', validPngBuffer, 'valid_receipt.png');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      documentAId = res.body.id;

      // Verify physical disk file does not retain original filename
      const diskFilename = res.body.filePath;
      if (diskFilename) {
        expect(diskFilename).not.toContain('valid_receipt.png');
      }
    });

    it('should forbid a VIEWER from uploading documents', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${viewerToken}`)
        .attach('file', validPngBuffer, 'viewer_attempt.png');

      expect(res.status).toBe(403);
    });
  });

  describe('2. IDOR Defenses & Document Download Authorizations', () => {
    it('should block Owner B from downloading Owner A document via IDOR (Returns 403 & Logs DENIED)', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentAId}/download`)
        .set('Authorization', `Bearer ${ownerBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('insufficient document permissions');

      // Verify audit log captured the failed attempt
      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          documentId: documentAId,
          status: 'DENIED',
          action: 'READ',
        },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('should block unauthenticated callers from downloading documents (Returns 401)', async () => {
      const res = await request(app).get(`/api/documents/${documentAId}/download`);
      expect(res.status).toBe(401);
    });

    it('should permit Admin to access any document regardless of ownership', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentAId}/download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
    });
  });

  describe('3. Dynamic Permission Grant and Revocation Cycle', () => {
    it('should deny Viewer access before permission is granted', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentAId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });

    it('should allow Owner A to grant READ access to Viewer', async () => {
      const res = await request(app)
        .post(`/api/documents/${documentAId}/permissions`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          userEmail: 'viewer@trustvault.local',
          permission: 'READ',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/permission granted/i);
    });

    it('should allow Viewer to download the document after permission grant', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentAId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
    });

    it('should prevent Viewer with only READ access from modifying document metadata', async () => {
      const res = await request(app)
        .put(`/api/documents/${documentAId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Tampered Title' });

      expect(res.status).toBe(403);
    });

    it('should immediately revoke access when Owner A deletes the permission entry', async () => {
      // Owner revokes permission
      const revokeRes = await request(app)
        .delete(`/api/documents/${documentAId}/permissions/${viewerUserId}`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(revokeRes.status).toBe(200);

      // Subsequent read by Viewer must fail immediately
      const downloadRes = await request(app)
        .get(`/api/documents/${documentAId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(downloadRes.status).toBe(403);
    });
  });

  describe('4. Direct /api/documents and /access Endpoints with Batch Sharing', () => {
    let directUploadDocId: string;

    it('should allow upload directly to POST /api/documents (root endpoint)', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .field('title', 'Engineering Architecture Specs')
        .field('category', 'Engineering')
        .attach('file', validPngBuffer, 'specs.png');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe('Engineering Architecture Specs');
      expect(res.body.category).toBe('Engineering');
      directUploadDocId = res.body.id;
    });

    it('should retrieve list of registered users via GET /api/documents/users', async () => {
      const res = await request(app)
        .get('/api/documents/users')
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThanOrEqual(3);
      expect(res.body.users[0]).toHaveProperty('email');
      expect(res.body.users[0]).toHaveProperty('role');
    });

    it('should grant access to multiple users in batch via POST /api/documents/:id/access', async () => {
      const res = await request(app)
        .post(`/api/documents/${directUploadDocId}/access`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          emails: ['viewer@trustvault.local', 'owner_b@trustvault.local'],
          accessLevel: 'READ',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/access granted/i);
      expect(res.body.permissions.length).toBe(2);
    });

    it('should list currently granted users via GET /api/documents/:id/access', async () => {
      const res = await request(app)
        .get(`/api/documents/${directUploadDocId}/access`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.permissions)).toBe(true);
      expect(res.body.permissions.length).toBe(2);
      const emails = res.body.permissions.map((p: any) => p.user?.email);
      expect(emails).toContain('viewer@trustvault.local');
      expect(emails).toContain('owner_b@trustvault.local');
    });

    it('should allow permitted viewer to download document after batch grant', async () => {
      const res = await request(app)
        .get(`/api/documents/${directUploadDocId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
    });

    it('should revoke access via DELETE /api/documents/:id/access/:userId', async () => {
      const revokeRes = await request(app)
        .delete(`/api/documents/${directUploadDocId}/access/${viewerUserId}`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(revokeRes.status).toBe(200);

      // Verify immediate 403 on subsequent download
      const verifyRes = await request(app)
        .get(`/api/documents/${directUploadDocId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(verifyRes.status).toBe(403);
    });
  });

  describe('5. Granular Persona Switcher, Users API, and Granular Permission Matrix', () => {
    beforeAll(async () => {
      await seed();
    });

    it('should retrieve registered users list via GET /api/users', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      const emails = res.body.users.map((u: any) => u.email);
      expect(emails).toContain('admin@trustvault.local');
      expect(emails).toContain('23@gmail.com');
    });

    it('should allow ADMIN to switch persona via POST /api/auth/switch-persona', async () => {
      const res = await request(app)
        .post('/api/auth/switch-persona')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: '23@gmail.com' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe('23@gmail.com');
      expect(res.body.user.role).toBe('VIEWER');
    });

    it('should forbid VIEWER from switching persona (returns 403)', async () => {
      const res = await request(app)
        .post('/api/auth/switch-persona')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ email: 'admin@trustvault.local' });

      expect(res.status).toBe(403);
    });

    it('should support inline viewing via GET /api/documents/:id/view', async () => {
      // Find a seeded document
      const doc = await prisma.document.findFirst({
        where: { title: 'General Employee Handbook.pdf' },
      });
      expect(doc).toBeDefined();

      const res = await request(app)
        .get(`/api/documents/${doc!.id}/view`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/inline/);
    });

    it('should support inline previewing via GET /api/documents/:id/preview', async () => {
      // Find seeded image document
      const doc = await prisma.document.findFirst({
        where: { title: 'Store Receipt - Cloud Infrastructure.png' },
      });
      expect(doc).toBeDefined();

      const res = await request(app)
        .get(`/api/documents/${doc!.id}/preview`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/inline/);
      expect(res.headers['content-type']).toMatch(/image\/png/);
      expect(parseInt(res.headers['content-length'])).toBeGreaterThan(100);
    });

    it('should verify sample documents seeded permissions matrix', async () => {
      // 1. "Q3 Financial Audit Report.pdf": Viewer has VIEW access
      const auditDoc = await prisma.document.findFirst({
        where: { title: 'Q3 Financial Audit Report.pdf' },
      });
      expect(auditDoc).toBeDefined();

      const viewerAuditRes = await request(app)
        .get(`/api/documents/${auditDoc!.id}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerAuditRes.status).toBe(200);

      // Viewer cannot EDIT it
      const viewerAuditEditRes = await request(app)
        .put(`/api/documents/${auditDoc!.id}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Tampered Audit' });
      expect(viewerAuditEditRes.status).toBe(403);

      // 2. "System Architecture Blueprint.png": 23@gmail.com has EDIT access
      const user23 = await prisma.user.findUnique({ where: { email: '23@gmail.com' } });
      expect(user23).toBeDefined();

      // Login or switch to 23@gmail.com
      const switchRes = await request(app)
        .post('/api/auth/switch-persona')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: '23@gmail.com' });
      const user23Token = switchRes.body.token;

      const blueprintDoc = await prisma.document.findFirst({
        where: { title: 'System Architecture Blueprint.png' },
      });
      expect(blueprintDoc).toBeDefined();

      const user23EditRes = await request(app)
        .put(`/api/documents/${blueprintDoc!.id}`)
        .set('Authorization', `Bearer ${user23Token}`)
        .send({ title: 'System Architecture Blueprint - Updated' });
      expect(user23EditRes.status).toBe(200);

      // 3. "Confidential Legal Settlement.docx": Restricted (only Admin & Owner)
      const legalDoc = await prisma.document.findFirst({
        where: { title: 'Confidential Legal Settlement.docx' },
      });
      expect(legalDoc).toBeDefined();

      const viewerLegalRes = await request(app)
        .get(`/api/documents/${legalDoc!.id}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerLegalRes.status).toBe(403);
    });
  });
});