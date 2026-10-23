import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function withRetry<T>(fn: () => Promise<T>, retries = 4, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 1) throw err;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

beforeAll(async () => {
  await withRetry(async () => {
    await prisma.$connect();

    // Clear existing operational test records
    await prisma.auditLog.deleteMany();
    await prisma.permission.deleteMany();
    await prisma.document.deleteMany();
    await prisma.revokedToken.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Seed baseline personas
    await prisma.user.createMany({
      data: [
        { email: 'admin@trustvault.local', passwordHash, role: Role.ADMIN },
        { email: 'owner@trustvault.local', passwordHash, role: Role.OWNER },
        { email: 'owner_a@trustvault.local', passwordHash, role: Role.OWNER },
        { email: 'owner_b@trustvault.local', passwordHash, role: Role.OWNER },
        { email: 'viewer@trustvault.local', passwordHash, role: Role.VIEWER },
        { email: '23@gmail.com', passwordHash, role: Role.VIEWER },
      ],
    });
  });
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
});