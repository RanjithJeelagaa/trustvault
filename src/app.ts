import path from 'path';
import fs from 'fs';
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';

import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import documentRoutes from './routes/document.routes';
import auditRoutes from './routes/audit.routes';
import adminRoutes from './routes/admin.routes';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Application {
  const app = express();

  // Harden HTTP response headers (allow SPA assets)
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // Configure CORS
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Parse JSON payloads
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // NOTE: Architecture Rule 2 explicitly prohibits public static file mounts:
  // "Never expose direct file system paths or public URLs for document assets."
  // All assets must be streamed programmatically behind server authorization middleware.

  // Health and Readiness Check
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
      status: 'OK',
      service: 'TrustVault API',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API Endpoints (Mount at /api/documents as well as /api/v1/documents)
  app.use('/api/auth', authRoutes);
  app.use('/api/v1/auth', authRoutes);

  app.use('/api/users', userRoutes);
  app.use('/api/v1/users', userRoutes);

  app.use('/api/documents', documentRoutes);
  app.use('/api/v1/documents', documentRoutes);

  app.use('/api/audit', auditRoutes);
  app.use('/api/v1/audit', auditRoutes);

  app.use('/api/admin', adminRoutes);
  app.use('/api/v1/admin', adminRoutes);

  // Static frontend bundle serving & SPA wildcard catch-all route
  const clientDistPath = path.resolve(process.cwd(), 'client/dist');
  app.use(express.static(clientDistPath));

  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    const indexPath = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
