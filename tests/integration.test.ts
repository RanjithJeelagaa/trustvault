import request from 'supertest';
import jwt from 'jsonwebtoken';
import { AuditStatus, Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { ENV } from '../src/config/env';

jest.mock('../src/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    revokedToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    document: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    permission: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

describe('TrustVault HTTP Authorization & Middleware Integration', () => {
  const app = createApp();

  const mockViewerToken = jwt.sign(
    {
      id: 'viewer-uuid-1',
      email: 'viewer@trustvault.local',
      role: Role.VIEWER,
      jti: 'jti-viewer-1234',
    },
    ENV.JWT_SECRET,
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Directive 4: should reject request with 401 if token is marked revoked in database', async () => {
    // Database returns token as revoked
    (prisma.revokedToken.findUnique as jest.Mock).mockResolvedValue({
      id: 'revoked-entry-1',
      jti: 'jti-viewer-1234',
      userId: 'viewer-uuid-1',
    });
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'audit-log-1' });

    const res = await request(app)
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${mockViewerToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Token has been revoked');
    expect(prisma.revokedToken.findUnique).toHaveBeenCalledWith({
      where: { jti: 'jti-viewer-1234' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'AUTHENTICATION_REVOKED_TOKEN',
          status: AuditStatus.DENIED,
        }),
      })
    );
  });

  it('Directive 3 & 5: should emit DENIED audit log and return 403 when Viewer attempts unauthorized download', async () => {
    // Token is valid and not revoked
    (prisma.revokedToken.findUnique as jest.Mock).mockResolvedValue(null);

    // Document belongs to another user (Owner), viewer has no permissions
    (prisma.document.findUnique as jest.Mock).mockResolvedValue({
      id: 'doc-private-100',
      title: 'Secret_Blueprint.pdf',
      ownerId: 'owner-uuid-999', // Different owner
      storageKey: 'd3b07384-d113-4672-8812-42173160a221',
      mimeType: 'application/pdf',
      size: 1024,
      permissions: [], // No explicit grants to viewer
    });

    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'audit-log-2' });

    const res = await request(app)
      .get('/api/v1/documents/doc-private-100/download')
      .set('Authorization', `Bearer ${mockViewerToken}`);

    // BOLA protection triggers 403
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('insufficient document permissions');

    // Rule 5: DENIED audit log must have been created BEFORE returning 403
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'READ',
          status: AuditStatus.DENIED,
          userId: 'viewer-uuid-1',
          documentId: 'doc-private-100',
        }),
      })
    );
  });
});
