import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seed() {
  console.log('--- Seeding TrustVault Security Accounts ---');

  const saltRounds = 12;
  const commonPassword = 'Password123!';
  const hashedPassword = await bcrypt.hash(commonPassword, saltRounds);

  const accounts = [
    {
      email: 'admin@trustvault.local',
      role: Role.ADMIN,
      passwordHash: hashedPassword,
    },
    {
      email: 'owner@trustvault.local',
      role: Role.OWNER,
      passwordHash: hashedPassword,
    },
    {
      email: 'viewer@trustvault.local',
      role: Role.VIEWER,
      passwordHash: hashedPassword,
    },
  ];

  for (const account of accounts) {
    const existing = await prisma.user.findUnique({
      where: { email: account.email },
    });

    if (existing) {
      await prisma.user.update({
        where: { email: account.email },
        data: {
          role: account.role,
          passwordHash: account.passwordHash,
        },
      });
      console.log(`Updated user: ${account.email} (${account.role})`);
    } else {
      await prisma.user.create({
        data: {
          email: account.email,
          role: account.role,
          passwordHash: account.passwordHash,
        },
      });
      console.log(`Created user: ${account.email} (${account.role})`);
    }
  }

  console.log('Seeding completed successfully.');
}

if (require.main === module) {
  seed()
    .catch((e) => {
      console.error('Seeding error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
