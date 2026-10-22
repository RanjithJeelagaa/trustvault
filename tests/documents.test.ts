import request from 'supertest';
import app from '../src/server';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import './setup';

const prisma = new PrismaClient();

describe('Phase 2: Document Security & Access Control Suite', () => {
  let adminToken: string;
  let ownerAToken: string;
  let ownerBToken: string;
  let viewerToken: string;

  let viewerUserId: string;
  let documentAId: string;

  // 1x1 Transparent PNG binary buffer
  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

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
});