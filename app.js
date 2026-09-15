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
    status: 'fail',
    message: 'Route not found'
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Must be registered last (after all routes and the 404 fallback) so Express
// routes errors here via next(err) or from async route throws (Express 5).
//
// Recognised error shapes:
//
//   JSON parse error (body-parser):
//     err.type === 'entity.parse.failed'
//     → 400  { status: 'fail',  message: 'Invalid JSON' }
//     Expected/operational: caused by a malformed client request, not a
//     server bug. Logged as a single controlled line (method + path) —
//     never the raw SyntaxError object. Logging the raw error here would
//     print body-parser's internal stack trace (and its node_modules file
//     paths) to the server console for something that is just bad client
//     input, not something requiring investigation.
//
//   Disallowed CORS origin (see cors() config above):
//     err.message === 'Not allowed by CORS'
//     → 403  { status: 'fail',  message: 'Not allowed by CORS' }
//     Also expected/operational — logged as a single controlled line.
//
//   Everything else (Prisma, programming bugs, etc.):
//     → 500  { status: 'error', message: 'Internal server error' }
//     Unexpected: logged in full, including the stack trace, so it stays
//     debuggable server-side.
//
// The HTTP response is ALWAYS JSON and NEVER contains stack traces, file
// paths, database error codes, or any other internal detail, for either
// error shape.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // ── JSON parse failure — expected client error ──────────────────────────
  if (err.type === 'entity.parse.failed') {
    console.warn(`[warn] malformed JSON body: ${req.method} ${req.originalUrl}`);
    return res.status(400).json({ status: 'fail', message: 'Invalid JSON' });
  }

  // ── Disallowed CORS origin — expected client condition, not a bug ──────
  // The cors() middleware above calls its origin callback with an Error for
  // any origin not in env.corsOrigins, which otherwise surfaces here as an
  // "unexpected" 500 with a full stack trace for something that is really
  // just a routine, expected rejection.
  if (err.message === 'Not allowed by CORS') {
    console.warn(`[warn] blocked request from disallowed origin: ${req.headers.origin || 'unknown'}`);
    return res.status(403).json({ status: 'fail', message: 'Not allowed by CORS' });
  }

  // ── Everything else: unexpected — log in full, respond generically ─────
  console.error('[error]', err);
  return res.status(500).json({ status: 'error', message: 'Internal server error' });
});

module.exports = app;
