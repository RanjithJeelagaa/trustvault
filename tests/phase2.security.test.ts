import { AuditStatus, Role, AccessLevel } from '@prisma/client';
import { validateFileMagicBytes } from '../src/utils/fileValidator';
import { authorizeDocument } from '../src/middleware/authorizeDocument';
import { prisma } from '../src/db/prisma';
import { auditService } from '../src/services/audit.service';

jest.mock('../src/db/prisma', () => ({
  prisma: {
    document: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    permission: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../src/services/audit.service', () => ({
  auditService: {
    logSecurityEvent: jest.fn(),
  },
}));

describe('Phase 2: MIME Magic-Byte Validation & Granular Document RBAC', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('True MIME Type Magic-Byte Validation (fileValidator.ts)', () => {
    it('should validate valid PDF magic bytes regardless of file extension', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.7\n%some-pdf-binary-content-here');
      const result = await validateFileMagicBytes(pdfBuffer);

      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe('application/pdf');
    });

    it('should validate valid PNG magic bytes', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
      const result = await validateFileMagicBytes(pngBuffer);

      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe('image/png');
    });

    it('should validate valid JPEG magic bytes', async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const result = await validateFileMagicBytes(jpegBuffer);

      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('should validate clean UTF-8 text file as text/plain', async () => {
      const textBuffer = Buffer.from('Hello, this is a clean text document.\nWith multiple lines.');
      const result = await validateFileMagicBytes(textBuffer);

      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe('text/plain');
    });

    it('should reject Windows PE executable (MZ header) spoofed as PDF', async () => {
      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const result = await validateFileMagicBytes(exeBuffer);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject Linux ELF executable header', async () => {
      const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
      const result = await validateFileMagicBytes(elfBuffer);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject binary files with null bytes claiming to be plain text', async () => {
      const binaryWithNulls = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x00, 0x6f]); // "hell\0o"
      const result = await validateFileMagicBytes(binaryWithNulls);

      expect(result.isValid).toBe(false);
    });
  });

  describe('Granular Document Authorization Middleware (authorizeDocument.ts)', () => {
    const mockDocument = {
      id: 'doc-1234',
      title: 'Roadmap.pdf',
      ownerId: 'owner-id-1',
      storageKey: 'random-uuid-key.bin',
      mimeType: 'application/pdf',
      size: 1024,
      permissions: [],
    };

    it('should return 404 when document does not exist', async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValue(null);

      const req: any = {
        params: { id: 'non-existent' },
        user: { id: 'user-1', email: 'user@test.com', role: Role.VIEWER },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = authorizeDocument('READ');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Document not found' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow ADMIN full access to any document and action', async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValue(mockDocument);

      const req: any = {
        params: { id: mockDocument.id },
        user: { id: 'admin-id', email: 'admin@trustvault.local', role: Role.ADMIN },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = authorizeDocument('DELETE');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.document).toBe(mockDocument);
    });

    it('should allow Document Owner full access to their created document', async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValue(mockDocument);

      const req: any = {
        params: { id: mockDocument.id },
        user: { id: mockDocument.ownerId, email: 'owner@trustvault.local', role: Role.OWNER },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = authorizeDocument('EDIT');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.document).toBe(mockDocument);
    });

    it('should allow user with EDIT permission to READ document (EDIT implies READ)', async () => {
      const docWithPermission = {
        ...mockDocument,
        permissions: [
          {
            userId: 'collaborator-1',
            accessLevel: AccessLevel.EDIT,
          },
        ],
      };
      (prisma.document.findUnique as jest.Mock).mockResolvedValue(docWithPermission);

      const req: any = {
        params: { id: mockDocument.id },
        user: { id: 'collaborator-1', email: 'collab@trustvault.local', role: Role.VIEWER },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = authorizeDocument('READ');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.document).toBe(docWithPermission);
    });

    it('should deny EDIT request and emit DENIED audit log when user only has READ permission', async () => {
      const docWithReadPermission = {
        ...mockDocument,
        permissions: [
          {
            userId: 'reader-1',
            accessLevel: AccessLevel.READ,
          },
        ],
      };
      (prisma.document.findUnique as jest.Mock).mockResolvedValue(docWithReadPermission);

      const req: any = {
        params: { id: mockDocument.id },
        user: { id: 'reader-1', email: 'reader@trustvault.local', role: Role.VIEWER },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'TestAgent' },
        socket: {},
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = authorizeDocument('EDIT');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Access denied: insufficient document permissions',
      });
      expect(auditService.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_EDIT_DENIED',
          status: AuditStatus.DENIED,
          userId: 'reader-1',
          documentId: mockDocument.id,
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny DELETE request to non-owner/non-admin users and log DENIED audit event', async () => {
      const docWithEditPermission = {
        ...mockDocument,
        permissions: [
          {
            userId: 'editor-1',
            accessLevel: AccessLevel.EDIT,
          },
        ],
      };
      (prisma.document.findUnique as jest.Mock).mockResolvedValue(docWithEditPermission);

      const req: any = {
        params: { id: mockDocument.id },
        user: { id: 'editor-1', email: 'editor@trustvault.local', role: Role.VIEWER },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'TestAgent' },
        socket: {},
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = authorizeDocument('DELETE');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Access denied: insufficient document permissions',
      });
      expect(auditService.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_DELETE_DENIED',
          status: AuditStatus.DENIED,
          userId: 'editor-1',
          documentId: mockDocument.id,
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});
