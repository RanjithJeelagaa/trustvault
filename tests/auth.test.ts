import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';

describe('TrustVault Authentication & Dynamic User Registration', () => {
  const app = createApp();
  const testEmail = `newuser_${Date.now()}@trustvault.local`;
  const testPassword = 'SecurePassword987!';

  afterAll(async () => {
    // Cleanup created test users
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: 'newuser_',
        },
      },
    });
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register a new user with default role VIEWER', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Account created successfully');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.user.role).toBe(Role.VIEWER);
      expect(res.body.user.passwordHash).toBeUndefined(); // Security: never expose passwordHash

      // Verify record directly in database
      const dbUser = await prisma.user.findUnique({
        where: { email: testEmail.toLowerCase() },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.passwordHash).not.toBe(testPassword);
      const isBcryptMatch = await bcrypt.compare(testPassword, dbUser!.passwordHash);
      expect(isBcryptMatch).toBe(true);
    });

    it('should ignore client-provided role and strictly enforce VIEWER role on registration', async () => {
      const ownerAttemptEmail = `newuser_owner_${Date.now()}@trustvault.local`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: ownerAttemptEmail,
          password: testPassword,
          role: 'OWNER',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe(Role.VIEWER);

      const dbUser = await prisma.user.findUnique({
        where: { email: ownerAttemptEmail.toLowerCase() },
      });
      expect(dbUser?.role).toBe(Role.VIEWER);
    });

    it('should return 409 Conflict if email is already in use', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'AnotherPassword123!',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Email already in use');
    });

    it('should return 400 Bad Request for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: testPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid registration payload');
    });

    it('should return 400 Bad Request for password shorter than 6 characters', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `short_${Date.now()}@trustvault.local`,
          password: '123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid registration payload');
    });
  });

  describe('POST /api/auth/login with dynamic database lookup', () => {
    it('should successfully log in the newly registered dynamic user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.user.role).toBe(Role.VIEWER);
    });

    it('should reject login with wrong password (401)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword456!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('should allow login with case-insensitive and whitespace-padded email', async () => {
      const resUpper = await request(app)
        .post('/api/auth/login')
        .send({
          email: `  ${testEmail.toUpperCase()}  `,
          password: testPassword,
        });

      expect(resUpper.status).toBe(200);
      expect(resUpper.body.token).toBeDefined();
      expect(resUpper.body.user.email).toBe(testEmail.toLowerCase());
    });

    it('should reject login for non-existent user email (401)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'ghost_user_does_not_exist@trustvault.local',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  describe('User Management & RBAC Permissions (Owner & Admin)', () => {
    let adminToken: string;
    let ownerToken: string;
    let viewerToken: string;
    let adminUser: any;
    let ownerUser: any;
    let viewerUser: any;
    let targetUser: any;

    beforeAll(async () => {
      // Create a dedicated target user for promotion/deletion tests
      const passwordHash = await bcrypt.hash('Password123!', 10);
      targetUser = await prisma.user.create({
        data: {
          email: `target_${Date.now()}@trustvault.local`,
          passwordHash,
          role: Role.VIEWER,
        },
      });

      // Login Admin
      const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@trustvault.local', password: 'Password123!' });
      adminToken = adminRes.body.token;
      adminUser = adminRes.body.user;

      // Login Owner
      const ownerRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'owner@trustvault.local', password: 'Password123!' });
      ownerToken = ownerRes.body.token;
      ownerUser = ownerRes.body.user;

      // Login Viewer
      const viewerRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'viewer@trustvault.local', password: 'Password123!' });
      viewerToken = viewerRes.body.token;
      viewerUser = viewerRes.body.user;
    });

    afterAll(async () => {
      await prisma.user.deleteMany({
        where: {
          email: {
            contains: 'target_',
          },
        },
      });
    });

    describe('GET /api/users', () => {
      it('should reject unauthenticated requests (401)', async () => {
        const res = await request(app).get('/api/users');
        expect(res.status).toBe(401);
      });

      it('should forbid VIEWER from listing users (403)', async () => {
        const res = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${viewerToken}`);
        expect(res.status).toBe(403);
      });

      it('should allow OWNER to list registered users (200)', async () => {
        const res = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
        expect(res.body.users.length).toBeGreaterThan(0);
      });

      it('should allow ADMIN to list registered users (200)', async () => {
        const res = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
      });
    });

    describe('PATCH /api/users/:id/role', () => {
      it('should forbid VIEWER from updating roles (403)', async () => {
        const res = await request(app)
          .patch(`/api/users/${targetUser.id}/role`)
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ newRole: 'OWNER' });
        expect(res.status).toBe(403);
      });

      it('should prevent OWNER from modifying an ADMIN account role (403)', async () => {
        const res = await request(app)
          .patch(`/api/users/${adminUser.id}/role`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ newRole: 'VIEWER' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Owners cannot alter Admin roles');
      });

      it('should allow OWNER to modify a VIEWER role to OWNER (200)', async () => {
        const res = await request(app)
          .patch(`/api/users/${targetUser.id}/role`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ newRole: 'OWNER' });

        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe('OWNER');
      });

      it('should allow ADMIN to modify any user role (200)', async () => {
        const res = await request(app)
          .patch(`/api/users/${targetUser.id}/role`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ newRole: 'VIEWER' });

        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe('VIEWER');
      });
    });

    describe('DELETE /api/users/:id', () => {
      it('should prevent user from deleting their own active session account (400)', async () => {
        const res = await request(app)
          .delete(`/api/users/${ownerUser.id}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Cannot delete your own active session account');
      });

      it('should forbid VIEWER from deleting user accounts (403)', async () => {
        const res = await request(app)
          .delete(`/api/users/${targetUser.id}`)
          .set('Authorization', `Bearer ${viewerToken}`);

        expect(res.status).toBe(403);
      });

      it('should prevent OWNER from deleting an ADMIN account (403)', async () => {
        const res = await request(app)
          .delete(`/api/users/${adminUser.id}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Owners cannot delete Admin accounts');
      });

      it('should allow OWNER to delete a VIEWER user account (200)', async () => {
        const res = await request(app)
          .delete(`/api/users/${targetUser.id}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('User deleted successfully');

        const deletedCheck = await prisma.user.findUnique({
          where: { id: targetUser.id },
        });
        expect(deletedCheck).toBeNull();
      });

      it('should allow ADMIN to delete an account (200)', async () => {
        // Create a temporary user for admin deletion
        const passwordHash = await bcrypt.hash('Password123!', 10);
        const tempUser = await prisma.user.create({
          data: {
            email: `admin_delete_target_${Date.now()}@trustvault.local`,
            passwordHash,
            role: Role.OWNER,
          },
        });

        const res = await request(app)
          .delete(`/api/users/${tempUser.id}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('User deleted successfully');

        const deletedCheck = await prisma.user.findUnique({
          where: { id: tempUser.id },
        });
        expect(deletedCheck).toBeNull();
      });
    });
  });
});
