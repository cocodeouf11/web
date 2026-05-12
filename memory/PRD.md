# PRD — SignDevis (PDF Quote Management & Signature Platform)

## Original Problem Statement
Site web professionnel de gestion et signature de devis PDF avec 2 types d'accès :
- **Administrateur** : back-office pour uploader des PDF, générer des codes d'accès uniques, suivre les statuts.
- **Signataire** : accès direct via un code unique (format DEV-XXXXX-XX), signature à la souris/tactile, intégration de la signature dans le PDF.

## Architecture (current)
- **Frontend** : React 19 + React Router + Tailwind + shadcn/ui + Sonner + pdfjs-dist (Outfit / Manrope fonts).
- **Backend** : FastAPI + **SQLite** (SQLAlchemy + aiosqlite) — migrated from MongoDB due to AVX CPU limits on user's Debian server.
- **DB** : SQLite at `/app/backend/soizic.db`. Tables: `users`, `files`, `document_types`. Files stored as base64 (max 10 MB).
- **Auth** : JWT in httpOnly cookie + Bearer fallback, bcrypt password hashing. Users seeded from `/app/backend/config.py` on every startup.
- **PDF** : pypdf + reportlab overlay for signature + form-field text on dotted lines.

## Core Endpoints
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/me`
- `POST /api/files/upload` (multipart, supports `parent_id` for linked docs), `GET /api/files`, `GET /api/files/{id}`, `DELETE /api/files/{id}`
- `PATCH /api/files/{id}/status` · `PATCH /api/files/{id}/signature-position` · `PATCH /api/files/{id}/document-type` · `PATCH /api/files/{id}/fields` · `GET /api/files/{id}/linked` · `POST /api/files/{id}/generate-code`
- Document types: `GET/POST/PATCH/DELETE /api/document-types`
- Users (super_admin): `GET/POST/PATCH/DELETE /api/users`
- DB explorer (super_admin): `GET /api/admin/db/tables`, `GET /api/admin/db/table/{name}`
- Signer (public): `POST /api/access/verify`, `GET /api/access/file/{code}` (returns parent + children), `POST /api/access/sign/{code}` (signs all linked docs)

## Implemented features (Phase 1 + Sprint 2 — Feb 2026)
- ✅ Dual-access login (signer code / admin)
- ✅ Admin dashboard: stats, search, filter, sort, upload PDF, status badges
- ✅ PDF preview via pdfjs-dist canvas viewer (zoom, pages, download)
- ✅ Signature embedding (auto-cropped transparent PNG, 9-position selector OR free drag&drop)
- ✅ Access code generation + copy direct link
- ✅ Configurable users/roles from `config.py` with auto-sync
- ✅ Super-admin role + protected DB explorer
- ✅ Dark/Light theme toggle
- ✅ Document types (Devis, Attestation, Contrat, Bon de commande, custom)
- ✅ Multi-doc linking under one access code (parent_file_id)
- ✅ Form fields preset for Attestation (Nom, Prénom, Adresse, Code postal, Commune, Fait à, Le)
- ✅ Drag & Drop signature position editor (visual placement on PDF, x/y/width/height/page)
- ✅ Signer page: unified card UI (PDF left, fields+signature panel right) — style aligned with `remplisage.png`

## Test Credentials
- Admin: `admin` / `admin123` (super_admin role) — see `/app/memory/test_credentials.md`

## Backlog (P1/P2 — deferred)
- **P1**: Refactor `AdminDashboard.jsx` (928 lines) → extract `LinkDocumentDialog`, `TypesManagerDialog`, `FilesTable` into separate components
- **P1**: Refactor `server.py` (~1080 lines) → split into routers/files, /routers/auth, /routers/users
- **P1**: Brute-force lockout on `/api/auth/login` (track failed attempts per IP)
- **P1**: Rate-limit on `/api/access/*` to mitigate access-code brute-force
- **P1**: Pydantic validation of inner field shape on `PATCH /api/files/{id}/fields`
- **P2**: Per-field drag & drop positioning UI (not just signature) so admins can move all form-field anchors visually
- **P2**: Email notification when a document is signed
- **P2**: Audit log of signature events with IP + user agent
- **P2**: GridFS-equivalent / external storage for files >10MB
- **P2**: Customizable code prefix per project
- **P2**: PDF download buttons in admin dashboard (currently only preview)

## Test Reports
- `/app/test_reports/iteration_1.json` — Phase 1 tests
- `/app/test_reports/iteration_2.json` — Sprint 2 tests (Backend 5/5 PASS, Frontend ~90%)
- `/app/backend/tests/test_sprint2.py` — pytest regression suite for Sprint 2

## Critical Setup Notes for Next Agent
1. **SQLite (NOT MongoDB)** — DB file is `/app/backend/soizic.db`. Never try to install/connect MongoDB.
2. **PDF.js worker** — Must be in `/app/frontend/public/pdf.worker.min.mjs`. After `yarn install`, copy from `node_modules/pdfjs-dist/build/`.
3. **Config-driven users** — Edit `/app/backend/config.py` then restart backend; users are synced (created/renamed/password-synced).
4. **Language is French (fr-FR)** — All UI strings and toasts are in French.
