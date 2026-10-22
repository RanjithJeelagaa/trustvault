import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/trustvault?schema=public',
  JWT_SECRET: process.env.JWT_SECRET || 'trustvault-super-secure-jwt-secret-key-32-chars-minimum',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
  STORAGE_DIR: path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage/vault'),
};
