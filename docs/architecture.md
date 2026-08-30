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
- Authentication endpoints at `/api/v1/auth/register`, `/api/v1/auth/login`, and `/api/v1/auth/me`
- Custom scrypt password hashing and HS256 JWT authentication
- RBAC middleware enforcing REQUESTER / REVIEWER / ADMIN access rules
- Change request endpoints under `/api/v1/changes`
- Requester ownership enforced on create, update, and submit flows

## Planned future features (not implemented yet)

- Evidence tracking
- GitHub integration and webhooks
- AI and IBM Bob integration
- Docker-based development and deployment
- Production deployment pipeline
