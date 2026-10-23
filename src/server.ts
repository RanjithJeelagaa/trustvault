import path from 'path';
import fs from 'fs';
import express, { Request, Response } from 'express';
import { app } from './app';
import { ENV } from './config/env';

// Configure Express to serve the static frontend bundle from client/dist in production
const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));

  // Client-side SPA routing fallback for non-API requests
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

let server: any = null;

// Only bind HTTP listener if not running within a test runner
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(ENV.PORT, () => {
    console.log(`====================================================`);
    console.log(`  TrustVault Secure Authorization Server Running     `);
    console.log(`  Environment: ${ENV.NODE_ENV}                       `);
    console.log(`  Port:        ${ENV.PORT}                           `);
    console.log(`  Storage:     ${ENV.STORAGE_DIR}                    `);
    if (fs.existsSync(clientDist)) {
      console.log(`  Frontend:    Mounted from ${clientDist}           `);
    }
    console.log(`====================================================`);
  });

  process.on('SIGTERM', () => {
    if (server) {
      server.close(() => {
        console.log('HTTP server closed');
      });
    }
  });

  process.on('SIGINT', () => {
    if (server) {
      server.close(() => {
        console.log('HTTP server closed');
      });
    }
  });
}

export { app };
export default app;
