const dotenv = require('dotenv');

dotenv.config();

// ── Startup environment validation ──────────────────────────────────────────
// Fail fast, with a clear message, for configuration the application
// genuinely cannot run without — rather than letting it surface later as a
// cryptic Prisma connection error deep in a request. Never print the actual
// value of a secret in these messages.
//
// DATABASE_URL is the only variable treated as hard-required here: every
// request path goes through Prisma, in every environment (dev/test/prod), so
// there is no reasonable default for it. Everything else in this file either
// has a safe development default or is validated lazily where it's used
// (e.g. OPENAI_API_KEY is only needed if AI_PROVIDER=openai — see
// src/ai/providers/openaiProvider.js) so that optional/dev-only variables
// don't become unnecessarily mandatory.
if (!process.env.DATABASE_URL) {
  throw new Error('Missing required environment variable: DATABASE_URL. Set it in your .env file (see .env.example).');
}

// JWT_SECRET has a fallback below so a fresh checkout still boots and tests
// still run without any .env setup. That fallback is a known, publicly
// visible value (it's in source control), so anyone running with it is
// effectively running without real JWT security. Warn loudly rather than
// staying silent about it, without making local development harder.
if (!process.env.JWT_SECRET) {
  console.warn(
    '[warn] JWT_SECRET is not set — falling back to a well-known development ' +
      'secret. Tokens signed with this secret can be forged by anyone who has ' +
      'read the ChangePilot source. Set JWT_SECRET before running in production.'
  );
}

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const parsedJwtExpiresIn = Number.parseInt(process.env.JWT_EXPIRES_IN || '86400', 10);

module.exports = {
  port:         process.env.PORT || 3000,
  databaseUrl:  process.env.DATABASE_URL,
  jwtSecret:    process.env.JWT_SECRET || 'changepilot-dev-secret-key-replace-in-production',
  jwtExpiresIn: Number.isInteger(parsedJwtExpiresIn) && parsedJwtExpiresIn > 0 ? parsedJwtExpiresIn : 86400,
  corsOrigins,

  // AI provider configuration (see src/ai/index.js).
  // Defaults to "fake" so the app runs and tests pass with zero AI
  // configuration; real analysis requires explicitly setting AI_PROVIDER=openai.
  aiProvider:   process.env.AI_PROVIDER || 'fake',
  openaiApiKey: process.env.OPENAI_API_KEY || ''
};
