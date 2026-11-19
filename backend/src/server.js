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
const serviceCache = require('./gateway/serviceCache');
const healthScheduler = require('./services/healthScheduler');
const circuitBreaker = require('./services/circuitBreaker');
const authService = require('./services/authService');
const servicesService = require('./services/servicesService');
const routesService = require('./services/routesService');
const logBatcher = require('./services/logBatcher');
const analyticsService = require('./services/analyticsService');
const apiKeysService = require('./services/apiKeysService');
const { queryOne, queryRaw } = require('./database/pool');
const { createApp } = require('./app');

async function boot() {
  logger.info('server: booting EdgeFlow', { env: config.env, port: config.server.port });

  // Resilient DB connection retry for cloud/serverless cold boots (e.g. Render PostgreSQL)
  const maxDbAttempts = 5;
  for (let attempt = 1; attempt <= maxDbAttempts; attempt++) {
    try {
      await migrate();
      await db.ping();
      logger.info('server: database ready');
      break;
    } catch (err) {
      if (attempt === maxDbAttempts) {
        throw err;
      }
      logger.warn(`server: database connection attempt ${attempt}/${maxDbAttempts} failed, retrying in 2s...`, {
        error: err.message,
      });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

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
  await circuitBreaker.initSubscriber();

  await routeCache.warm();
  logger.info('server: route cache warmed', { routes: routeCache.size() });

  await serviceCache.warm();
  logger.info('server: service cache warmed', { services: serviceCache.size() });

  await seedAdminIfMissing();
  await seedDemoDataIfMissing();
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
      logger.info('server: flushing pending logs, metrics, and key usage...');
      await Promise.allSettled([
        logBatcher.flush(),
        analyticsService.flush(),
        apiKeysService.flushUsage(),
      ]);
      await circuitBreaker.close();
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

async function seedDemoDataIfMissing() {
  try {
    const r = await queryOne('SELECT COUNT(*)::int AS c FROM services');
    if (r?.c > 0) {
      logger.info('server: services already exist, skipping demo seed');
      return;
    }

    logger.info('server: seeding demo services and routes for live showcase...');

    // 1. JSONPlaceholder Users & Posts Service
    const usersSvc = await servicesService.create({
      name: 'Users & Posts Service',
      slug: 'users-service',
      description: 'Public REST API microservice for user profiles, posts, and comments',
      basePath: '/users',
      upstreamTargets: [{ url: 'https://jsonplaceholder.typicode.com', weight: 1 }],
      healthCheckPath: '/users/1',
      healthCheckIntervalMs: 30000,
    });

    await routesService.create({
      serviceId: usersSvc.id,
      method: 'GET',
      publicPath: '/users',
      upstreamPath: '/users',
      stripPrefix: false,
      authRequired: false,
      apiKeyRequired: false,
      rateLimitPerMin: 120,
      cacheTtlSec: 60,
      description: 'Fetch user list with 60s Redis response caching',
      enabled: true,
    });

    await routesService.create({
      serviceId: usersSvc.id,
      method: 'GET',
      publicPath: '/posts',
      upstreamPath: '/posts',
      stripPrefix: false,
      authRequired: false,
      apiKeyRequired: false,
      rateLimitPerMin: 120,
      cacheTtlSec: 30,
      description: 'Fetch community posts',
      enabled: true,
    });

    // 2. XCODE Coding Platform API
    const xcodeSvc = await servicesService.create({
      name: 'XCODE Coding Platform',
      slug: 'xcode-api',
      description: 'Production Online Judge backend with 66+ DSA problem catalog',
      basePath: '/xcode',
      upstreamTargets: [{ url: 'https://x-code-backend-f87c.onrender.com', weight: 1 }],
      healthCheckPath: '/health',
      healthCheckIntervalMs: 30000,
    });

    await routesService.create({
      serviceId: xcodeSvc.id,
      method: 'GET',
      publicPath: '/xcode/health',
      upstreamPath: '/health',
      stripPrefix: true,
      authRequired: false,
      apiKeyRequired: false,
      rateLimitPerMin: 100,
      cacheTtlSec: 0,
      description: 'XCODE platform heartbeat check',
      enabled: true,
    });

    // 3. HTTP Echo Gateway (Multi-replica for Weighted Round Robin)
    const echoSvc = await servicesService.create({
      name: 'HTTP Echo Gateway',
      slug: 'echo-service',
      description: 'Multi-target echo service demonstrating smooth weighted round-robin load balancing',
      basePath: '/echo',
      upstreamTargets: [
        { url: 'https://httpbin.org', weight: 2 },
        { url: 'https://postman-echo.com', weight: 1 },
      ],
      healthCheckPath: '/get',
      healthCheckIntervalMs: 30000,
    });

    await routesService.create({
      serviceId: echoSvc.id,
      method: 'GET',
      publicPath: '/echo/get',
      upstreamPath: '/get',
      stripPrefix: true,
      authRequired: false,
      apiKeyRequired: false,
      rateLimitPerMin: 100,
      cacheTtlSec: 0,
      description: 'Echo GET request parameters',
      enabled: true,
    });

    // Seed Demo API Key if none exist
    const k = await queryOne('SELECT COUNT(*)::int AS c FROM api_keys');
    if (k?.c === 0) {
      await apiKeysService.issue({
        name: 'Demo Explorer Key',
        scopes: ['read', 'write'],
        rateLimitPerMin: 120,
      });
      logger.info('server: seeded demo API key');
    }

    // Seed initial demo logs if request_logs is empty for analytics & timeline
    const l = await queryOne('SELECT COUNT(*)::int AS c FROM request_logs');
    if (l?.c === 0) {
      const now = Date.now();
      const sampleLogs = [
        { path: '/users', method: 'GET', status: 200, latency: 8, cacheHit: true, upstream: 'https://jsonplaceholder.typicode.com/users', svcId: usersSvc.id },
        { path: '/posts', method: 'GET', status: 200, latency: 14, cacheHit: false, upstream: 'https://jsonplaceholder.typicode.com/posts', svcId: usersSvc.id },
        { path: '/xcode/health', method: 'GET', status: 200, latency: 4, cacheHit: false, upstream: 'https://x-code-backend-f87c.onrender.com/health', svcId: xcodeSvc.id },
        { path: '/echo/get', method: 'GET', status: 200, latency: 19, cacheHit: false, upstream: 'https://httpbin.org/get', svcId: echoSvc.id },
        { path: '/users', method: 'GET', status: 200, latency: 6, cacheHit: true, upstream: 'https://jsonplaceholder.typicode.com/users', svcId: usersSvc.id },
      ];

      for (let i = 0; i < sampleLogs.length; i++) {
        const item = sampleLogs[i];
        const logTime = new Date(now - (sampleLogs.length - i) * 60000);
        await queryRaw(
          `INSERT INTO request_logs (request_id, method, public_path, service_id, upstream_url, status_code, latency_ms, response_size, client_ip, user_agent, cache_hit, pipeline_stages, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            `req_demo_${i + 1}`,
            item.method,
            item.path,
            item.svcId,
            item.upstream,
            item.status,
            item.latency,
            512,
            '127.0.0.1',
            'Mozilla/5.0 (Demo Client)',
            item.cacheHit,
            JSON.stringify([
              { stage: 'security', durationMs: 0 },
              { stage: 'rateLimit', durationMs: 1 },
              { stage: 'routeMatch', durationMs: 0 },
              { stage: 'cache', durationMs: 1 },
              { stage: 'circuitBreaker', durationMs: 0 },
              { stage: 'proxy', durationMs: item.latency },
            ]),
            logTime,
          ]
        );
      }
      logger.info('server: seeded demo request logs for timeline & analytics');
    }

    logger.info('server: successfully seeded demo services, routes, and keys for live dashboard');
  } catch (err) {
    logger.warn('server: demo data seed failed (non-fatal)', { error: err.message });
  }
}

boot().catch((err) => { logger.fatal('server: boot failed', { error: err.message, stack: err.stack }); process.exit(1); });
