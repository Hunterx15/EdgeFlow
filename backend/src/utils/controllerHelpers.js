/**
 * EdgeFlow - Shared controller utilities
 *
 * Helpers extracted from controllers to eliminate duplicated code:
 *   - parsePagination: consistent limit/offset parsing with clamping
 *   - parseBoolean: strict boolean parsing from request bodies
 */

/**
 * Parse and clamp pagination params from req.query.
 *
 * @param {object} query - req.query
 * @param {number} defaultLimit - default page size (default 100)
 * @param {number} maxLimit - maximum page size (default 500)
 * @returns {{ limit: number, offset: number, page: number }}
 */
function parsePagination(query = {}, defaultLimit = 100, maxLimit = 500) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  const page = Math.floor(offset / limit) + 1;
  return { limit, offset, page };
}

/**
 * Strict boolean parsing from a request body.
 *
 * Accepts: true, false, "true", "false".
 * Rejects: 1, 0, "1", "0", "yes", "no" (returns the fallback).
 *
 * @param {*} v - the value to parse
 * @param {boolean} fallback - default if value is not a valid boolean
 * @returns {boolean}
 */
function parseBoolean(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

module.exports = { parsePagination, parseBoolean };
