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

/**
 * validateQuery — wraps a pure validator function in Express middleware for
 * query-string parameters.
 *
 * The validator receives req.query and returns { errors, data }.
 * On failure → 400 JSON with the errors array.
 * On success → stores the validated, parsed data in req.parsedQuery and calls next().
 *
 * Note: req.query is NOT mutated. Express 5 recomputes req.query from the URL
 * on every access, so mutations do not persist. Downstream handlers must read
 * from req.parsedQuery to get typed values (numbers, filter objects) rather
 * than raw query strings.
 *
 * @param {Function} validatorFn  (query) => { errors: Array, data: Object|null }
 * @returns {Function} Express middleware (req, res, next)
 */
function validateQuery(validatorFn) {
  return function (req, res, next) {
    const { errors, data } = validatorFn(req.query);

    if (errors.length > 0) {
      return res.status(400).json({ status: 'fail', errors });
    }

    // Express 5 computes req.query fresh from the URL on every access —
    // mutations to the returned object do not persist between reads.
    // Store the validated, parsed data in a dedicated property instead so
    // the controller always reads typed values (numbers, objects) rather
    // than raw query strings.
    req.parsedQuery = data;
    next();
  };
}

module.exports = { validateBody, validateQuery };
