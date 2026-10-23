import { Router } from 'express';
import { Role } from '@prisma/client';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/authorize.middleware';

const router = Router();

// Public Authentication
router.post('/register', (req, res, next) => {
  authController.register(req, res).catch(next);
});

router.post('/login', (req, res, next) => {
  authController.login(req, res).catch(next);
});

// Authenticated Session Endpoints
router.post('/logout', authenticate, (req, res, next) => {
  authController.logout(req, res).catch(next);
});

router.get('/me', authenticate, (req, res, next) => {
  authController.me(req, res).catch(next);
});

// Admin Administrative Token Revocation
router.post('/users/:userId/revoke', authenticate, requireRoles(Role.ADMIN), (req, res, next) => {
  authController.revokeUserTokens(req, res).catch(next);
});

// Persona Switcher (ADMIN / OWNER only)
router.post('/switch-persona', authenticate, (req, res, next) => {
  authController.switchPersona(req, res).catch(next);
});

export default router;
