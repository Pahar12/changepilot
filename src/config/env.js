const dotenv = require('dotenv');

dotenv.config();

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const parsedJwtExpiresIn = Number.parseInt(process.env.JWT_EXPIRES_IN || '86400', 10);

module.exports = {
  port:         process.env.PORT || 3000,
  databaseUrl:  process.env.DATABASE_URL || '',
  jwtSecret:    process.env.JWT_SECRET || 'changepilot-dev-secret-key-replace-in-production',
  jwtExpiresIn: Number.isInteger(parsedJwtExpiresIn) && parsedJwtExpiresIn > 0 ? parsedJwtExpiresIn : 86400,
  corsOrigins
};
