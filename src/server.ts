import { app } from './app';
import { ENV } from './config/env';

const server = app.listen(ENV.PORT, () => {
  console.log(`====================================================`);
  console.log(`  TrustVault Secure Authorization Server Running     `);
  console.log(`  Environment: ${ENV.NODE_ENV}                       `);
  console.log(`  Port:        ${ENV.PORT}                           `);
  console.log(`  Storage:     ${ENV.STORAGE_DIR}                    `);
  console.log(`====================================================`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
