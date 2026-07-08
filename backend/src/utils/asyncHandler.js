/**
 * EdgeFlow - Async handler wrapper
 *
 * Express 4 doesn't auto-forward promise rejections from async route
 * handlers. This wraps them so rejections go to next(err).
 */

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
