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

---

## [2026-10-22] - Entry 6: Modern React + Vite + Tailwind CSS Frontend (Phase 4)

### 1. Prompt Intent
- Build Phase 4 for TrustVault:
  1. Frontend Client in `client/`:
     - React + Vite + TypeScript + Tailwind CSS with dark-mode aesthetic.
     - Top Navigation bar displaying current user badge (Email + Role), quick-switch persona dropdown, and Logout button.
  2. Three Primary Views:
     - Document Hub: Upload modal (with client-side MIME checks & 10MB limit), document grid/table, and real-time search & filter bar.
     - Permission Management Modal (Owners/Admins): Active grant listing, add permission form (`READ`/`EDIT`), and instant revocation button.
     - Admin Audit Trail Viewer (ADMIN role only): Paginated audit logs with status badges (`SUCCESS`/`DENIED`), copyable hash seals, and Tamper Verification Card querying `/api/admin/audit-logs/verify`.
  3. Authentication & API Client:
     - Axios client with Bearer token interceptor and automatic logout on 401.
     - Quick-login demo buttons for Admin, Owner, and Viewer personas.
  4. Build & Serve Integration:
     - Configured Express in `src/server.ts` to statically serve the frontend bundle from `client/dist` in production, enabling single-port deployment while preserving Architecture Rule 2 (isolated private asset streaming).

### 2. Architecture & Design Decisions
- **Zero Static Mount of Private Document Assets:**
  - `client/dist` contains only compiled client application assets (HTML/JS/CSS). Document files in `storage/documents` remain completely unmounted and continue to be served strictly via authenticated streaming endpoints.
- **Client-Side Pre-Flight MIME Inspection:**
  - Client performs immediate magic/MIME checks rejecting non-allowed files before initiating HTTP payload transfers, coupled with the backend's authoritative magic byte inspection.
- **Persona Quick-Switching:**
  - Built an intuitive demo selector enabling instant role switching between Admin, Owner, and Viewer to streamline permission escalation and audit verification testing.

### 3. Verification & Build
- Ran `npm run build` at root: TypeScript server compilation and client Vite bundle generation completed with zero errors.
- Ran `npm test`: All 5 test suites and 42 tests passed cleanly.

---

## [2026-10-22] - Entry 7: User Registration & Dynamic Database Authentication

### 1. Prompt Intent
- Implement dynamic user registration and database authentication:
  1. Ensure `users` table/model exists with primary key, email, password hash, role (`ADMIN`, `OWNER`, `VIEWER`), and timestamps.
  2. Implement backend endpoint `POST /api/auth/register`:
     - Validate input payload (email format, minimum password length).
     - Check for duplicate email and return HTTP 409 Conflict.
     - Hash password securely using bcrypt with salt rounds >= 10.
     - Store record in PostgreSQL and return user object excluding `passwordHash`.
  3. Validate dynamic database login (`POST /api/auth/login`):
     - Query user by email from PostgreSQL.
     - Verify password via `bcrypt.compare`; return 401 on missing user or invalid password.
     - Issue signed JWT containing user ID and role for granular RBAC.
  4. Update Frontend UI (`client/src/components/Login.tsx`):
     - Add `isSignUp` toggle state with switch links ("Don't have an account? Sign Up" / "Already have an account? Sign In").
     - In registration mode, display role selector dropdown (`VIEWER`, `OWNER`, `ADMIN`).
     - Display clear success ("Account created successfully! Please sign in") and error banners.
     - Retain demo quick-login persona cards for convenient testing.
  5. Fix Vite dev proxy port configuration to prevent connection refused (`ECONNREFUSED`) issues during local development.

### 2. Architecture & Design Decisions
- **Bcrypt Hashing Standard:**
  - Implemented `authService.hashPassword(password)` utilizing `bcryptjs` with 12 salt rounds.
- **Strict Role Preprocessing & Defaulting:**
  - Used Zod schema with `.preprocess((val) => typeof val === 'string' ? val.toUpperCase() : val, z.nativeEnum(Role))` defaulting to `Role.VIEWER`.
- **Security Audit Logging:**
  - Added cryptographic security events: `AUTH_REGISTER_SUCCESS` on user creation and `AUTH_REGISTER_FAILED` on duplicate email conflict.
- **Vite Proxy Harmonization:**
  - Aligned Vite dev server proxy target in `client/vite.config.ts` to `http://localhost:3000` (matching `.env`'s `PORT=3000`) and set Vite dev port to 5173 to prevent port collision with Express.

### 3. Verification & Test Results
- Authored test suite `tests/auth.test.ts` covering:
  - Default role assignment to `VIEWER`.
  - Explicit role selection (`OWNER`, `ADMIN`).
  - Salted bcrypt hash verification in the database.
  - 409 Conflict on duplicate email registration.
  - 400 Bad Request on invalid email or short password.
  - Dynamic user login immediately after registration.
  - 401 Unauthorized on invalid password or non-existent user.
- Rebuilt client bundle: `npm --prefix client run build` completed cleanly.
- Executed full test suite `npm test`: All 6 test suites and 50 tests passed with 100% success.

---

## [2026-10-22] - Entry 8: Fix Document Upload & Granular Document Access / Sharing Management

### 1. Prompt Intent
- Fix the unresponsive "Upload Document" functionality and implement user-access/sharing management for documents in TrustVault:
  1. Fix Document Upload:
     - Ensure the dashboard "Upload Document" button toggles `isUploadModalOpen` state.
     - Support file selection, document title, and category selection (`General`, `Confidential`, `Financial`, `Legal`, `Engineering`, `Audit`).
     - Wire upload submission to backend API (`POST /api/documents` and `POST /api/documents/upload`):
       - Parse multipart/form-data supporting both `file` and `document` form field names.
       - Associate the currently authenticated user (`req.user.id`) as the document owner (`ownerId`).
       - On success, close modal, trigger document re-fetch, and show an auto-dismissing success toast.
       - Log errors clearly to the console and display user-friendly feedback in the modal.
  2. Document Access Control & User Sharing:
     - Database & Routing:
       - Validate permissions mapping against PostgreSQL `permissions` table (`id`, `documentId`, `userId`, `access`, `createdAt`).
       - Provide registered users list endpoint: `GET /api/documents/users`.
       - Retrieve granted users: `GET /api/documents/:id/access` (and `/:id/permissions`).
       - Batch grant access: `POST /api/documents/:id/access` (and `/:id/permissions`) supporting multiple user emails/IDs with RBAC guard enforcing requester is document owner or admin.
       - Revoke user access: `DELETE /api/documents/:id/access/:userId` (and `/:id/permissions/:userId`).
       - Enforce synchronous database checks in `authorizeDocument` preventing unauthorized viewers from viewing or downloading documents.
  3. UI / Access Management Modal:
     - Hook into the Permissions/Key icon button under ACTIONS column with RBAC guard (`ADMIN` or document `OWNER`).
     - Modal displays document title and list of active permissions with role badge and "Revoke" button.
     - Searchable autocomplete input and dropdown of registered users.
     - Multi-select capability with removable tag chips to batch-share with multiple users at once.
     - Permission level selector (`READ` / `EDIT`).
     - "Add Users" / "Grant Access" submit button.
     - Auto-dismissing toast notifications for document actions.

### 2. Architecture & Design Decisions
- **Multipart Field Duality:**
  - Configured `upload.fields([{ name: 'file' }, { name: 'document' }])` in `src/routes/document.routes.ts` mapped to `req.file` so any upload client submitting either `file` or `document` payload keys succeeds seamlessly.
- **RESTful Endpoint Aliasing:**
  - Mounted routes on both `/api/documents` and `/api/v1/documents`, and exposed `/access` alongside existing `/permissions` endpoints to maintain strict backward compatibility while fulfilling RESTful access management standards.
- **Batch Grant Resilience:**
  - Handled `{ emails: string[] }`, `{ userEmails: string[] }`, `{ email: string }`, and `{ userIds: string[] }` payloads in `POST /api/documents/:id/access` using Prisma transactional / batch lookups, ensuring idempotent permission creation and updating.
- **Frontend State & Feedback:**
  - Implemented an animated Toast notification provider in `DocumentHub.tsx` displaying color-coded feedback on upload, delete, download, and permission changes.
  - Multi-select tag manager in `PermissionModal.tsx` allowing one-click selection from registered users list or filtered search results.

### 3. Verification & Test Results
- Authored test suite additions in `tests/documents.test.ts` covering:
  - Root `POST /api/documents` file upload with owner association.
  - `GET /api/documents/users` registered users listing for sharing dropdown.
  - Multi-user batch access grants via `POST /api/documents/:id/access`.
  - Permission listing retrieval via `GET /api/documents/:id/access`.
  - Access enforcement verifying newly granted viewer can download document.
  - User revocation via `DELETE /api/documents/:id/access/:userId` and immediate subsequent 403 denial verification.
- Rebuilt client bundle: `npm --prefix client run build` completed cleanly.

---

## [2026-10-22] - Entry 9: Persona Visibility, Dynamic User Listing & Granular Permission Actions

### 1. Prompt Intent
- Restrict and enhance "Quick Persona" switcher:
  - RBAC visibility guard: render switcher ONLY if logged-in user is `ADMIN` or `OWNER`. Completely hide for `VIEWER` (e.g. `23@gmail.com`).
  - Dynamic user list: load all registered users from database via `GET /api/users`.
  - Display email and role badge for each user in dropdown.
  - Immediate session switching on click via backend endpoint `POST /api/auth/switch-persona`.
- Granular Document Permissions (View, Edit, Share, Delete):
  - View / Download (Eye & Download icons): available to ADMIN, Owner, or users with explicit `READ`/`EDIT` access.
  - Edit (Pencil icon): available ONLY to ADMIN, Owner, or users with explicit `EDIT` permission. Disabled for pure read-only viewers. Opens EditModal.
  - Share / Permissions (Key icon): available ONLY to ADMIN or Document Owner. Opens PermissionModal.
  - Delete (Trash icon): available ONLY to ADMIN or Document Owner.
- Seed Realistic Test Documents with Permission Matrix in `seed.ts`:
  1. "Q3 Financial Audit Report.pdf" (Financial, Owner: Owner) - VIEW access for `viewer@trustvault.local` and `23@gmail.com`.
  2. "System Architecture Blueprint.png" (Engineering, Owner: Owner) - EDIT access for `23@gmail.com`.
  3. "Confidential Legal Settlement.docx" (Legal, Owner: Admin) - Restricted to Admin & Owner.
  4. "General Employee Handbook.pdf" (General, Owner: Admin) - Global read access for all viewers.

### 2. Architecture & Design Decisions
- **Secure Server-Side Impersonation/Switching:**
  - Built `POST /api/auth/switch-persona` requiring caller to be authenticated `ADMIN` or `OWNER`. Viewers attempting to call this receive HTTP 403 Forbidden and a `DENIED` audit log.
- **Dedicated User Endpoint:**
  - Created `src/routes/user.routes.ts` mounted at `/api/users` and `/api/v1/users`, returning sanitized user objects (`id`, `email`, `role`, `createdAt`).
- **Enriched Document Payloads:**
  - `GET /api/documents` queries `owner` and `permissions` relations, returning computed boolean flags (`canView`, `canEdit`, `canShare`, `canDelete`, `userAccessLevel`, `ownerEmail`) to drive granular UI state.
- **Inline Preview Streaming:**
  - Implemented `GET /api/documents/:id/view` with `Content-Disposition: inline` and built `PreviewModal.tsx` for inline document viewing.

### 3. Verification & Test Results
- Authored test suite `tests/documents.test.ts` Section 5 covering:
  - `GET /api/users` registered users retrieval.
  - `POST /api/auth/switch-persona` by ADMIN.
  - 403 denial for VIEWER persona switch attempts.
  - Inline viewing via `GET /api/documents/:id/view`.
  - Full permissions matrix verification against all seeded test files.
- Executed `npx prisma db seed` successfully seeding accounts and sample files.
- Rebuilt client application via `npm --prefix client run build` with zero errors.

---

## [2026-10-22] - Entry 10: Document Preview Modal Fix, Blob Streaming & Fallback UI

### 1. Prompt Intent
- Fix blank document preview in TrustVault Document Viewer Modal:
  1. Preview Endpoint & Data Fetching:
     - Verify file content retrieval via `/api/documents/:id/view` and `/api/documents/:id/preview`.
     - Fetch as `blob`, generate object URL `URL.createObjectURL(blob)`, and ensure cleanup on modal unmount with `URL.revokeObjectURL(previewUrl)`.
     - Ensure proper backend Content-Type and `Content-Disposition: inline` headers.
  2. Robust File Preview Rendering by MIME type:
     - Images (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`):
       `<img src={previewUrl} alt={doc.title} className="max-h-[60vh] max-w-full object-contain mx-auto rounded" onError={handleImageError} />`
     - PDFs (`application/pdf`):
       `<iframe src={previewUrl} className="w-full h-[60vh] border-0 rounded" />`
     - Text / JSON / Code (`text/plain`, `application/json`):
       `<pre className="overflow-auto max-h-[60vh] p-4 bg-slate-900 rounded text-sm text-slate-200">`
  3. Error Handling & Fallback UI:
     - If the file fails to render (`imageError`), is empty/corrupt (`size < 100` bytes), or is an unsupported format:
       Show a clean fallback card displaying file type icon, details (name, MIME, formatted size), message: "Preview not available for this file or file content is empty.", and secondary "Download to View" button.
  4. Test Data Fix:
     - In seed/mock data, replace the 70 B `valid_receipt.png` placeholder with realistic test sample PNG images so previews render properly out of the box.

### 2. Architecture & Design Decisions
- **Streamlined Blob Lifecycle Management:**
  - `PreviewModal.tsx` fetches directly via authenticated Bearer token and creates a Blob object URL. The cleanup hook guarantees `URL.revokeObjectURL` is executed on unmount or document change, eliminating memory leaks.
- **Dual Inline Streaming Endpoints:**
  - Added `GET /api/documents/:id/preview` alongside `GET /api/documents/:id/view` in `src/routes/document.routes.ts`, streaming file bytes directly with strict `inline` Content-Disposition, exact MIME type, and `X-Content-Type-Options: nosniff`.
- **Pure Node.js Realistic Sample Image Generator:**
  - Created `src/utils/sampleImages.ts` using native Node.js `zlib` and CRC32 to produce visible sample PNGs:
    - `REALISTIC_RECEIPT_PNG` (~2.5 KB): Valid receipt/invoice layout with header, dividers, item blocks, and footer.
    - `REALISTIC_BLUEPRINT_PNG` (~3.4 KB): System architecture diagram with blueprint grid, nodes, and connections.
- **Database & Storage Repair:**
  - Updated `seed.ts` to populate realistic images for seeded documents (`System Architecture Blueprint.png` and `Store Receipt - Cloud Infrastructure.png`), and auto-repair any legacy 70-byte placeholder records in the database.

### 3. Verification & Test Results
- Ran `npx prisma db seed`: Seeded realistic images and repaired legacy records.
- Updated `tests/documents.test.ts` and `tests/audit.test.ts` to use `REALISTIC_RECEIPT_PNG`.
- Added test in `tests/documents.test.ts` verifying `GET /api/documents/:id/preview` returns `200`, `Content-Disposition: inline`, and `Content-Type: image/png` with size > 100 bytes.
- Executed `npm test`: All 6 test suites passed cleanly (62/62 tests passing).
- Executed `npm --prefix client run build`: TypeScript checks and Vite bundle passed with zero errors in 2.73s.

---

## [2026-10-22] - Entry 11: Dynamic User Authentication, Case-Insensitive Login & Explicit Audit Logging

### 1. Prompt Intent
- Fix login failure ("Invalid email or password") for newly registered users:
  1. Inspect the login endpoint (`/api/auth/login`): ensure case-insensitive, whitespace-trimmed email lookup (`email.toLowerCase().trim()`).
  2. Ensure the query selects and retrieves the `passwordHash` column and verifies valid bcrypt hash format (`$2a$` / `$2b$`).
  3. Verify bcrypt password comparison (`bcrypt.compare(password, user.passwordHash)`).
  4. Ensure frontend login form sends trimmed email and password with `'Content-Type': 'application/json'`.
  5. Add explicit server-side debug logs for failure diagnostic visibility in the terminal ("User not found" vs "Password hash mismatch").
  6. Prevent seeder from overwriting registered users' passwords upon test suite runs.

### 2. Architecture & Design Decisions
- **Zod Schema Pre-Sanitization:**
  - Added `.trim().toLowerCase()` directly into `registerSchema` and `loginSchema` email fields to eliminate whitespace validation rejections prior to regex evaluation.
- **Case-Insensitive Database Querying:**
  - Updated `authController.login` to use `prisma.user.findFirst` with `{ email: { equals: normalizedEmail, mode: 'insensitive' } }`, guaranteeing matches regardless of client input casing.
- **Detailed Server-Side Diagnostic Telemetry:**
  - Added diagnostic logging in `AuthController.login`:
    - `[AUTH-LOGIN] Processing login attempt for email: "${normalizedEmail}"`
    - `[AUTH-LOGIN] User record found: id=..., email=..., role=..., hasValidBcryptHash=true, hashPrefix="$2b$12$..."`
    - `[AUTH-LOGIN] Failure: User not found for email "..."`
    - `[AUTH-LOGIN] Failure: Password hash mismatch for user "..."`
    - `[AUTH-LOGIN] Success: Password verified for user "..."`
- **Password Preservation in Seeder:**
  - Updated `seed.ts` to preserve custom user passwords on upsert: only system accounts ending with `@trustvault.local` or users without a password hash have their passwords initialized to default, preventing user-registered passwords from being reset.
- **Clean Form UX:**
  - Removed phantom password pre-filling in `client/src/components/Login.tsx` to prevent accidental credential collisions when switching personas or signing in with custom accounts.

### 3. Verification & Test Results
- Authored test cases in `tests/auth.test.ts` verifying:
  - Immediate sign-in for newly registered dynamic accounts.
  - Case-insensitive and whitespace-padded login (e.g. `"  NEWUSER@TRUSTVAULT.LOCAL  "`).
  - 401 rejection on invalid password with corresponding `AUTH_LOGIN_FAILED` audit logging.
- Ran `npm test`: All 6 test suites passed cleanly (63/63 tests passing).
- Ran client build: `npm --prefix client run build` passed with zero errors in 5.05s.

---

## Prompt 12: User Registration Simplification & Advanced Role-Management RBAC for Owner & Admin

### 1. Requirements Summary
1. **Registration Form Simplification:**
   - Remove "Assigned Persona Role" dropdown from the "Create TrustVault Account" registration form.
   - Enforce `role = 'VIEWER'` by default in payload and strictly on the backend (`POST /api/auth/register`), regardless of client overrides.
2. **Owner & Admin User Management Capabilities:**
   - Add User Management interface/modal accessible from dashboard navigation/header for users with role `OWNER` or `ADMIN`.
   - List all registered users (Email, Current Role, Created Date, Actions).
   - Deletion rules:
     - `ADMIN`: Can remove/delete any user (except self).
     - `OWNER`: Can remove/delete any `VIEWER` or other `OWNER`; CANNOT remove/delete an `ADMIN` (delete button disabled with tooltip: "Cannot delete an Admin account").
     - `VIEWER`: No access to user management or user deletion.
     - Self-deletion guard: Disallow users from deleting their own active session account.
   - Role Promotion / Demotion:
     - Dropdown on each row to promote/demote between `VIEWER`, `OWNER`, and `ADMIN`.
     - Rule: Prevent an `OWNER` from demoting or modifying an existing `ADMIN`'s role.
     - `ADMIN` maintains full modification rights over all accounts.
3. **Backend API Endpoints & RBAC Guards:**
   - `GET /api/users`: Guarded by role check (accessible only to `ADMIN` or `OWNER`).
   - `PATCH /api/users/:id/role`: Validates new role; returns 403 Forbidden ("Owners cannot alter Admin roles") if requester is `OWNER` and target is `ADMIN`. Emits audit log.
   - `DELETE /api/users/:id`: Returns 400 Bad Request if self-deletion; returns 403 Forbidden ("Owners cannot delete Admin accounts") if requester is `OWNER` and target is `ADMIN`. Cleans up owned document physical files and database records. Emits audit log.

### 2. Architecture & Design Decisions
- **Strict Role Enforcement on Registration:**
  - Modified `AuthController.register` in `src/controllers/auth.controller.ts` to assign `role: Role.VIEWER` unconditionally.
  - Removed role select dropdown from `client/src/components/Login.tsx` and replaced with an informative notice that new accounts are assigned `VIEWER` role by default.
- **RBAC Guards & Administrative User Routes:**
  - Updated `src/routes/user.routes.ts`:
    - `GET /api/users`: Protected with `authenticate, requireRoles(Role.ADMIN, Role.OWNER)`.
    - `PATCH /api/users/:id/role`: Enforces target existence, rejects attempts by `OWNER` to alter `ADMIN` roles with 403 and `USER_ROLE_CHANGE_DENIED` audit event.
    - `DELETE /api/users/:id`: Prevents self-deletion (`req.user.id === targetId`) with 400, prevents `OWNER` from deleting `ADMIN` accounts with 403 and `USER_DELETE_DENIED` audit event. Cleans up owned documents physical files from disk via `storageService.deleteFile` before cascading deletion in PostgreSQL.
- **CORS Method Support:**
  - Added `'PATCH'` to `app.use(cors(...))` allowed methods in `src/app.ts` to prevent browser preflight rejections.
- **Interactive User Management Modal & Navigation Integration:**
  - Created `client/src/components/UserManagementModal.tsx` providing live search, role dropdown selection with permission tooltips, inline delete confirmation, and feedback alerts.
  - Added a "Users" action button in `client/src/components/Navbar.tsx` visible exclusively to users with role `ADMIN` or `OWNER`.
  - Added client API methods `userApi.getUsers`, `userApi.updateRole`, and `userApi.deleteUser` in `client/src/services/api.ts`.

### 3. Verification & Test Results
- Authored comprehensive test cases in `tests/auth.test.ts`:
  - `POST /api/auth/register`: Verifies client payload role override is ignored and `VIEWER` is strictly assigned.
  - `GET /api/users`: Rejects unauthenticated (401), forbids VIEWER (403), allows OWNER (200), allows ADMIN (200).
  - `PATCH /api/users/:id/role`: Forbids VIEWER (403), forbids OWNER altering ADMIN (403), allows OWNER altering VIEWER (200), allows ADMIN altering any role (200).
  - `DELETE /api/users/:id`: Forbids self-deletion (400), forbids VIEWER (403), forbids OWNER deleting ADMIN (403), allows OWNER deleting VIEWER (200), allows ADMIN deleting user accounts (200).
- Ran `npm test`: All 6 test suites passed cleanly (**76/76 tests passing**).
- Ran `npm run build` in `client/`: Compiled successfully with zero errors in 1.84s.