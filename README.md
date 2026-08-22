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

## API endpoint available now

- `GET /api/health`
  - Returns a simple JSON response to confirm the API is running.

## Prisma setup status

Prisma is initialized for PostgreSQL with a basic `schema.prisma` configuration.

No application-specific models or migrations have been created yet.

## CI workflow

GitHub Actions runs:

- dependency installation (`npm ci`)
- linting (`npm run lint`)
- tests (`npm test`)

No fake tests are included.

## Current status

✅ Foundation only. The following are **planned** and not implemented yet:

- Authentication
- Change requests and CRUD workflows
- Evidence tracking
- GitHub integration
- AI and IBM Bob integration
- Docker and deployment setup
