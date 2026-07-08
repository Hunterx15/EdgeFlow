/**
 * EdgeFlow - Structured Logger
 *
 * A tiny, dependency-light logger with 5 levels, pretty printing for dev,
 * JSON lines for production, and child loggers via logger.child().
 */

const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const currentLevel = LEVELS[config.logging.level] ?? LEVELS.info;
const isPretty = config.logging.format === 'pretty' && config.isDevelopment;

const COLORS = {
  debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m',
  error: '\x1b[31m', fatal: '\x1b[35m', reset: '\x1b[0m',
};

function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }

function log(level, message, meta = {}) {
  if (LEVELS[level] < currentLevel) return;
  const ts = new Date().toISOString();
  const line = isPretty
    ? `${COLORS[level]}[${ts}] ${level.toUpperCase().padEnd(5)}${COLORS.reset} ${message} ${Object.keys(meta).length ? safeStringify(meta) : ''}`
    : safeStringify({ time: ts, level, msg: message, ...meta });
  if (level === 'error' || level === 'fatal') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const logger = {
  debug: (m, meta) => log('debug', m, meta),
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta),
  fatal: (m, meta) => log('fatal', m, meta),
  child: (bindings = {}) => ({
    debug: (m, meta) => log('debug', m, { ...bindings, ...meta }),
    info: (m, meta) => log('info', m, { ...bindings, ...meta }),
    warn: (m, meta) => log('warn', m, { ...bindings, ...meta }),
    error: (m, meta) => log('error', m, { ...bindings, ...meta }),
    fatal: (m, meta) => log('fatal', m, { ...bindings, ...meta }),
    child: (more = {}) => logger.child({ ...bindings, ...more }),
  }),
};

module.exports = logger;
