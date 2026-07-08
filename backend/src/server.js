/**
 * EdgeFlow - Server entry point
 *
 * Boots the gateway:
 *   1. Run pending migrations
 *   2. Connect Redis (or fall back to in-memory)
 *   3. Warm the route cache
 *   4. Load persisted circuit-breaker state
 *   5. Reconcile the health-check scheduler
 *   6. Seed admin user if none exist
 *   7. Start the HTTP server
 *
 * Graceful shutdown: on SIGINT/SIGTERM we stop the scheduler, close the
 * HTTP server, drain the DB pool and Redis client, then exit.
 */

const http = require('http');
const config = require('./config');
const logger = require('./utils/logger');
const { migrate } = require('./database/migrations');
const db = require('./database/pool');
const redis = require('./database/redis');
const routeCache = require('./gateway/routeCache');
const healthScheduler = require('./services/healthScheduler');
const circuitBreaker = require('./services/circuitBreaker');
const authService = require('./services/authService');
const servicesService = require('./services/servicesService');
const { queryOne } = require('./database/pool');
const { createApp } = require('./app');

async function boot() {
  logger.info('server: booting EdgeFlow', { env: config.env, port: config.server.port });

  await migrate();
  await db.ping();
  logger.info('server: database ready');

  await redis.getClient();
  logger.info('server: redis ready', { fallback: redis.isFallback() });

  // ── Dependency Injection: wire up healthScheduler providers ──
  //
  // healthScheduler needs to load service data during health checks, but
  // servicesService needs healthScheduler to schedule checks when services
  // are created. To break this cycle, healthScheduler accepts injected
  // provider functions (set at boot time) and subscribes to eventBus
  // events instead of being called directly by servicesService.
  healthScheduler.setServiceProvider((id) => servicesService.getById(id));
  healthScheduler.setListProvider(() => servicesService.list({ enabledOnly: true }));
  healthScheduler.setHeartbeatUpdater((id, status, map) => servicesService.updateHeartbeat(id, status, map));

  await circuitBreaker.loadPersistedState();
  circuitBreaker.configure(config.gateway.circuitBreaker);

  await routeCache.warm();
  logger.info('server: route cache warmed', { routes: routeCache.size() });

  await seedAdminIfMissing();
  await healthScheduler.reconcile();

  const app = createApp();
  const server = http.createServer(app);
  server.timeout = config.gateway.requestTimeoutMs;
  server.keepAliveTimeout = 5000;

  server.listen(config.server.port, config.server.host, () => {
    logger.info(`server: listening on http://${config.server.host}:${config.server.port}`, {
      docs: `http://${config.server.host}:${config.server.port}/api/v1/docs`,
      gateway: `http://${config.server.host}:${config.server.port}${config.server.gatewayPrefix}`,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`server: received ${signal}, shutting down gracefully`);
    healthScheduler.stopAll();
    // Wait for in-flight requests to complete before closing DB/Redis.
    // server.close() stops accepting new connections but waits for
    // existing ones to finish (up to server.timeout).
    await new Promise((resolve) => server.close(() => {
      logger.info('server: http closed');
      resolve();
    }));
    try {
      await db.close();
      await redis.close();
    } catch (err) {
      logger.error('server: shutdown error', { error: err.message });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error('server: unhandledRejection', { error: err?.message, stack: err?.stack }));
  process.on('uncaughtException', (err) => { logger.error('server: uncaughtException', { error: err?.message, stack: err?.stack }); process.exit(1); });
}

async function seedAdminIfMissing() {
  try {
    const r = await queryOne('SELECT COUNT(*)::int AS c FROM users');
    if (r?.c > 0) { logger.info('server: admin user already exists, skipping seed'); return; }
    await authService.createUser({
      email: config.seed.adminEmail, name: config.seed.adminName,
      password: config.seed.adminPassword, role: 'admin',
    });
    logger.info('server: seeded admin user', { email: config.seed.adminEmail });
  } catch (err) { logger.warn('server: admin seed failed', { error: err.message }); }
}

boot().catch((err) => { logger.fatal('server: boot failed', { error: err.message, stack: err.stack }); process.exit(1); });
