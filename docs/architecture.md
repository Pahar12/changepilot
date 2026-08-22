# ChangePilot Architecture (Current Foundation)

## Current architecture

Client → Express API → PostgreSQL/Prisma

## Current backend foundation

- Node.js + Express API
- Basic security middleware with Helmet and CORS
- Environment-based configuration
- Prisma initialized for PostgreSQL
- Health endpoint at `/api/health`

## Planned future features (not implemented yet)

- Authentication and authorization
- Change request workflows
- Evidence tracking
- GitHub integration and webhooks
- AI and IBM Bob integration
- Docker-based development and deployment
- Production deployment pipeline
