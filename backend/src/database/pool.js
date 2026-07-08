/**
 * EdgeFlow - PostgreSQL connection pool
 *
 * Uses node-postgres (pg) directly. The Pool is created once and reused
 * for the lifetime of the process. Services in EdgeFlow call queryOne /
 * queryMany / queryRaw / tx directly - there is NO repository layer.
 */

const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

let pool = null;
let connectionState = 'disconnected';

function getPool() {
  if (pool) return pool;
  connectionState = 'connecting';
  pool = new Pool({
    connectionString: config.database.url,
    min: config.database.poolMin,
    max: config.database.poolMax,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
  });
  pool.on('connect', () => { connectionState = 'connected'; });
  pool.on('error', (err) => {
    connectionState = 'error';
    logger.error('pg: idle client error', { error: err.message });
  });
  return pool;
}

async function queryOne(text, params) {
  const r = await getPool().query(text, params);
  return r.rows[0] || null;
}

async function queryMany(text, params) {
  const r = await getPool().query(text, params);
  return r.rows;
}

async function queryRaw(text, params) {
  return getPool().query(text, params);
}

async function tx(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ping() {
  const start = Date.now();
  const r = await getPool().query('SELECT 1 AS ok');
  return {
    ok: r.rows[0]?.ok === 1,
    latencyMs: Date.now() - start,
    state: connectionState,
    pool: { total: pool?.totalCount || 0, idle: pool?.idleCount || 0, waiting: pool?.waitingCount || 0 },
  };
}

async function close() {
  if (!pool) return;
  await pool.end();
  pool = null;
  connectionState = 'disconnected';
}

module.exports = { getPool, queryOne, queryMany, queryRaw, tx, ping, close, getState: () => connectionState };
