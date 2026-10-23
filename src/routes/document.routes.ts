import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AccessLevel, AuditStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { upload, STORAGE_DOCUMENTS_DIR } from '../config/multer';
import { validateFileMagicBytes } from '../utils/fileValidator';
import { authenticate } from '../middleware/auth.middleware';
import { authorizeDocument } from '../middleware/authorizeDocument';
import { requireRoles } from '../middleware/authorize.middleware';
import { auditService } from '../services/audit.service';
import { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * Sanitizes document response to prevent leaking internal disk paths or storage keys.
 */
function sanitizeDoc(doc: any, currentUser?: any) {
  let userAccessLevel = null;
  let canView = false;
  let canEdit = false;
  let canShare = false;
  let canDelete = false;

  if (currentUser) {
    if (currentUser.role === Role.ADMIN) {
      userAccessLevel = 'ADMIN';
      canView = true;
      canEdit = true;
      canShare = true;
      canDelete = true;
    } else if (doc.ownerId === currentUser.id) {
      userAccessLevel = 'OWNER';
      canView = true;
      canEdit = true;
      canShare = true;
      canDelete = true;
    } else {
      const grant = doc.permissions?.find((p: any) => p.userId === currentUser.id);
      if (grant) {
        userAccessLevel = grant.accessLevel;
        canView = true;
        canEdit = grant.accessLevel === 'EDIT';
      }
    }
  }

  return {
    id: doc.id,
    title: doc.title,
    category: doc.category || null,
    originalName: doc.originalName || null,
    mimeType: doc.mimeType,
    size: doc.size,
    ownerId: doc.ownerId,
    ownerEmail: doc.owner?.email || null,
    userAccessLevel,
    canView,
    canEdit,
    canShare,
    canDelete,
    permissions: doc.permissions
      ? doc.permissions.map((p: any) => ({
          id: p.id,
          documentId: p.documentId,
          userId: p.userId,
          accessLevel: p.accessLevel,
          createdAt: p.createdAt,
          user: p.user ? { id: p.user.id, email: p.user.email, role: p.user.role } : undefined,
        }))
      : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Helper middleware ensuring only the Document Owner or an ADMIN can manage permissions or delete.
 */
async function requireOwnerOrAdmin(req: AuthenticatedRequest, res: Response, next: Function): Promise<void> {
  const documentId = req.params.id;
  const user = req.user!;

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (user.role !== Role.ADMIN && doc.ownerId !== user.id) {
    await auditService.logSecurityEvent({
      action: 'ACCESS_DENIED',
      status: AuditStatus.DENIED,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `User ${user.email} attempted owner/admin management on document ${doc.id}`,
    });

    res.status(403).json({
      error: 'Access denied: only document owner or admin can perform this action',
    });
    return;
  }

  req.document = doc;
  next();
}

const multiUpload = (req: any, res: any, next: any) => {
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'document', maxCount: 1 }])(req, res, (err: any) => {
    if (err) return next(err);
    if (!req.file && req.files) {
      req.file = req.files.file?.[0] || req.files.document?.[0];
    }
    next();
  });
};

const handleUpload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;

  if (!req.file) {
    res.status(400).json({ error: 'No file asset uploaded' });
    return;
  }

  const uploadedFilePath = req.file.path;

  try {
    // 1. Read file buffer for true MIME magic-byte validation
    const fileBuffer = await fs.promises.readFile(uploadedFilePath);

    // 2. Validate magic bytes (do NOT trust client file.mimetype or extension)
    const validation = await validateFileMagicBytes(fileBuffer);

    if (!validation.isValid) {
      // Unlink rejected file from private storage immediately
      if (fs.existsSync(uploadedFilePath)) {
        await fs.promises.unlink(uploadedFilePath);
      }

      await auditService.logSecurityEvent({
        action: 'ACCESS_DENIED',
        status: AuditStatus.DENIED,
        userId: user.id,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        reason: `Upload rejected: ${validation.error}`,
      });

      res.status(400).json({
        error: validation.error || 'Invalid file format: magic byte mismatch',
      });
      return;
    }

    // 3. Sanitize original filename (prevent path traversal / directory injection in headers)
    const sanitizedOriginalName = path.basename(req.file.originalname || 'document.bin');
    const title = req.body.title?.trim() || sanitizedOriginalName;
    const category = req.body.category?.trim() || 'General';

    // 4. Save document record in PostgreSQL
    // StorageKey is the random UUID filename generated by multer
    const document = await prisma.document.create({
      data: {
        title,
        category,
        originalName: sanitizedOriginalName,
        storageKey: req.file.filename,
        mimeType: validation.mimeType!,
        size: req.file.size,
        ownerId: user.id,
      },
    });

    // 5. Emit SUCCESS audit event
    await auditService.logSecurityEvent({
      action: 'UPLOAD',
      status: AuditStatus.SUCCESS,
      userId: user.id,
      documentId: document.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Uploaded '${title}' (${document.size} bytes) with verified MIME ${validation.mimeType}`,
    });

    const sanitized = sanitizeDoc(document);
    res.status(201).json({
      message: 'Document uploaded and verified successfully',
      ...sanitized,
      document: sanitized,
    });
  } catch (err: any) {
    // Clean up file if anything failed
    if (fs.existsSync(uploadedFilePath)) {
      await fs.promises.unlink(uploadedFilePath).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to process document upload', details: err.message });
  }
};

/**
 * POST /upload & POST /
 * Authenticated (Role: ADMIN or OWNER).
 * Validates magic bytes using fileValidator, saves file, creates Document record, and logs SUCCESS audit event.
 */
router.post(
  '/upload',
  authenticate,
  requireRoles(Role.ADMIN, Role.OWNER),
  multiUpload,
  handleUpload
);

router.post(
  '/',
  authenticate,
  requireRoles(Role.ADMIN, Role.OWNER),
  multiUpload,
  handleUpload
);

/**
 * GET /
 * Authenticated.
 * Returns all documents accessible to caller (owned, granted via Permission, or all if Admin).
 * Supports search query filters (title, category).
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const titleFilter = req.query.title as string | undefined;
  const categoryFilter = req.query.category as string | undefined;

  const whereClause: any = {};

  // Search query filters
  if (titleFilter) {
    whereClause.title = { contains: titleFilter, mode: 'insensitive' };
  }
  if (categoryFilter) {
    whereClause.category = { contains: categoryFilter, mode: 'insensitive' };
  }

  // Access constraints based on role
  if (user.role !== Role.ADMIN) {
    whereClause.OR = [
      { ownerId: user.id },
      { permissions: { some: { userId: user.id } } },
    ];
  }

  const documents = await prisma.document.findMany({
    where: whereClause,
    include: {
      owner: { select: { id: true, email: true, role: true } },
      permissions: {
        include: {
          user: { select: { id: true, email: true, role: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    count: documents.length,
    documents: documents.map((doc) => sanitizeDoc(doc, user)),
  });
});

/**
 * GET /users
 * Authenticated.
 * Returns registered users for permission delegation and sharing.
 */
router.get('/users', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
      },
      orderBy: { email: 'asc' },
    });
    res.status(200).json({ users });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve users', details: err.message });
  }
});

/**
 * GET /:id/download
 * Authenticated + authorizeDocument('READ').
 * Streams file safely using Node streams with proper Content-Disposition and sanitized filename.
 */
router.get(
  '/:id/download',
  authenticate,
  authorizeDocument('READ'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const doc = req.document!;
    const user = req.user!;

    const physicalPath = path.resolve(STORAGE_DOCUMENTS_DIR, doc.storageKey);

    // Verify containment inside dedicated private storage directory
    if (!physicalPath.startsWith(STORAGE_DOCUMENTS_DIR) || !fs.existsSync(physicalPath)) {
      res.status(404).json({ error: 'Underlying document file not found on disk' });
      return;
    }

    await auditService.logSecurityEvent({
      action: 'DOWNLOAD',
      status: AuditStatus.SUCCESS,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Document downloaded: ${doc.title}`,
    });

    const safeFilename = encodeURIComponent(doc.originalName || doc.title || 'document');

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', doc.size);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const stream = fs.createReadStream(physicalPath);
    stream.on('error', (err) => {
      console.error('[Stream Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming document' });
      }
    });
    stream.pipe(res);
  }
);

/**
 * GET /:id/view & GET /:id/preview
 * Authenticated + authorizeDocument('READ').
 * Streams file inline for viewing / previewing in browser or modal.
 */
const handleDocumentView = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const doc = req.document!;
  const user = req.user!;

  const physicalPath = path.resolve(STORAGE_DOCUMENTS_DIR, doc.storageKey);

  // Verify containment inside dedicated private storage directory
  if (!physicalPath.startsWith(STORAGE_DOCUMENTS_DIR) || !fs.existsSync(physicalPath)) {
    res.status(404).json({ error: 'Underlying document file not found on disk' });
    return;
  }

  await auditService.logSecurityEvent({
    action: 'VIEW',
    status: AuditStatus.SUCCESS,
    userId: user.id,
    documentId: doc.id,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    reason: `Document viewed/previewed: ${doc.title}`,
  });

  const safeFilename = encodeURIComponent(doc.originalName || doc.title || 'document');

  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Length', doc.size);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const stream = fs.createReadStream(physicalPath);
  stream.on('error', (err) => {
    console.error('[Stream Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error streaming document' });
    }
  });
  stream.pipe(res);
};

router.get('/:id/view', authenticate, authorizeDocument('READ'), handleDocumentView);
router.get('/:id/preview', authenticate, authorizeDocument('READ'), handleDocumentView);

/**
 * PUT /:id
 * Authenticated + authorizeDocument('EDIT').
 * Updates title and/or category.
 */
router.put(
  '/:id',
  authenticate,
  authorizeDocument('EDIT'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const doc = req.document!;
    const user = req.user!;

    const updateSchema = z.object({
      title: z.string().min(1).optional(),
      category: z.string().optional(),
    });

    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid update body', details: parseResult.error.format() });
      return;
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        ...(parseResult.data.title && { title: parseResult.data.title.trim() }),
        ...(parseResult.data.category !== undefined && { category: parseResult.data.category.trim() }),
      },
    });

    await auditService.logSecurityEvent({
      action: 'EDIT',
      status: AuditStatus.SUCCESS,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Document updated: title/category`,
    });

    res.status(200).json({
      message: 'Document updated successfully',
      document: sanitizeDoc(updated),
    });
  }
);

/**
 * DELETE /:id
 * Authenticated + authorizeDocument('DELETE') (Owner or Admin only).
 * Unlinks the physical file and deletes the record.
 */
router.delete(
  '/:id',
  authenticate,
  authorizeDocument('DELETE'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const doc = req.document!;
    const user = req.user!;

    const physicalPath = path.resolve(STORAGE_DOCUMENTS_DIR, doc.storageKey);

    // Unlink file from disk
    if (fs.existsSync(physicalPath)) {
      try {
        await fs.promises.unlink(physicalPath);
      } catch (err: any) {
        console.warn(`[Delete Warning] Failed to delete disk file ${physicalPath}:`, err.message);
      }
    }

    // Delete record from database (cascade deletes permissions)
    await prisma.document.delete({
      where: { id: doc.id },
    });

    await auditService.logSecurityEvent({
      action: 'DELETE',
      status: AuditStatus.SUCCESS,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Document deleted: ${doc.id}`,
    });

    res.status(200).json({
      message: 'Document deleted successfully',
    });
  }
);

/**
 * GET /:id/permissions & GET /:id/access
 * Authenticated (Owner or Admin only).
 * Lists all active permissions for this document.
 */
const getPermissionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const doc = req.document!;

  const permissions = await prisma.permission.findMany({
    where: { documentId: doc.id },
    include: {
      user: {
        select: { id: true, email: true, role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    documentId: doc.id,
    permissions,
    access: permissions,
  });
};

router.get('/:id/permissions', authenticate, requireOwnerOrAdmin, getPermissionsHandler);
router.get('/:id/access', authenticate, requireOwnerOrAdmin, getPermissionsHandler);

/**
 * POST /:id/permissions & POST /:id/access
 * Authenticated (Owner or Admin only).
 * Grants READ or EDIT permission to another user or multiple users (batch insert).
 */
const grantPermissionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const doc = req.document!;
  const user = req.user!;

  const defaultRawLevel = (req.body.permission || req.body.accessLevel || 'READ').toString().trim().toUpperCase();
  const defaultLevel: AccessLevel = defaultRawLevel === 'EDIT' ? AccessLevel.EDIT : AccessLevel.READ;

  let targets: Array<{ email?: string; userId?: string; accessLevel: AccessLevel }> = [];

  if (Array.isArray(req.body.users)) {
    targets = req.body.users.map((u: any) => ({
      email: u.email ? u.email.trim().toLowerCase() : undefined,
      userId: u.userId || u.id,
      accessLevel: (u.accessLevel || u.permission || defaultLevel).toString().toUpperCase() === 'EDIT' ? AccessLevel.EDIT : AccessLevel.READ,
    }));
  } else if (Array.isArray(req.body.emails) || Array.isArray(req.body.userEmails)) {
    const emailsList = req.body.emails || req.body.userEmails;
    targets = emailsList.map((e: string) => ({
      email: e.trim().toLowerCase(),
      accessLevel: defaultLevel,
    }));
  } else if (Array.isArray(req.body.userIds)) {
    targets = req.body.userIds.map((uid: string) => ({
      userId: uid,
      accessLevel: defaultLevel,
    }));
  } else {
    const email = (req.body.userEmail || req.body.email || '').toString().trim().toLowerCase();
    const userId = (req.body.userId || '').toString().trim();
    if (email || userId) {
      targets.push({ email: email || undefined, userId: userId || undefined, accessLevel: defaultLevel });
    }
  }

  if (targets.length === 0) {
    res.status(400).json({
      error: 'Invalid permission payload: userEmail/email and permission/accessLevel (READ or EDIT) are required',
    });
    return;
  }

  const results = [];
  for (const target of targets) {
    let targetUser = null;
    if (target.userId) {
      targetUser = await prisma.user.findUnique({ where: { id: target.userId } });
    } else if (target.email) {
      targetUser = await prisma.user.findUnique({ where: { email: target.email } });
    }

    if (!targetUser) {
      continue;
    }

    const permission = await prisma.permission.upsert({
      where: {
        documentId_userId: {
          documentId: doc.id,
          userId: targetUser.id,
        },
      },
      update: {
        accessLevel: target.accessLevel,
      },
      create: {
        documentId: doc.id,
        userId: targetUser.id,
        accessLevel: target.accessLevel,
      },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    await auditService.logSecurityEvent({
      action: 'GRANT',
      status: AuditStatus.SUCCESS,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Granted ${target.accessLevel} permission on document ${doc.id} to user ${targetUser.email}`,
    });

    results.push(permission);
  }

  if (results.length === 0 && targets.length === 1 && targets[0].email) {
    res.status(404).json({ error: `User with email '${targets[0].email}' not found` });
    return;
  }

  const isAccessRoute = req.originalUrl?.includes('/access') || req.path?.includes('/access');
  const message = isAccessRoute
    ? `Access granted to ${results.length} user(s) successfully`
    : (results.length === 1 ? 'Permission granted successfully' : `Access granted to ${results.length} user(s) successfully`);

  res.status(200).json({
    message,
    permission: results[0] || null,
    permissions: results,
  });
};

router.post('/:id/permissions', authenticate, requireOwnerOrAdmin, grantPermissionsHandler);
router.post('/:id/access', authenticate, requireOwnerOrAdmin, grantPermissionsHandler);

/**
 * DELETE /:id/permissions/:userId & DELETE /:id/access/:userId
 * Authenticated (Owner or Admin only).
 * Revokes a user's document permission immediately.
 */
const revokePermissionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const doc = req.document!;
  const user = req.user!;
  const targetUserId = req.params.userId;

  const deleteResult = await prisma.permission.deleteMany({
    where: {
      documentId: doc.id,
      userId: targetUserId,
    },
  });

  if (deleteResult.count === 0) {
    res.status(404).json({ error: 'Permission grant not found for specified user' });
    return;
  }

  await auditService.logSecurityEvent({
    action: 'REVOKE',
    status: AuditStatus.SUCCESS,
    userId: user.id,
    documentId: doc.id,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    reason: `Revoked permission on document ${doc.id} for user ${targetUserId}`,
  });

  res.status(200).json({
    message: 'Document permission revoked successfully',
  });
};

router.delete('/:id/permissions/:userId', authenticate, requireOwnerOrAdmin, revokePermissionsHandler);
router.delete('/:id/access/:userId', authenticate, requireOwnerOrAdmin, revokePermissionsHandler);

export default router;
