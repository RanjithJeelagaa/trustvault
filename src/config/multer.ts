import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export const STORAGE_DOCUMENTS_DIR = path.resolve(process.cwd(), 'storage/documents');

// Ensure dedicated private storage directory exists
if (!fs.existsSync(STORAGE_DOCUMENTS_DIR)) {
  fs.mkdirSync(STORAGE_DOCUMENTS_DIR, { recursive: true });
}

// Configure disk storage using strictly random UUID filenames
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, STORAGE_DOCUMENTS_DIR);
  },
  filename: (_req, _file, cb) => {
    // Generate UUID filename to prevent path traversal and hide raw user filenames on disk
    const uuidFilename = uuidv4();
    cb(null, uuidFilename);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB maximum file size limit
  },
});
