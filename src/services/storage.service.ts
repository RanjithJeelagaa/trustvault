import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ENV } from '../config/env';

export class StorageService {
  private baseDir: string;

  constructor() {
    this.baseDir = ENV.STORAGE_DIR;
    this.ensureStorageDirExists();
  }

  private ensureStorageDirExists(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Resolves a sanitized physical path for an internal UUID storage key.
   * Enforces strict containment inside the base storage directory.
   */
  private getSecureFilePath(storageKey: string): string {
    // Sanitize: storageKey must strictly match UUID format to prevent path traversal
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(storageKey)) {
      throw new Error('Invalid storage key format');
    }

    const resolved = path.resolve(this.baseDir, `${storageKey}.bin`);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Storage path containment violation');
    }
    return resolved;
  }

  /**
   * Saves a buffer or stream to private storage and returns an opaque UUID storage key.
   */
  public async saveFile(buffer: Buffer): Promise<{ storageKey: string; size: number }> {
    const storageKey = uuidv4();
    const filePath = this.getSecureFilePath(storageKey);
    await fs.promises.writeFile(filePath, buffer);
    return {
      storageKey,
      size: buffer.length,
    };
  }

  /**
   * Returns a readable stream for a private document asset.
   * Callers pipe this to the HTTP response; direct file paths are never exposed to the client.
   */
  public createReadStream(storageKey: string): fs.ReadStream {
    const filePath = this.getSecureFilePath(storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error('Asset not found in storage vault');
    }
    return fs.createReadStream(filePath);
  }

  /**
   * Deletes a private asset file.
   */
  public async deleteFile(storageKey: string): Promise<void> {
    const filePath = this.getSecureFilePath(storageKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
}

export const storageService = new StorageService();
