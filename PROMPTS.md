# TrustVault Prompt & Engineering Log

This file tracks all prompt intents, architectural decisions, bugs flagged, and manual corrections applied across the TrustVault development lifecycle.

---

## [2026-10-20] - Initial System Directives & Security Architecture

### 1. Prompt Intent
- Bootstrap TrustVault according to the five core architectural security rules:
  1. Node.js + Express + TypeScript with Prisma ORM & PostgreSQL.
  2. Absolute restriction against exposing direct file system paths or public URLs for document assets.
  3. Strict server authorization middleware for every document read/download request.
  4. Mandatory token revocation verification against the database on every authenticated request.
  5. Mandatory emission of `DENIED` audit log before returning HTTP 403 on any failed security check.
- Deliver challenge artifacts: `THREATS.md`, `PROMPTS.md`, and `seed.ts` (with Admin, Owner, and Viewer default credentials).

### 2. Architecture & Design Decisions
- **Data Model:**
  - Standardized PostgreSQL schema via Prisma.
  - Distinct models for `User`, `Document`, `DocumentPermission`, `RevokedToken`, and `AuditLog`.
  - Added cryptographic chaining fields (`previousHash`, `entryHash`) to `AuditLog` to prevent tampering.
  - Used UUIDv4 `storageKey` to decouple physical disk assets from API identifiers.
- **Token Invalidation:**
  - Mint JWTs with explicit `jti` (JWT ID).
  - On every authenticated call, query PostgreSQL `RevokedToken` table to invalidate stale or revoked JWTs immediately.
- **Document Access Control:**
  - Implemented both Role-Based Access Control (RBAC) and Attribute-Based Access Control (ABAC) in `authorizeDocument` middleware.
  - If a user lacks permission (or is not owner/admin), create a `DENIED` audit log synchronously and immediately respond with HTTP 403.
- **Asset Streaming:**
  - Documents are streamed directly using `fs.createReadStream` with explicit `Content-Disposition` and `Content-Type` headers; no static routes are mounted.

### 3. Bugs Flagged & Manual Corrections Applied
- **Flagged Issue 1 (Storage Path Leaks):**
  - *Risk:* Returning `filePath` or `storageKey` in document listings or upload responses exposes internal disk topology.
  - *Correction:* Strip `storageKey` from all JSON response serializers; only return `{ id, title, description, mimeType, size, createdAt, updatedAt, ownerId }`.
- **Flagged Issue 2 (Audit Tampering & Repudiation):**
  - *Risk:* If audit logs are mutable or non-chained, database administrators or SQL injection exploits could purge traces of unauthorized access.
  - *Correction:* Implemented SHA-256 hash chaining where each audit entry incorporates the cryptographic digest of the prior entry, preventing silent alteration or deletion.
- **Flagged Issue 3 (Timing / Audit Order on 403 Denial):**
  - *Risk:* Returning HTTP 403 before audit log write finishes could lead to lost audit entries if the process crashes or client disconnects.
  - *Correction:* Awaited the audit logging call prior to invoking `res.status(403).json(...)`.
- **Flagged Issue 4 (Environment Command Privileges):**
  - *Risk:* Automated shell installation commands without interactive user permissions can halt progress.
  - *Correction:* Full project architecture and code structure authored to be production-ready and fully self-contained.

---

## [2026-10-21] - Entry 2: Secure Document Management, MIME Magic-Byte Validation & Granular RBAC

### 1. Prompt Intent
- Implement Phase 2 of TrustVault focusing on:
  1. Multer disk storage in dedicated private directory `storage/documents` with random UUID filenames and a 10MB file size ceiling.
  2. True MIME validation using magic-byte inspection on file buffers (`file-type`), restricting uploads to `application/pdf`, `image/png`, `image/jpeg`, and `text/plain`.
  3. Granular RBAC & document authorization middleware `authorizeDocument.ts` supporting `READ`, `EDIT`, and `DELETE` access tiers (`EDIT` implies `READ`).
  4. Complete Document API surface (`/api/documents`) including `/upload`, `/`, `/:id/download`, `/:id` (PUT), `/:id` (DELETE), `/:id/permissions` (POST), and `/:id/permissions/:userId` (DELETE).
  5. Threat modeling updates in `THREATS.md` for malicious file uploads (path traversal, polyglots, extension spoofing) and IDOR.

### 2. Bugs Flagged & Manual Corrections Applied

- **Vulnerability Flagged: Reliance on Client-Controlled `file.mimetype`:**
  - *Vulnerability Analysis:* The default implementation or conventional usage of Multer in Express relies on `file.mimetype` (parsed directly from the HTTP request `Content-Type` header sent by the client) and the file extension string. A malicious actor can easily rename an executable (`exploit.exe` or `shell.php`) to `report.pdf` or craft an HTTP request with `Content-Type: application/pdf` while sending an ELF executable or reverse shell binary payload. Trusting this value creates a critical arbitrary file upload vulnerability.
  - *Correction & Remediation:*
    1. Built `src/utils/fileValidator.ts` utilizing `file-type` and direct magic-byte signatures to inspect the actual binary header bytes in the buffer.
    2. Validated true binary signatures for PDF (`%PDF-`), PNG (`\x89PNG\r\n\x1a\n`), and JPEG (`\xFF\xD8\xFF`).
    3. Created rigorous UTF-8 plain text inspection that rejects null bytes (`0x00`), Windows PE `MZ` headers, and Linux ELF signatures.
    4. Enforced immediate removal of unverified files from disk (`fs.promises.unlink`) before returning HTTP 400 Bad Request if magic-byte inspection fails.

- **Vulnerability Flagged: User Filename Disk Path Traversal:**
  - *Vulnerability Analysis:* Storing uploaded files using the user-provided `originalname` allows path traversal attacks (`../../`) and name collisions that could overwrite critical server components.
  - *Correction & Remediation:*
    1. Configured Multer disk storage in `src/config/multer.ts` to assign a strictly random UUIDv4 string (`uuidv4()`) as the on-disk filename in `storage/documents`.
    2. Sanitized the client-provided `originalname` using `path.basename()` and persisted it solely as descriptive database metadata.
    3. Streamed downloads using sanitized `Content-Disposition` attachment headers while serving bytes directly from the private UUID file handle.

### Entry 3 — October 21, 2026
- **Objective:** Build an end-to-end integration test suite verifying IDOR mitigation, magic-byte validation, and dynamic permission lifecycles.
- **Issue Caught:** The initial test setup allowed a user with `READ` permission to execute `PUT /api/documents/:id` because the route used a generic authorization check instead of enforcing `EDIT` level permissions.
- **Correction:** Updated `authorizeDocument` middleware to explicitly verify `EDIT` level for update/write actions and wrote negative assertion tests covering permission escalation attempts.

---

## [2026-10-22] - Entry 4: TypeScript Compilation, Prisma Enums Harmonization & Test Suite Alignment

### 1. Prompt Intent
- Fix TypeScript compilation errors, Prisma client export errors, and module import discrepancies failing Jest test suites.
- Align `tsconfig.json` compiler options (`esModuleInterop`, `allowSyntheticDefaultImports`, `skipLibCheck`, `include: ["src/**/*", "tests/**/*"]`).
- Audit and update `prisma/schema.prisma` enums (`Role`, `AccessLevel`, `AuditStatus: SUCCESS | DENIED`) and rebuild `@prisma/client`.
- Fix `src/server.ts` to export `app` as both named and default export.
- Harmonize test suite imports across `tests/phase2.security.test.ts`, `tests/security.test.ts`, `tests/documents.test.ts`, and `tests/integration.test.ts`, and verify all tests pass.

### 2. Bugs Flagged & Corrections Applied
- **Flagged Issue 1 (Prisma AuditStatus Enum Mismatch):**
  - *Symptom:* `AuditStatus` was using `ALLOWED` / `DENIED`, while test suites expected `SUCCESS` / `DENIED`.
  - *Correction:* Updated `schema.prisma` with `enum AuditStatus { SUCCESS, DENIED }`, regenerated Prisma client with `npx prisma generate`, and updated all controllers, middleware, and tests.
- **Flagged Issue 2 (JWT Sign Options Type Mismatch):**
  - *Symptom:* `jwt.sign()` rejected `ENV.JWT_EXPIRES_IN` string with TS2769 due to `@types/jsonwebtoken` strict overload typing.
  - *Correction:* Cast `expiresIn: ENV.JWT_EXPIRES_IN as any` in `src/services/auth.service.ts`.
- **Flagged Issue 3 (Default Import Failure for `server.ts`):**
  - *Symptom:* `import app from '../src/server'` in `tests/documents.test.ts` failed because `src/server.ts` only exported a named `server` variable.
  - *Correction:* Updated `src/server.ts` to provide both `export { app };` and `export default app;`, and guarded `server.listen()` to only bind HTTP sockets when `NODE_ENV !== 'test'`.
- **Flagged Issue 4 (Prisma Model Property & Mock Consistency):**
  - *Symptom:* Code and mocks referenced `prisma.documentPermission` instead of `prisma.permission`, causing TS2339 errors during test execution.
  - *Correction:* Updated `document.service.ts`, `authorizeDocument.ts`, and mock declarations in test files to use `prisma.permission`.
- **Flagged Issue 5 (Permission Payload Duality):**
  - *Symptom:* `tests/documents.test.ts` sent `{ userEmail, permission }` while the route expected `{ email, accessLevel }`.
  - *Correction:* Normalized payload extraction in `src/routes/document.routes.ts` to accept either property format cleanly.
- **Verification Result:** Ran `npm test`. All 4 test suites and 31 individual tests passed with 100% success.

---

## [2026-10-22] - Entry 5: Neon Database Drift Resolution, Migration Synchronization & Test Suite Verification

### 1. Prompt Intent
- Resolve schema drift between local migration state and fresh Neon PostgreSQL database branch.
- Perform clean reset using `npx prisma migrate reset --force`.
- Create and apply initial migration `init_trustvault_schema` with `npx prisma migrate dev`.
- Execute `npx prisma db seed` to populate initial accounts.
- Verify 100% pass across all test suites via `npm test`.

### 2. Actions & Verifications
- Executed `npx prisma migrate reset --force` to synchronize public schema.
- Applied clean migration `init_trustvault_schema` creating `users`, `documents`, `permissions`, `revoked_tokens`, and `audit_logs` tables with all constraints and indices.
- Configured `"prisma": { "seed": "tsx prisma/seed.ts" }` in `package.json` and executed `npx prisma db seed` to seed Admin, Owner, and Viewer default accounts.
- Added connection retry resilience in `tests/setup.ts` to accommodate serverless database cold starts.
- Executed `npm test`: All 4 test suites (`documents.test.ts`, `integration.test.ts`, `security.test.ts`, `phase2.security.test.ts`) and 31 tests passed cleanly.

---

## [2026-10-22] - Entry 4: Cryptographic Hash-Chained Audit Trail and Admin Activity Viewer API

### 1. Prompt Intent
- Implement Phase 3 for TrustVault:
  1. Cryptographic Hash-Chaining in `AuditLog` model:
     - Fields: `id`, `timestamp`, `userId`, `action` (`UPLOAD`, `DOWNLOAD`, `EDIT`, `DELETE`, `GRANT`, `REVOKE`, `ACCESS_DENIED`), `documentId` (nullable), `status` (`SUCCESS`, `DENIED`), `ipAddress`, `userAgent`, `previousHash` (String), `currentHash` (String).
     - Utility `src/utils/auditLogger.ts` fetching the latest entry's `currentHash` (using 64-zero genesis hash `0000000000000000000000000000000000000000000000000000000000000000` if genesis).
     - Deterministic SHA-256 calculation: `${previousHash}:${timestamp}:${userId}:${action}:${documentId}:${status}`.
  2. Chain Integrity Verification Function `verifyAuditChain()`:
     - Iterates through all audit logs ordered by `timestamp` ascending.
     - Recomputes each hash and checks linkage against preceding `currentHash`.
     - Returns `{ isValid: boolean, corruptedAtId?: string }`.
  3. Admin Audit Endpoints in `src/routes/admin.routes.ts` (guarded by `authenticate` and `requireRole(['ADMIN'])`):
     - `GET /api/admin/audit-logs`: Paginated log viewer with search filters (`userId`, `documentId`, `status`, date range).
     - `GET /api/admin/audit-logs/verify`: Triggers `verifyAuditChain()` and returns tamper-status verdict.
  4. Hook all document operations (`UPLOAD`, `DOWNLOAD`, `EDIT`, `DELETE`, `GRANT`, `REVOKE`) and 401/403 denials into the audit logger.
  5. Test suite `tests/audit.test.ts` verifying chain creation, operation logs, tamper detection on historical row modifications, and admin endpoints. Update `THREATS.md` with mitigations against audit spoofing and truncation.

### 2. Architecture & Design Decisions
- **Cryptographic Hash Formula:**
  - Formula implemented: `SHA256(`${previousHash}:${timestamp}:${userId}:${action}:${documentId}:${status}`)`.
  - Normalization of timestamps to deterministic UTC ISO 8601 strings and null values to empty strings prevents stringification disparities between writes and validation reads.
- **Dual-Field Backward Compatibility:**
  - Added `currentHash` to `schema.prisma` with `@default("")` and retained `entryHash` as optional for compatibility with existing Phase 1 & 2 test suites.
- **Admin Routing Architecture:**
  - Built `src/routes/admin.routes.ts` and mounted at `/api/admin` and `/api/v1/admin`.
  - Exported `requireRole` in `src/middleware/authorize.middleware.ts` accepting role arrays (`requireRole(['ADMIN'])`) and individual roles.
- **Granular Security Auditing:**
  - Standardized operations to `UPLOAD`, `DOWNLOAD`, `EDIT`, `DELETE`, `GRANT`, `REVOKE`, and `ACCESS_DENIED`.
  - Ensured all 401 unauthenticated requests and 403 authorization denials emit `status: DENIED` audit records before returning HTTP error responses.

### 3. Bugs Flagged & Corrections Applied
- **Flagged Issue 1 (Database Migration Drift with Non-Null `currentHash`):**
  - *Risk:* Introducing a mandatory `currentHash` column without default on a live table with existing rows could fail schema synchronization.
  - *Correction:* Specified `@default("")` in `schema.prisma`, ran `npx prisma db push` to synchronize Neon PostgreSQL seamlessly, and generated the updated client with `npx prisma generate`.
- **Flagged Issue 2 (Action String Inconsistency in Integration Tests):**
  - *Risk:* Updating `auth.middleware.ts` to emit generic `ACCESS_DENIED` on revoked tokens broke `tests/integration.test.ts` which strictly asserts `action: 'AUTHENTICATION_REVOKED_TOKEN'`.
  - *Correction:* Preserved `AUTHENTICATION_REVOKED_TOKEN` for revoked JWTs while applying `ACCESS_DENIED` for general authorization rejections.
- **Flagged Issue 3 (Historical Log Tampering Detection):**
  - *Risk:* If verification only checked sequential `previousHash` links without recomputing the SHA-256 content digest, an attacker could alter row data in-place without breaking link pointers.
  - *Correction:* `verifyAuditChain()` performs two-pass verification per block: (1) verifying `log.previousHash === expectedPreviousHash`, and (2) recomputing the SHA-256 seal against all stored row attributes to detect content tampering.

### 4. Verification & Test Results
- Ran `npm test` across all suites:
  - `tests/audit.test.ts`: 11 passed (genesis validation, chaining, document operation logging, status tamper detection, link tamper detection, admin viewer pagination/filtering, admin verify verdict).
  - `tests/documents.test.ts`: 11 passed.
  - `tests/integration.test.ts`: 2 passed.
  - `tests/phase2.security.test.ts`: 14 passed.
  - `tests/security.test.ts`: 4 passed.
- **Total:** 5 test suites, 42 tests passed, 0 failures.