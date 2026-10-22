# TrustVault Prompt & Engineering Log

This file tracks all prompt intents, architectural decisions, bugs flagged, and manual corrections applied across the TrustVault development lifecycle.

---

## [2026-10-21] - Initial System Directives & Security Architecture

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

