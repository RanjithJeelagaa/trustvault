import { Router } from 'express';
import { Role } from '@prisma/client';
import { auditController } from '../controllers/audit.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/authorize.middleware';

const router = Router();

// Retrieve audit logs (Admin only)
router.get('/', authenticate, requireRoles(Role.ADMIN), (req, res, next) => {
  auditController.listLogs(req, res).catch(next);
});

// Verify cryptographic hash chain integrity (Admin only)
router.get('/verify', authenticate, requireRoles(Role.ADMIN), (req, res, next) => {
  auditController.verifyIntegrity(req, res).catch(next);
});

export default router;
