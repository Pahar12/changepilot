# ChangePilot

**Evidence-driven change management and AI-assisted release risk assessment.**

ChangePilot is a backend platform for managing software change requests through a controlled lifecycle while using **evidence-aware AI** to assess release risk.

Instead of allowing AI to make operational decisions autonomously, ChangePilot keeps humans in control: AI produces a structured risk assessment and recommendation, while authentication, RBAC, lifecycle transitions, evidence ownership, and auditability remain enforced by the application.

> **Built for the [AI Builders Hackathon](https://ai-builders-hackathon-2026.devpost.com/)**
>
> *Building the Future of Intelligent Systems. The Internet Needs Better AI.*

---

## Why ChangePilot?

Software changes can introduce operational, security, reliability, and deployment risks. A useful change-management system needs more than a form and a status field.

ChangePilot combines:

* Structured change-request management
* Role-based access control
* Ownership enforcement
* Evidence collection
* Evidence-aware AI risk assessment
* Structured AI output validation
* Centralized audit event recording
* Secure lifecycle transitions
* PostgreSQL persistence through Prisma
* Automated testing and CI

The core design principle is:

> **AI assists the reviewer; AI does not become the reviewer.**

---

## Core Workflow

```text
                    ┌─────────────────────┐
                    │   Change Request    │
                    │ description + risk  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Evidence       │
                    │ supporting context  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   AI Risk Analysis  │
                    │ structured advisory │
                    │     assessment      │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Human Review / RBAC │
                    │ approve / reject    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     Audit Trail     │
                    │ recorded business   │
                    │       events        │
                    └─────────────────────┘
```

---

## Key Features

### 1. Change Request Lifecycle

Change requests follow a controlled state machine:

```text
DRAFT
  │
  ▼
UNDER_REVIEW
  ├──────────────► APPROVED
  └──────────────► REJECTED
                         │
                         ▼
                       CLOSED
```

Implemented lifecycle operations include:

* Create
* List
* Retrieve
* Update
* Submit
* Approve
* Reject
* Close

Lifecycle transitions are protected by authentication, authorization, ownership, and validation rules.

---

### 2. Authentication & RBAC

ChangePilot uses authenticated users and role-based access control.

Supported roles:

| Role        | Capabilities                                               |
| ----------- | ---------------------------------------------------------- |
| `REQUESTER` | Create, list, view, update own drafts, submit own requests |
| `REVIEWER`  | Review requests and perform review lifecycle actions       |
| `ADMIN`     | Full ChangeRequest access                                  |

Public registration cannot select a privileged role. Newly registered users are created as `REQUESTER`.

Authentication uses:

* scrypt password hashing
* HS256 JWT authentication
* Protected API routes
* Requester ownership enforcement
* Role-based authorization

---

### 3. Evidence Management

Evidence provides supporting context for a ChangeRequest.

Implemented endpoints:

```text
POST /api/v1/changes/:id/evidence
GET  /api/v1/changes/:id/evidence
GET  /api/v1/evidence/:id
```

Evidence access follows the same ownership/RBAC model as ChangeRequests.

Evidence is treated as **user-submitted, untrusted data**.

It is never treated as executable instructions for the AI.

---

### 4. Evidence-Aware AI Risk Assessment

ChangePilot provides:

```text
POST /api/v1/changes/:id/analyze
```

The AI analysis pipeline considers:

* ChangeRequest description
* ChangeRequest metadata
* Supporting Evidence
* Structured risk-assessment rules

The result is validated against a structured schema and persisted as an `AIAnalysis` record.

The architecture supports an AI provider abstraction with:

* Deterministic fake provider for development/testing
* OpenAI provider foundation for real AI integration

### AI safety boundary

The AI **cannot**:

* Approve a ChangeRequest
* Reject a ChangeRequest
* Submit a ChangeRequest
* Close a ChangeRequest
* Modify Evidence
* Modify ChangeRequest lifecycle state

The AI only produces an advisory assessment.

Final operational decisions remain with authorized human users.

---

## AI + Evidence Security

Evidence can contain arbitrary user-provided text, so ChangePilot explicitly treats it as untrusted input.

The AI prompt pipeline:

1. Retrieves only evidence attached to the requested ChangeRequest.
2. Separates ChangeRequest information from Evidence.
3. Labels Evidence as untrusted supporting context.
4. Prevents evidence content from being interpreted as system instructions.
5. Produces structured output.
6. Validates the AI response before persistence.
7. Keeps AI recommendations separate from lifecycle authorization.

This creates a clear security boundary between:

```text
User-controlled Evidence
        ↓
AI analysis
        ↓
Structured recommendation
        ↓
Human decision + RBAC
```

---

## Audit Trail

ChangePilot uses a centralized audit service for important business events.

Recorded events include:

```text
CHANGE_CREATED
CHANGE_UPDATED
CHANGE_SUBMITTED
CHANGE_APPROVED
CHANGE_REJECTED
CHANGE_CLOSED

EVIDENCE_CREATED

AI_ANALYSIS_COMPLETED
AI_ANALYSIS_FAILED
```

Audit events are recorded alongside the business operations they describe where applicable.

The audit service also validates metadata to prevent sensitive values such as passwords, tokens, API keys, authorization headers, and credentials from being written into audit metadata.

---

## Security Hardening

The backend includes several security-focused controls:

* Helmet
* CORS configuration
* JWT authentication
* Role-based authorization
* Ownership enforcement
* Request validation
* Malformed JSON handling
* Safe global error handling
* Environment validation
* Prisma database access
* Transactional business mutations
* AI output schema validation
* Evidence prompt-injection protection
* Login timing-side-channel mitigation
* IDOR regression coverage

### IDOR protection

A security review identified and fixed an authorization gap where ChangeRequests could potentially be retrieved outside the requester's ownership boundary.

ChangeRequest retrieval and listing now apply requester ownership restrictions while preserving unrestricted access for authorized reviewer/admin roles.

A dedicated regression test suite was added:

```text
tests/idorRegression.test.js
```

---

## Technology Stack

### Backend

* Node.js
* JavaScript
* Express 5
* Prisma ORM
* PostgreSQL

### AI

* Provider abstraction
* Deterministic fake AI provider
* OpenAI provider foundation
* Structured AI schema validation
* Evidence-aware prompting

### Security

* Helmet
* CORS
* JWT
* scrypt
* RBAC
* Ownership checks
* Input validation
* Audit logging

### Development

* ESLint
* Node test runner
* Git
* GitHub Actions
* PostgreSQL

---

## Project Structure

```text
.
├── app.js
├── server.js
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── src/
│   ├── ai/
│   │   ├── index.js
│   │   ├── promptBuilder.js
│   │   ├── schema.js
│   │   └── providers/
│   │       ├── fakeProvider.js
│   │       └── openaiProvider.js
│   ├── config/
│   ├── controllers/
│   ├── lib/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   │   ├── aiAnalysisService.js
│   │   ├── auditService.js
│   │   ├── changeService.js
│   │   └── evidenceService.js
│   └── validators/
├── tests/
├── docs/
└── .github/
    └── workflows/
```

---

## API Overview

### Health

```text
GET /api/health
```

### Authentication

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/me
```

### ChangeRequests

```text
POST  /api/v1/changes
GET   /api/v1/changes
GET   /api/v1/changes/:id
PATCH /api/v1/changes/:id

POST /api/v1/changes/:id/submit
POST /api/v1/changes/:id/approve
POST /api/v1/changes/:id/reject
POST /api/v1/changes/:id/close
```

### Evidence

```text
POST /api/v1/changes/:id/evidence
GET  /api/v1/changes/:id/evidence
GET  /api/v1/evidence/:id
```

### AI Analysis

```text
POST /api/v1/changes/:id/analyze
```

---

## Getting Started

### Requirements

* Node.js
* PostgreSQL
* npm

### 1. Clone the repository

```bash
git clone https://github.com/Pahar12/changepilot.git
cd changepilot
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Configure the required values:

```env
PORT=3000
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/changepilot?schema=public"
JWT_SECRET="replace-this-in-production"
JWT_EXPIRES_IN=86400
CORS_ORIGIN="http://localhost:3000"
AI_PROVIDER="fake"
```

`.env` is intentionally ignored by Git.

### 4. Generate Prisma Client

```bash
npx prisma generate
```

### 5. Apply database migrations

```bash
npx prisma migrate deploy
```

### 6. Start the development server

```bash
npm run dev
```

Or:

```bash
npm start
```

The API runs on:

```text
http://localhost:3000
```

---

## Testing

Run the test suite with:

```bash
npm test
```

Run linting with:

```bash
npm run lint
```

The repository also contains GitHub Actions CI that installs dependencies, generates Prisma Client, applies migrations, runs integration tests against PostgreSQL, and runs linting.

> Some integration tests require a working PostgreSQL/Prisma environment. The deterministic AI provider allows AI-related unit tests to run without external AI network access.

---

## Current Status

### Implemented

* Authentication
* JWT authorization
* RBAC
* ChangeRequest CRUD
* ChangeRequest lifecycle
* Ownership enforcement
* Evidence creation/retrieval
* Evidence-aware AI analysis
* Structured AI output validation
* AI provider abstraction
* Fake AI provider
* OpenAI provider foundation
* Centralized audit trail
* Security hardening
* IDOR regression coverage
* Error handling
* Prisma/PostgreSQL persistence
* Automated tests
* GitHub Actions CI

### Intentionally Deferred

* Evidence update/delete
* Audit retrieval API
* Rate limiting / abuse controls
* Production deployment infrastructure
* Full frontend experience

These are documented limitations rather than hidden gaps.

---

## Roadmap

### Near Term

* Evidence update/delete
* Audit retrieval and visualization
* Rate limiting
* Production deployment
* Frontend dashboard

### Future

* GitHub integration
* Change-aware CI/CD workflows
* Multi-agent AI orchestration
* Deployment risk signals
* Docker-based deployment
* Cloud infrastructure

---

## Hackathon

### AI Builders Hackathon

ChangePilot was built for the **AI Builders Hackathon**, an open-ended AI product challenge focused on building useful AI-powered applications that solve real-world problems.

The hackathon emphasizes:

* Innovation & Creativity
* Technical Implementation
* Problem Solving & Impact
* User Experience & Design
* Presentation & Demo

ChangePilot focuses on a practical application of AI: **helping software teams assess change risk while keeping humans responsible for operational decisions.**

**Hackathon:**
https://ai-builders-hackathon-2026.devpost.com/

**Repository:**
https://github.com/Pahar12/changepilot

---

## Design Principles

ChangePilot is built around five principles:

### 1. AI should assist, not control

AI provides recommendations; authorized humans make lifecycle decisions.

### 2. Evidence should be useful but untrusted

User-provided evidence can improve context but must never become an instruction channel for the AI.

### 3. Authorization belongs to the application

RBAC and ownership checks—not AI output—determine what a user can do.

### 4. Important actions should be auditable

Business mutations and AI events are recorded through a centralized audit mechanism.

### 5. Security should be part of the architecture

Authentication, authorization, validation, error handling, ownership boundaries, and AI safety are treated as core application concerns rather than afterthoughts.

---

## License

See [LICENSE](LICENSE).
