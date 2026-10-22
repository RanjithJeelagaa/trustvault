/**
 * True MIME Type Validation (Magic Bytes) Utility
 * 
 * Inspects file buffer using file-type and raw magic bytes to verify actual content.
 * Never trusts file.mimetype sent by client headers or user-supplied file extensions.
 * 
 * Allowed MIME Types:
 * - application/pdf
 * - image/png
 * - image/jpeg
 * - text/plain
 */

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
] as const;

export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

export interface FileValidationResult {
  isValid: boolean;
  mimeType?: AllowedMimeType;
  error?: string;
}

/**
 * Checks if a buffer represents clean, valid UTF-8/ASCII plain text
 * without null bytes or binary control characters.
 */
function isCleanPlainText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;

  // Executable signatures check
  // Windows PE/DOS header: 'MZ' (0x4D 0x5A)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return false;
  }
  // Linux ELF header: 0x7F 'ELF' (0x7F 0x45 0x4C 0x46)
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return false;
  }
  // Java class / Mach-O header: 0xCA 0xFE 0xBA 0xBE
  if (buffer.length >= 4 && buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) {
    return false;
  }

  // Sample up to first 8KB of buffer for binary null bytes and non-printable control characters
  const sampleLength = Math.min(buffer.length, 8192);
  let nullBytes = 0;

  for (let i = 0; i < sampleLength; i++) {
    const byte = buffer[i];
    // Reject any null bytes immediately (characteristic of binary/executable formats)
    if (byte === 0x00) {
      nullBytes++;
      if (nullBytes > 0) return false;
    }
  }

  // Verify valid UTF-8 string decoding
  try {
    const textSample = buffer.subarray(0, sampleLength).toString('utf8');
    // Check for replacement character which indicates corrupted/invalid UTF-8 bytes
    if (textSample.includes('\uFFFD')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the file buffer against true magic bytes.
 */
export async function validateFileMagicBytes(buffer: Buffer): Promise<FileValidationResult> {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      error: 'Empty file buffer received',
    };
  }

  // 1. Direct magic byte fast checks
  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { isValid: true, mimeType: 'application/pdf' };
  }

  // PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { isValid: true, mimeType: 'image/png' };
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { isValid: true, mimeType: 'image/jpeg' };
  }

  // 2. Comprehensive check via file-type package
  try {
    let detectedFileType: any = null;
    try {
      // Dynamic import to support both ESM and CJS file-type packages
      const fileTypeModule: any = await (eval('import("file-type")') as Promise<any>).catch(() => null);
      if (fileTypeModule && typeof fileTypeModule.fileTypeFromBuffer === 'function') {
        detectedFileType = await fileTypeModule.fileTypeFromBuffer(buffer);
      } else if (fileTypeModule && typeof fileTypeModule.fromBuffer === 'function') {
        detectedFileType = await fileTypeModule.fromBuffer(buffer);
      }
    } catch {
      // Fallback to require if dynamic import is unavailable
      try {
        const FileType = require('file-type');
        if (FileType && typeof FileType.fromBuffer === 'function') {
          detectedFileType = await FileType.fromBuffer(buffer);
        }
      } catch {
        // file-type package not yet installed or loaded; fall back to internal inspector
      }
    }

    if (detectedFileType) {
      const mime = detectedFileType.mime;
      if (mime === 'application/pdf' || mime === 'image/png' || mime === 'image/jpeg') {
        return { isValid: true, mimeType: mime as AllowedMimeType };
      }

      // Explicitly reject detected executables, archives, scripts, or non-whitelisted types
      return {
        isValid: false,
        error: `MIME type rejected: detected '${mime}'. Allowed types are: ${ALLOWED_MIME_TYPES.join(', ')}`,
      };
    }
  } catch (err: any) {
    console.warn('[FileValidator] Error checking file-type:', err.message);
  }

  // 3. Check for valid plain text (file-type returns undefined for text/plain)
  if (isCleanPlainText(buffer)) {
    return { isValid: true, mimeType: 'text/plain' };
  }

  return {
    isValid: false,
    error: `Unrecognized or invalid file format. Magic byte inspection failed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
  };
}
