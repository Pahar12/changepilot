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
- `/api/v1/changes` — ChangeRequest CRUD and lifecycle endpoints (`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `POST /:id/submit`, `POST /:id/approve`, `POST /:id/reject`, `POST /:id/close`).

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
- ChangeRequest CRUD and lifecycle APIs
- PostgreSQL + Prisma persistence
- ChangeRequest validation and state transitions
- User model with role definitions
- ChangeRequest ownership foundation
- Automated integration tests
- GitHub Actions CI

### In progress:
- Authentication
- RBAC enforcement
- Evidence tracking

### Planned:
- GitHub integration
- AI and IBM Bob integration
- Docker and deployment setup
