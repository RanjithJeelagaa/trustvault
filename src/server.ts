import { app } from './app';
import { ENV } from './config/env';

let server: any = null;

// Only bind HTTP listener if not running within a test runner
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(ENV.PORT, () => {
    console.log(`====================================================`);
    console.log(`  TrustVault Secure Authorization Server Running     `);
    console.log(`  Environment: ${ENV.NODE_ENV}                       `);
    console.log(`  Port:        ${ENV.PORT}                           `);
    console.log(`  Storage:     ${ENV.STORAGE_DIR}                    `);
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
