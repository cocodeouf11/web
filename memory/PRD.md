# PRD — SignDevis (PDF Quote Management & Signature Platform)

## Original Problem Statement
Site web professionnel de gestion et signature de devis PDF avec 2 types d'accès :
- **Administrateur** : back-office pour uploader des PDF, générer des codes d'accès uniques, suivre les statuts.
- **Signataire** : accès direct via un code unique (format DEV-XXXXX-XX), signature à la souris/tactile, intégration de la signature dans le PDF.

## Architecture
- **Frontend**: React 19 + React Router + Tailwind + shadcn/ui + Sonner toasts (Outfit / Manrope fonts, Apple-style white/blue/grey).
- **Backend**: FastAPI + Motor (async MongoDB), JWT (bcrypt), pypdf + reportlab + Pillow for signature embedding.
- **DB**: MongoDB collections: `users`, `files`. Files stored as base64 (max 10MB).
- **Auth**: JWT in httpOnly cookie + Bearer fallback (localStorage). Admin seeded on startup.

## Core Endpoints
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/files/upload` (multipart), `GET /api/files`, `GET /api/files/{id}`, `DELETE /api/files/{id}`, `PATCH /api/files/{id}/status`, `GET /api/files/{id}/download`
- `POST /api/files/{id}/generate-code` → DEV-XXXXX-XX
- `POST /api/access/verify`, `GET /api/access/file/{code}`, `POST /api/access/sign/{code}` (public)

## Implemented (2026-02)
- ✅ Dual-access login page (signer code / admin username+password)
- ✅ Admin dashboard: stats (total/signed/unsigned), search, filter, upload (PDF only), table with status badges, code generation with copy, view PDF in dialog, toggle status, delete with confirm
- ✅ Signature page: PDF preview iframe + HTML5 canvas signature (mouse + touch), clear, validate
- ✅ PDF signature embedding (last page, bottom-right, with timestamp)
- ✅ Idempotent admin seeding from .env (admin/admin123)
- ✅ Protected routes, sticky glassmorphism header, Apple-style design
- ✅ data-testid on all interactive elements
- ✅ Tested: 100% backend (pytest 7/7), 100% frontend (Playwright E2E)

## Test Credentials
- Admin: `admin` / `admin123` (see `/app/memory/test_credentials.md`)

## Backlog (P1/P2 — deferred)
- P1: Brute-force lockout on /api/auth/login
- P1: Rate-limit on /api/access/* to prevent code bruteforcing
- P2: GridFS migration for files >10MB
- P2: Email notification when document is signed
- P2: Multi-admin / role hierarchy
- P2: Audit log of signature events with IP + user agent
- P2: PDF download buttons in admin dashboard (currently only preview)
- P2: Customizable code prefix per project (e.g., INV-, CTR-)
