# TrustVault Threat Model & Security Mitigations

This document outlines the threat modeling, attack surfaces, and explicit defensive controls implemented across TrustVault to counter IDOR, BOLA, Stale JWTs, and Audit Log Tampering.

---

## 1. Threat Matrix Overview

| Threat Category | CWE / OWASP Reference | Risk Level | Primary Defense Layer | TrustVault Architecture Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **Insecure Direct Object Reference (IDOR)** | CWE-639 / OWASP Top 10 A01:2021 | Critical | Storage Abstraction & Path Isolation | Private storage isolated with UUID storage keys; zero direct file paths exposed. |
| **Broken Object Level Authorization (BOLA)** | OWASP API Security Top 10: API1:2023 | Critical | Authorization Middleware (RBAC + ABAC) | Server-side authorization middleware runs prior to controller; emits `DENIED` audit log before 403. |
| **Stale JWTs & Revocation Bypass** | CWE-613 / CWE-384 | High | Database-backed Token Revocation | Synchronous database revocation check on `jti` for *every* authenticated request. |
| **Audit Log Tampering & Repudiation** | CWE-778 / CWE-353 | High | Cryptographic Hash Chaining & Append-Only DB | Blockchain-style SHA-256 hash chaining on all log entries; strictly append-only. |

---

## 2. Insecure Direct Object References (IDOR)

### Threat Vector
An attacker attempts to access or manipulate raw disk storage or files using predictable identifiers, directory traversal sequences (`../../`), or direct file system paths (`/var/data/doc1.pdf`, `C:\vault\secret.txt`).

### Concrete Vulnerability Scenarios
1. **Directory Traversal:** Malicious file parameter `GET /download?file=../../etc/passwd`.
2. **Direct URI Leaks:** Exposing internal storage paths or direct web-accessible static URLs (`https://vault.local/storage/uploads/tenantA_payroll.pdf`).
3. **Storage Enumeration:** Iterating sequential filenames (`1001.pdf`, `1002.pdf`) in the storage volume.

### TrustVault Defensive Architecture
1. **Opaque Storage Keys:**
   - Physical documents are written to a non-public storage root (`STORAGE_DIR`) using randomly generated UUIDv4 storage keys (e.g. `storageKey = c87b5d92-fa12-4221-a3f8-62287c80529d`).
   - The user or client NEVER learns or receives the storage key, filesystem directory, or storage layout.
2. **Complete Absence of Static File Serving:**
   - No `express.static()` middleware is mounted for document assets.
   - All assets are served strictly through programmatic Node.js streaming handlers (`res.pipe()`) that set content headers (`Content-Disposition: attachment; filename="..."`, `Content-Type: <mime>`) using sanitized metadata fetched from PostgreSQL.
3. **Path Traversal Shield:**
   - Document lookup always queries the database via UUID primary keys (`id`).
   - The storage layer resolves files strictly by joining the fixed storage root with the internal UUID storage key and asserts that the resolved path is within the designated vault directory boundary.

---

## 3. Broken Object Level Authorization (BOLA)

### Threat Vector
An authenticated user possessing a valid token attempts to read, download, edit, share, or delete documents belonging to another tenant or owner by changing the document ID in the route parameters (`GET /api/v1/documents/:id/download`).

### Concrete Vulnerability Scenarios
1. **Horizontal Privilege Escalation:** User B (Viewer or Owner) accesses a confidential document created by Owner A.
2. **Vertical Privilege Escalation:** A Viewer attempts to invoke document deletion or grant permissions to other users.
3. **Silent Bypass via Direct Download Route:** A download route lacking authorization middleware, relying solely on whether the user is logged in.

### TrustVault Defensive Architecture
1. **Mandatory Authorization Middleware:**
   - Architecture Rule 3 dictates: *Every document read/download request MUST pass through server authorization middleware.*
   - Routes `/api/v1/documents/:id`, `/api/v1/documents/:id/view`, and `/api/v1/documents/:id/download` intercept requests through `authorizeDocument(requiredPermission)`.
2. **Dual-Layer Evaluation (RBAC + ABAC):**
   - **ADMIN:** Granted universal access for administrative oversight.
   - **OWNER (Resource Owner):** Direct owners (`document.ownerId === req.user.id`) possess full read/write/delete capabilities.
   - **EXPLICIT GRANTEES (ABAC):** Non-owners are evaluated against the `DocumentPermission` table for explicit grants (`READ` or `WRITE`).
3. **Mandatory DENIED Audit Log Emission Before HTTP 403:**
   - Architecture Rule 5 dictates: *All security checks that fail must emit a DENIED audit log before returning HTTP 403.*
   - If a user fails the authorization check, `auditService.logSecurityEvent(...)` synchronously logs a `DENIED` status with user ID, target document ID, client IP, User-Agent, and failure reason before sending the HTTP 403 response.

---

## 4. Stale JWTs and Revocation Bypass

### Threat Vector
In stateless JWT implementations, tokens remain valid until expiration even after:
- User logs out.
- User changes credentials or role is revoked/demoted.
- Session is terminated due to suspicious activity.
- Stolen bearer tokens are used by malicious actors.

### Concrete Vulnerability Scenarios
1. **Replay after Logout:** A token captured before logout remains accepted by API servers for the remaining TTL.
2. **Demoted User Exploitation:** An Admin is demoted to Viewer, but retains Admin claims until the JWT expires.

### TrustVault Defensive Architecture
1. **Unique Token Identity (`jti`):**
   - Every JWT minted by TrustVault includes a cryptographic UUIDv4 claim (`jti`).
2. **Synchronous Database Revocation Verification on Every Request:**
   - Architecture Rule 4 dictates: *Token revocation must be verified against the database on every authenticated request.*
   - In `auth.middleware.ts`, after verifying the signature and expiration of the JWT, the server issues a query:
     ```typescript
     const isRevoked = await prisma.revokedToken.findUnique({
       where: { jti: decoded.jti }
     });
     if (isRevoked) {
       await auditService.logSecurityEvent({
         action: 'AUTH_BLOCKED',
         status: 'DENIED',
         userId: decoded.id,
         reason: 'Revoked/stale JWT presented',
         ...
       });
       return res.status(401).json({ error: 'Token has been revoked' });
     }
     ```
3. **Explicit Logout & Token Invalidation API:**
   - When a user logs out (`POST /api/v1/auth/logout`), the token's `jti`, expiration timestamp, and optional reason are recorded into `RevokedToken`.
   - Admins can revoke all tokens for any user on demand (`POST /api/v1/auth/revoke-user-tokens`).

---

## 5. Audit Log Tampering & Repudiation

### Threat Vector
An adversary or malicious insider gains database access and modifies, deletes, or truncates audit logs to conceal unauthorized access, document exfiltration, or privilege abuse.

### Concrete Vulnerability Scenarios
1. **Log Record Modification:** Changing a `DENIED` status to `ALLOWED` or altering timestamps to fabricate alibis.
2. **Log Insertion/Deletion:** Removing records of exfiltration or inserting false events.
3. **Repudiation:** Users denying that their account performed a sensitive download or deletion.

### TrustVault Defensive Architecture

#### 1. Cryptographic Hash-Chaining (Blockchain-Style Integrity)
- Each audit log entry includes:
  - `previousHash`: The `currentHash` of the immediately preceding audit log record (or a fixed 64-zero genesis hash `0000000000000000000000000000000000000000000000000000000000000000` for the initial entry).
  - `currentHash`: The SHA-256 digest computed deterministically over all entry attributes:
    ```
    currentHash = SHA256(`${previousHash}:${timestamp}:${userId}:${action}:${documentId}:${status}`)
    ```

#### 2. Mitigations Against Audit Log Spoofing (Fabrication & Modification)
- **Mathematical Immutability:** Because each block's seal incorporates `previousHash` along with its contextual data (`timestamp`, `userId`, `action`, `documentId`, `status`), an attacker cannot inject a fabricated log entry or modify an existing entry (e.g. flipping `DENIED` to `SUCCESS` or changing timestamps) without invalidating both its own `currentHash` and the `previousHash` of all subsequent blocks.
- **Server-Side Controlled Sealing:** Audit records can only be created via the internal `auditLogger.ts` utility during server request handling. No client-facing API exists to supply or alter hash fields.
- **Immediate Detection:** Any modified attribute causes `verifyAuditChain()` to flag an immediate `isValid: false` verdict and expose the exact corrupted row ID (`corruptedAtId`).

#### 3. Mitigations Against Audit Log Truncation & Deletion
- **Intermediate Record Deletion:** If an attacker deletes a record in the middle of the log, the subsequent record's `previousHash` will no longer match the `currentHash` of the record that now precedes it. The chain break is instantly flagged by `verifyAuditChain()`.
- **Genesis & Head Truncation:** If the initial records are deleted, the new first record's `previousHash` will point to a non-existent parent hash rather than the expected `GENESIS_HASH` (64 zeroes), instantly tripping validation.
- **Tail Truncation Defense:** Complete chain verification checks the integrity of all stored rows. External monitoring and write-ahead replication ensure that log counts remain monotonically increasing.

#### 4. Admin Audit Viewer & Chain Verification API
- Protected under `authenticate` and `requireRole(['ADMIN'])`:
  - `GET /api/admin/audit-logs`: Secure, paginated log viewer with search filters (`userId`, `documentId`, `status`, `startDate`, `endDate`).
  - `GET /api/admin/audit-logs/verify`: Triggers `verifyAuditChain()` and returns a definitive cryptographic verdict (`VERIFIED` or `TAMPER_DETECTED`).

---

## 6. Security Assurance & Verification Matrix

| Directive / Goal | Verification Mechanism | Status |
| :--- | :--- | :--- |
| **No Direct Paths / Public URLs** | Inspect response payloads; test for absence of `express.static`; verify UUID storage keys. | Implemented |
| **Auth Middleware on Read/Download** | Test `GET /documents/:id/download` with unauthenticated and unauthorized tokens. | Implemented |
| **Token Revocation on Every Request** | Revoke token via logout; immediately issue authenticated request; assert HTTP 401. | Implemented |
| **DENIED Audit Log on 403** | Attempt unauthorized document download; assert HTTP 403; verify database has `DENIED` audit record. | Implemented |
| **Audit Hash Chain Integrity** | Run hash verification routine across audit records; assert tamper detection. | Implemented |
| **Magic-Byte MIME Validation** | Upload spoofed extension / executable buffer; assert HTTP 400 Bad Request. | Implemented |
| **UUID Storage Isolation** | Verify uploaded assets on disk use strictly UUID filenames in `storage/documents`. | Implemented |

---

## 7. Malicious File Uploads & Advanced IDOR Mitigations

### Threat Vectors & Attack Surfaces
Attackers frequently exploit file upload workflows through:
1. **Extension Spoofing & Header Tampering (CWE-434):**
   - An attacker supplies an executable or webshell (`payload.php`, `exploit.sh`, `backdoor.exe`) but sets the HTTP request header `Content-Type: application/pdf` or renames the file to `invoice.pdf`.
   - Naive applications relying on `file.mimetype` or `path.extname()` accept the file and expose the server to Remote Code Execution (RCE) or Client-Side Execution (Stored XSS).
2. **Polyglot Files (CWE-434 / CWE-116):**
   - Attackers construct hybrid files (e.g. image/PDF headers combined with valid shellscript or HTML/JavaScript payloads) to bypass superficial validators.
3. **Path Traversal via User Filenames (CWE-22):**
   - User-supplied filenames containing directory traversal sequences (e.g., `../../../../etc/cron.d/malicious`) attempt to overwrite sensitive OS or application files.
4. **Insecure Direct Object Reference (IDOR) on Document APIs (CWE-639):**
   - Enumerating sequential or guessed document IDs to read, update, or revoke permissions on other tenants' files.

### TrustVault Phase 2 Defenses

#### 1. True MIME Magic-Byte Buffer Inspection (`fileValidator.ts`)
- **Zero Trust in Client-Supplied Headers:** TrustVault never relies on `req.file.mimetype` or file extensions.
- **Buffer Inspection with `file-type`:** Every uploaded file buffer is inspected by reading its header magic bytes.
- **Strict Whitelist:** Only four MIME types are permitted:
  - `application/pdf` (`%PDF-` `0x25 0x50 0x44 0x46`)
  - `image/png` (`0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`)
  - `image/jpeg` (`0xFF 0xD8 0xFF`)
  - `text/plain` (Enforces absence of binary null bytes `0x00`, absence of PE/ELF/Mach-O headers, and valid UTF-8 character encoding).
- **Immediate Disk Cleanup on Rejection:** If magic byte validation fails, the uploaded file is purged immediately from `storage/documents` and HTTP 400 Bad Request is returned.

#### 2. Random UUID Storage Filenames & Directory Isolation
- Uploaded assets are routed via Multer directly to a dedicated private storage directory `storage/documents` located completely outside the public web root.
- The user-supplied filename is never used as the filesystem path. Instead, a cryptographically random UUIDv4 (`uuidv4()`) is assigned as the disk filename (e.g., `storage/documents/f47ac10b-58cc-4372-a567-0e02b2c3d479`).
- User original filenames are sanitized with `path.basename()` and stored only as descriptive metadata in PostgreSQL.

#### 3. Granular Document RBAC & Permission Enforcement
- Every read, download, edit, or delete action is guarded by `authorizeDocument('READ' | 'EDIT' | 'DELETE')`.
- Permission evaluation:
  - `ADMIN`: Global access.
  - `OWNER`: Full control over owned documents.
  - `EXPLICIT PERMISSION`: Evaluated against the `Permission` table (`EDIT` implies `READ`).
- Any unauthorized access attempt logs a `DENIED` audit event before returning HTTP 403 Forbidden.

