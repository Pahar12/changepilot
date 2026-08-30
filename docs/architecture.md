# ChangePilot Architecture (Current Foundation)

## Current architecture

Client → Express API → PostgreSQL/Prisma

## Current backend foundation

- Node.js + Express API
- Basic security middleware with Helmet and CORS
- Environment-based configuration
- Prisma initialized for PostgreSQL
  - `User` model with `UserRole` (`REQUESTER`, `REVIEWER`, `ADMIN`)
  - `ChangeRequest` lifecycle and risk models
  - User → ChangeRequest ownership relation via nullable `createdById` (backward compatible)
- Health endpoint at `/api/health`
- Change request endpoints under `/api/v1/changes`

## Planned future features (not implemented yet)

- Authentication and authorization API flows (registration, login, JWT verification)
- Role-based access control (RBAC) middleware
- Evidence tracking
- GitHub integration and webhooks
- AI and IBM Bob integration
- Docker-based development and deployment
- Production deployment pipeline
