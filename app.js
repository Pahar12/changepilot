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

module.exports = app;
