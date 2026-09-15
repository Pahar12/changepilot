# ChangePilot

ChangePilot is an **evidence-driven software change and release readiness platform**.

This repository currently contains a clean, minimal backend foundation for learning and incremental feature development.

## Current technology stack

- Node.js (JavaScript)
- Express
- PostgreSQL (via Prisma setup)
- Helmet + CORS for basic API security
- ESLint for linting
- GitHub Actions for CI

## Project structure

```text
.
├── app.js
├── server.js
├── prisma/
│   └── schema.prisma
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── validators/
├── docs/
│   └── architecture.md
└── .github/workflows/ci.yml
```

## Getting started

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Copy the example file and update values:

```bash
cp .env.example .env
```

Required variables:

- `PORT` (default in example: `3000`)
- `DATABASE_URL` (PostgreSQL connection string)
- `CORS_ORIGIN` (allowed client origin)

> `.env` is intentionally ignored by Git.

### 3) Run the backend

```bash
npm run dev
```

or

```bash
npm start
```

The API will be available at `http://localhost:3000` by default.

## API endpoints available now

- `GET /api/health` — Returns status to confirm the API is running.
- `POST /api/v1/auth/register` — Public registration, always creates a REQUESTER account.
- `POST /api/v1/auth/login` — Returns a JWT for valid credentials.
- `GET /api/v1/auth/me` — Returns the authenticated user profile.
- `/api/v1/changes` — ChangeRequest CRUD and lifecycle endpoints (`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `POST /:id/submit`, `POST /:id/approve`, `POST /:id/reject`, `POST /:id/close`).
- `POST /api/v1/changes/:id/analyze` — runs an Evidence-aware AI risk assessment for a ChangeRequest and persists the result. See `docs/architecture.md` for the AI layer.
- `POST /api/v1/changes/:id/evidence`, `GET /api/v1/changes/:id/evidence`, `GET /api/v1/evidence/:id` — Evidence creation and retrieval. See `docs/architecture.md` for the ownership model.

## Authorization model

- REQUESTER: create, list, view, update DRAFT, submit own requests.
- REVIEWER: list, view, approve, reject, close.
- ADMIN: full ChangeRequest access.
- Public registration cannot select a role; all registered users start as REQUESTER.

## Database & Prisma status

PostgreSQL database managed with Prisma ORM:
- `ChangeRequest` model with lifecycle state machine and risk levels.
- `User` model with role definitions (`REQUESTER`, `REVIEWER`, `ADMIN`).
- ChangeRequest ownership foundation linking requests to users via nullable `createdById`.

## CI workflow

GitHub Actions runs:

- dependency installation (`npm ci`)
- Prisma Client generation (`npx prisma generate`)
- Prisma migration deployment (`npx prisma migrate deploy`)
- integration tests (`npm test`) against an isolated PostgreSQL service container
- linting (`npm run lint`)

## Current status

### Implemented:

- Authentication endpoints with scrypt password hashing and HS256 JWTs
- RBAC enforcement for REQUESTER, REVIEWER, and ADMIN
- ChangeRequest CRUD and lifecycle APIs
- PostgreSQL + Prisma persistence
- ChangeRequest validation and state transitions
- User model with role definitions
- ChangeRequest ownership enforcement
- Evidence creation and retrieval (`POST/GET /api/v1/changes/:id/evidence`, `GET /api/v1/evidence/:id`) with the same ownership/RBAC model as ChangeRequest — see `docs/architecture.md`
- Automated integration tests
- GitHub Actions CI
- AI risk analysis (Phases 1 & 4): provider abstraction, structured risk assessment, validation, persistence, and audit events on `POST /api/v1/changes/:id/analyze`. Analysis considers both the ChangeRequest itself and any Evidence attached to it — Evidence is treated as supporting context (untrusted, user-submitted data), never as instructions to the AI, and it can only ever reduce an assessed risk score, never invent risk. **AI is strictly advisory**: it produces a structured `AIAnalysis` record and recommendation only — it cannot approve, reject, submit, or close a ChangeRequest, or modify Evidence, under any circumstance. See `docs/architecture.md` for the full pipeline and prompt-injection handling.
- Centralized audit trail (Phase 3): `CHANGE_CREATED/UPDATED/SUBMITTED/APPROVED/REJECTED/CLOSED`, `EVIDENCE_CREATED`, and `AI_ANALYSIS_COMPLETED/FAILED` are all recorded through one helper (`src/services/auditService.js`), atomically with the business write they document — see `docs/architecture.md` for the full event table, actor-integrity model, and metadata-safety guarantees.

### In progress:
- Evidence update/delete (not yet built — only create/list/get exist)
- An audit retrieval API — events are recorded but not yet exposed through an endpoint (deliberately deferred; see `docs/architecture.md`)
- No rate limiting or other abuse-control mechanism exists yet (see `docs/architecture.md` Phase 5 notes)

### Planned:

- GitHub integration
- Multi-agent AI orchestration
- Docker and deployment setup
