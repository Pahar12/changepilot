'use strict';

/**
 * middleware/index.js — shared Express middleware factories.
 */

/**
 * validateBody — wraps a pure validator function in Express middleware.
 *
 * The validator receives req.body and returns { errors, data }.
 * On failure → 400 JSON with the errors array.
 * On success → writes sanitised data back to req.body and calls next().
 *
 * This keeps validator functions free of Express concepts (testable in isolation)
 * while wiring them into the Express middleware chain here.
 *
 * @param {Function} validatorFn  (body) => { errors: Array, data: Object|null }
 * @returns {Function} Express middleware (req, res, next)
 */
function validateBody(validatorFn) {
  return function (req, res, next) {
    const { errors, data } = validatorFn(req.body);

    if (errors.length > 0) {
      return res.status(400).json({ status: 'fail', errors });
    }

    // Replace req.body with the sanitised, trimmed values so downstream
    // layers (controller, service) never touch raw input.
    req.body = data;
    next();
  };
}

module.exports = { validateBody };
