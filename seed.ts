import { PrismaClient, Role, AccessLevel } from '@prisma/client';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { REALISTIC_RECEIPT_PNG, REALISTIC_BLUEPRINT_PNG } from './src/utils/sampleImages';

const prisma = new PrismaClient();

const STORAGE_DOCUMENTS_DIR = path.resolve(__dirname, 'storage/documents');

// Valid PDF buffer with standard magic bytes
const VALID_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Title (TrustVault Secured Document) /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'
);

// Valid plain text/doc buffer
const VALID_DOCX_BUFFER = Buffer.from(
  'Confidential Legal Settlement - Restricted Access Document.\nProtected by TrustVault Security Controls.'
);

export async function seed() {
  console.log('--- Seeding TrustVault Security Accounts & Test Documents ---');

  if (!fs.existsSync(STORAGE_DOCUMENTS_DIR)) {
    fs.mkdirSync(STORAGE_DOCUMENTS_DIR, { recursive: true });
  }

  const saltRounds = 12;
  const commonPassword = 'Password123!';
  const hashedPassword = await bcrypt.hash(commonPassword, saltRounds);

  // 1. Seed Required Users
  const accounts = [
    { email: 'admin@trustvault.local', role: Role.ADMIN },
    { email: 'owner@trustvault.local', role: Role.OWNER },
    { email: 'owner_a@trustvault.local', role: Role.OWNER },
    { email: 'owner_b@trustvault.local', role: Role.OWNER },
    { email: 'viewer@trustvault.local', role: Role.VIEWER },
    { email: '23@gmail.com', role: Role.VIEWER },
  ];

  const userMap: Record<string, any> = {};

  for (const account of accounts) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: account.email, mode: 'insensitive' } },
    });

    const isSystemAccount = account.email.endsWith('@trustvault.local');

    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        role: account.role,
        // Preserve custom registered user passwords; only overwrite for system accounts or missing hashes
        ...(isSystemAccount || !existing?.passwordHash ? { passwordHash: hashedPassword } : {}),
      },
      create: {
        email: account.email,
        role: account.role,
        passwordHash: hashedPassword,
      },
    });
    userMap[account.email] = user;
    console.log(`Seeded user: ${user.email} (${user.role})`);
  }

  // 2. Seed Realistic Test Documents & Permissions Matrix
  const sampleDocs = [
    {
      title: 'Q3 Financial Audit Report.pdf',
      category: 'Financial',
      originalName: 'Q3_Financial_Audit_Report.pdf',
      mimeType: 'application/pdf',
      buffer: VALID_PDF_BUFFER,
      ownerEmail: 'owner@trustvault.local',
      grants: [
        { email: 'viewer@trustvault.local', level: AccessLevel.READ },
        { email: '23@gmail.com', level: AccessLevel.READ },
      ],
    },
    {
      title: 'System Architecture Blueprint.png',
      category: 'Engineering',
      originalName: 'System_Architecture_Blueprint.png',
      mimeType: 'image/png',
      buffer: REALISTIC_BLUEPRINT_PNG,
      ownerEmail: 'owner@trustvault.local',
      grants: [
        { email: '23@gmail.com', level: AccessLevel.EDIT },
      ],
    },
    {
      title: 'Store Receipt - Cloud Infrastructure.png',
      category: 'Financial',
      originalName: 'valid_receipt.png',
      mimeType: 'image/png',
      buffer: REALISTIC_RECEIPT_PNG,
      ownerEmail: 'owner@trustvault.local',
      grants: [
        { email: 'viewer@trustvault.local', level: AccessLevel.READ },
        { email: '23@gmail.com', level: AccessLevel.READ },
      ],
    },
    {
      title: 'Confidential Legal Settlement.docx',
      category: 'Legal',
      originalName: 'Confidential_Legal_Settlement.docx',
      mimeType: 'text/plain',
      buffer: VALID_DOCX_BUFFER,
      ownerEmail: 'admin@trustvault.local',
      grants: [], // Strictly Restricted: only Admin & Owner
    },
    {
      title: 'General Employee Handbook.pdf',
      category: 'General',
      originalName: 'General_Employee_Handbook.pdf',
      mimeType: 'application/pdf',
      buffer: VALID_PDF_BUFFER,
      ownerEmail: 'admin@trustvault.local',
      grants: [
        { email: 'viewer@trustvault.local', level: AccessLevel.READ },
        { email: '23@gmail.com', level: AccessLevel.READ },
        { email: 'owner@trustvault.local', level: AccessLevel.READ },
        { email: 'owner_a@trustvault.local', level: AccessLevel.READ },
      ],
    },
  ];

  for (const docSpec of sampleDocs) {
    const owner = userMap[docSpec.ownerEmail];
    if (!owner) continue;

    // Check if document already exists by title and owner
    let doc = await prisma.document.findFirst({
      where: {
        title: docSpec.title,
        ownerId: owner.id,
      },
    });

    const storageKey = doc ? doc.storageKey : uuidv4();
    const diskPath = path.resolve(STORAGE_DOCUMENTS_DIR, storageKey);

    // Write physical file to storage/documents
    await fs.promises.writeFile(diskPath, docSpec.buffer);

    if (doc) {
      doc = await prisma.document.update({
        where: { id: doc.id },
        data: {
          category: docSpec.category,
          originalName: docSpec.originalName,
          mimeType: docSpec.mimeType,
          size: docSpec.buffer.length,
        },
      });
      console.log(`Updated document: "${doc.title}"`);
    } else {
      doc = await prisma.document.create({
        data: {
          title: docSpec.title,
          category: docSpec.category,
          originalName: docSpec.originalName,
          storageKey,
          mimeType: docSpec.mimeType,
          size: docSpec.buffer.length,
          ownerId: owner.id,
        },
      });
      console.log(`Created document: "${doc.title}"`);
    }

    // Apply explicit permission grants
    for (const grant of docSpec.grants) {
      const targetUser = userMap[grant.email];
      if (!targetUser) continue;

      await prisma.permission.upsert({
        where: {
          documentId_userId: {
            documentId: doc.id,
            userId: targetUser.id,
          },
        },
        update: {
          accessLevel: grant.level,
        },
        create: {
          documentId: doc.id,
          userId: targetUser.id,
          accessLevel: grant.level,
        },
      });
      console.log(`  -> Granted ${grant.level} on "${doc.title}" to ${targetUser.email}`);
    }
  }

  // 3. Fix any legacy placeholder/corrupted test documents in the database
  const legacyDocs = await prisma.document.findMany({
    where: {
      OR: [
        { originalName: 'valid_receipt.png' },
        { title: { contains: 'valid_receipt', mode: 'insensitive' } },
        { originalName: 'audit_test.png' },
      ],
    },
  });

  for (const legacy of legacyDocs) {
    const legacyPath = path.resolve(STORAGE_DOCUMENTS_DIR, legacy.storageKey);
    await fs.promises.writeFile(legacyPath, REALISTIC_RECEIPT_PNG);
    await prisma.document.update({
      where: { id: legacy.id },
      data: {
        size: REALISTIC_RECEIPT_PNG.length,
      },
    });
    console.log(`Repaired legacy document "${legacy.title}" with realistic sample image.`);
  }

  console.log('--- Seeding completed successfully ---');
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
