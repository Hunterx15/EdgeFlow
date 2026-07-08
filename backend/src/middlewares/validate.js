/**
 * EdgeFlow - Validation middleware
 *
 * Tiny alternative to Joi/Zod. Each schema is a function that returns
 * the cleaned value or throws ValidationError.
 */

const { ValidationError } = require('../utils/http');

function body(schema) {
  return (req, _res, next) => {
    try { req.body = schema(req.body || {}); next(); } catch (err) { next(err); }
  };
}
function query(schema) {
  return (req, _res, next) => {
    try { req.query = schema(req.query || {}); next(); } catch (err) { next(err); }
  };
}
function params(schema) {
  return (req, _res, next) => {
    try { req.params = schema(req.params || {}); next(); } catch (err) { next(err); }
  };
}

const isString = (v, { max = 1024 } = {}) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isOptionalString = (v, opts) => v === undefined || v === null || isString(v, opts);
const isBoolean = (v) => typeof v === 'boolean';
const isOptionalBoolean = (v) => v === undefined || v === null || isBoolean(v);
const isInt = (v, { min = -Infinity, max = Infinity } = {}) => {
  const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max;
};
const isOptionalInt = (v, opts) => v === undefined || v === null || v === '' || isInt(v, opts);
const ensureRequired = (v, f) => {
  if (v === undefined || v === null || v === '') throw new ValidationError(`'${f}' is required`);
  return v;
};

module.exports = {
  body, query, params,
  isString, isOptionalString, isBoolean, isOptionalBoolean,
  isInt, isOptionalInt, ensureRequired,
};
