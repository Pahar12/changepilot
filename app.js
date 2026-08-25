const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./src/config/env');

const apiRoutes = require('./src/routes');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    }
  })
);
app.use(express.json());

app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found'
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Must be registered last (after all routes and the 404 fallback) so Express
// routes errors here via next(err) or from async route throws (Express 5).
//
// Two recognised error shapes:
//
//   JSON parse error (body-parser):
//     err.type === 'entity.parse.failed'
//     → 400  { status: 'fail',  message: 'Invalid JSON' }
//
//   Everything else (Prisma, programming bugs, etc.):
//     → 500  { status: 'error', message: 'Internal server error' }
//
// The response is ALWAYS JSON and NEVER contains stack traces, file paths,
// database error codes, or any other internal detail.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Always log server-side so the error is observable in server logs.
  console.error('[error]', err);

  // ── JSON parse failure ────────────────────────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'fail', message: 'Invalid JSON' });
  }

  // ── All other errors: return a safe generic 500 ───────────────────────────
  return res.status(500).json({ status: 'error', message: 'Internal server error' });
});

module.exports = app;
