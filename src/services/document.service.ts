import { AccessLevel, Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { storageService } from './storage.service';

export interface DocumentMetadataDTO {
  id: string;
  title: string;
  description: string | null;
  mimeType: string;
  size: number;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class DocumentService {
  /**
   * Sanitizes internal Document database records to prevent leaking storage keys or internal paths.
   * Architecture Rule 2: Never expose direct file system paths or public URLs for document assets.
   */
  public sanitize(doc: any): DocumentMetadataDTO {
    return {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      mimeType: doc.mimeType,
      size: doc.size,
      ownerId: doc.ownerId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Creates a new document from uploaded file buffer and registers metadata in PostgreSQL.
   */
  public async createDocument(params: {
    title: string;
    description?: string;
    fileBuffer: Buffer;
    mimeType: string;
    ownerId: string;
  }): Promise<DocumentMetadataDTO> {
    const { storageKey, size } = await storageService.saveFile(params.fileBuffer);

    const doc = await prisma.document.create({
      data: {
        title: params.title,
        description: params.description || null,
        storageKey,
        mimeType: params.mimeType,
        size,
        ownerId: params.ownerId,
      },
    });

    return this.sanitize(doc);
  }

  /**
   * Retrieves raw document database record (including internal storageKey for backend streaming).
   */
  public async getRawDocumentById(id: string) {
    return await prisma.document.findUnique({
      where: { id },
      include: {
        permissions: true,
      },
    });
  }

  /**
   * Lists accessible documents for a user based on RBAC and ABAC.
   */
  public async listDocumentsForUser(userId: string, role: Role): Promise<DocumentMetadataDTO[]> {
    if (role === Role.ADMIN) {
      const allDocs = await prisma.document.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return allDocs.map((doc) => this.sanitize(doc));
    }

    const docs = await prisma.document.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { permissions: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return docs.map((doc) => this.sanitize(doc));
  }

  /**
   * Grants access permissions on a document to another user (ABAC).
   */
  public async shareDocument(params: {
    documentId: string;
    targetUserId: string;
    accessLevel: AccessLevel;
  }) {
    return await prisma.permission.upsert({
      where: {
        documentId_userId: {
          documentId: params.documentId,
          userId: params.targetUserId,
        },
      },
      update: {
        accessLevel: params.accessLevel,
      },
      create: {
        documentId: params.documentId,
        userId: params.targetUserId,
        accessLevel: params.accessLevel,
      },
    });
  }

  /**
   * Deletes a document both physically from private storage and logically from the DB.
   */
  public async deleteDocument(id: string): Promise<void> {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (doc) {
      await storageService.deleteFile(doc.storageKey);
      await prisma.document.delete({ where: { id } });
    }
  }
}

export const documentService = new DocumentService();
