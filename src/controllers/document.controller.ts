import { Response } from 'express';
import { AccessLevel, AuditStatus } from '@prisma/client';
import { z } from 'zod';
import { auditService } from '../services/audit.service';
import { documentService } from '../services/document.service';
import { storageService } from '../services/storage.service';
import { AuthenticatedRequest } from '../types';

const shareSchema = z.object({
  targetUserId: z.string().uuid(),
  accessLevel: z.nativeEnum(AccessLevel).default(AccessLevel.READ),
});

export class DocumentController {
  /**
   * Uploads and secures a document asset.
   */
  public async upload(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file asset uploaded' });
      return;
    }

    const title = req.body.title || req.file.originalname || 'Untitled Document';
    const description = req.body.description || null;

    const docMeta = await documentService.createDocument({
      title,
      description,
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype || 'application/octet-stream',
      ownerId: user.id,
    });

    await auditService.logSecurityEvent({
      action: 'DOCUMENT_UPLOAD',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      documentId: docMeta.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Uploaded document '${title}' (${docMeta.size} bytes)`,
    });

    // Returns ONLY sanitized metadata; never exposes storageKey or disk paths
    res.status(201).json({
      message: 'Document uploaded and secured successfully',
      document: docMeta,
    });
  }

  /**
   * Lists accessible documents for authenticated user.
   */
  public async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user!;
    const docs = await documentService.listDocumentsForUser(user.id, user.role);

    res.status(200).json({
      count: docs.length,
      documents: docs,
    });
  }

  /**
   * Reads sanitized metadata for a specific document.
   * Enforces server authorization middleware.
   */
  public async getMetadata(req: AuthenticatedRequest, res: Response): Promise<void> {
    const doc = req.document!;
    const user = req.user!;

    await auditService.logSecurityEvent({
      action: 'DOCUMENT_METADATA_READ',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Metadata read for document ${doc.id}`,
    });

    res.status(200).json({
      document: documentService.sanitize(doc),
    });
  }

  /**
   * Downloads or views document contents via server-controlled stream.
   * Enforces Architecture Rule 2: Never expose direct file system paths or public URLs.
   * Enforces Architecture Rule 3: Authorization middleware must run first.
   */
  public async download(req: AuthenticatedRequest, res: Response): Promise<void> {
    const doc = req.document!;
    const user = req.user!;

    await auditService.logSecurityEvent({
      action: 'DOCUMENT_DOWNLOAD',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `File streamed for document ${doc.id}`,
    });

    // Configure protective security headers
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', doc.size);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.title)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const fileStream = storageService.createReadStream(doc.storageKey);
    fileStream.on('error', (err) => {
      console.error('[Stream Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream document asset' });
      }
    });

    fileStream.pipe(res);
  }

  /**
   * Shares document with another user (ABAC grant).
   */
  public async share(req: AuthenticatedRequest, res: Response): Promise<void> {
    const doc = req.document!;
    const user = req.user!;

    const parseResult = shareSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid share payload', details: parseResult.error.format() });
      return;
    }

    const { targetUserId, accessLevel } = parseResult.data;

    const grant = await documentService.shareDocument({
      documentId: doc.id,
      targetUserId,
      accessLevel,
    });

    await auditService.logSecurityEvent({
      action: 'DOCUMENT_SHARED',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Granted ${accessLevel} permission on doc ${doc.id} to user ${targetUserId}`,
    });

    res.status(200).json({
      message: 'Document access permission granted successfully',
      permission: grant,
    });
  }

  /**
   * Deletes a document asset and its backing physical storage.
   */
  public async delete(req: AuthenticatedRequest, res: Response): Promise<void> {
    const doc = req.document!;
    const user = req.user!;

    await documentService.deleteDocument(doc.id);

    await auditService.logSecurityEvent({
      action: 'DOCUMENT_DELETE',
      status: AuditStatus.ALLOWED,
      userId: user.id,
      documentId: doc.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      reason: `Deleted document ${doc.id}`,
    });

    res.status(200).json({
      message: 'Document deleted successfully',
    });
  }
}

export const documentController = new DocumentController();
