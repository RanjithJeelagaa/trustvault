import { seed } from '../seed';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

seed()
  .catch((e) => {
    console.error('Prisma seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
