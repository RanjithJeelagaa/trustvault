# TrustVault

TrustVault is an enterprise-grade secure document vault and authorization engine built with **Node.js, Express, TypeScript, PostgreSQL, and Prisma ORM**.

## Live Production Deployment & Demo Credentials

- **Live URL:** https://trustvault-w92h.onrender.com
- **Admin Persona:** `admin@trustvault.local` | `Password123!`
- **Document Owner Persona:** `owner@trustvault.local` | `Password123!`
- **Viewer Persona:** `viewer@trustvault.local` | `Password123!`

## Core Architectural Directives

1. **Node.js + Express + TypeScript with Prisma ORM & PostgreSQL:** Strongly-typed enterprise architecture.
2. **Never expose direct file system paths or public URLs for document assets:** Files are saved using UUIDv4 storage keys in an isolated vault directory; downloads and reads are streamed programmatically with safe HTTP headers. Zero static file serving.
3. **Every document read/download request MUST pass through server authorization middleware:** Strict RBAC + ABAC controls verify user identity and document authorization prior to executing controller logic.
4. **Token revocation must be verified against the database on every authenticated request:** Every JWT contains a unique `jti`. Stale, logged-out, or revoked tokens are verified synchronously against the PostgreSQL `revoked_tokens` table on every call.
5. **All security checks that fail must emit a DENIED audit log before returning HTTP 403:** Mandatory append-only cryptographic audit logging with SHA-256 hash chaining to prevent tampering and repudiation.

---

## Required Artifacts

- [THREATS.md](file:///d:/trustvault/THREATS.md): Threat modeling and explicit defenses against IDOR, BOLA, Stale JWTs, and Audit Tampering.
- [PROMPTS.md](file:///d:/trustvault/PROMPTS.md): Dated engineering log tracking prompt intents, bugs flagged, and manual corrections applied.
- [seed.ts](file:///d:/trustvault/seed.ts): Database seeding providing pre-seeded test accounts:
  - **Admin:** `admin@trustvault.local` / `Password123!`
  - **Owner:** `owner@trustvault.local` / `Password123!`
  - **Viewer:** `viewer@trustvault.local` / `Password123!`

---

## Quickstart & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and set your PostgreSQL database connection string:
```bash
cp .env.example .env
```

### 3. Generate Prisma Client & Migrate Schema
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Seed Default Accounts
```bash
npx tsx seed.ts
```

### 5. Run the Server
```bash
# Development mode with live reload
npm run dev

# Production build and run
npm run build
npm start
```

### 6. Run Test Suite
```bash
npm test
```

---

## API Overview

### Authentication (`/api/v1/auth`)
- `POST /login` - Authenticate with email & password, returns JWT with unique `jti`.
- `POST /logout` - Invalidate current session and record token `jti` in `revoked_tokens`.
- `GET /me` - Retrieve authenticated user profile and role.
- `POST /users/:userId/revoke` - *(Admin only)* Revoke all tokens for a target user.

### Documents (`/api/v1/documents`)
- `POST /` - Upload document (`OWNER` or `ADMIN` only; multipart form-data with `file`).
- `GET /` - List accessible documents for the authenticated user.
- `GET /:id` - Retrieve document metadata (protected by `authorizeDocument('READ')`).
- `GET /:id/download` - Stream document asset (protected by `authorizeDocument('READ')`).
- `GET /:id/view` - Stream document asset for viewing (protected by `authorizeDocument('READ')`).
- `POST /:id/share` - Grant explicit `READ` or `WRITE` permissions (owner or admin only).
- `DELETE /:id` - Delete document and backing storage asset (owner or admin only).

### Audit & Security Logs (`/api/v1/audit`)
- `GET /` - *(Admin only)* Retrieve paginated security and access audit logs.
- `GET /verify` - *(Admin only)* Validate cryptographic SHA-256 hash chain across all audit entries.
