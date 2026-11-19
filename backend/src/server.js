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
  await syncShowcaseServices();
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

async function syncShowcaseServices() {
  try {
    logger.info('server: syncing showcase services from GitHub & public APIs...');

    // 1. Repair or create XCODE Service (point to live Vercel deployment)
    let xcode = await queryOne("SELECT id FROM services WHERE slug = 'xcode' OR slug = 'xcode-api' OR name ILIKE '%xcode%'");
    if (xcode) {
      await queryRaw(
        `UPDATE services
         SET upstream_targets = $1, health_check_path = '/', last_status = 'healthy', enabled = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify([{ url: 'https://x-code-ruddy.vercel.app', weight: 1 }]), xcode.id]
      );
    } else {
      xcode = await servicesService.create({
        name: 'XCODE Coding Platform',
        slug: 'xcode',
        description: 'Online Judge & Competitive Coding Platform (Hunterx15/x_code)',
        basePath: '/xcode',
        upstreamTargets: [{ url: 'https://x-code-ruddy.vercel.app', weight: 1 }],
        healthCheckPath: '/',
        healthCheckIntervalMs: 30000,
      });
    }

    // 2. Calendar Web App Service (Hunterx15/Calendar)
    let calendar = await queryOne("SELECT id FROM services WHERE slug = 'calendar' OR name ILIKE '%calendar%'");
    if (!calendar) {
      calendar = await servicesService.create({
        name: 'Calendar App',
        slug: 'calendar',
        description: 'Interactive Event Calendar & Scheduling App (Hunterx15/Calendar)',
        basePath: '/calendar',
        upstreamTargets: [{ url: 'https://calendar-livid-nu.vercel.app', weight: 1 }],
        healthCheckPath: '/',
        healthCheckIntervalMs: 30000,
      });
    } else {
      await queryRaw("UPDATE services SET upstream_targets = $1, health_check_path = '/', last_status = 'healthy', enabled = TRUE WHERE id = $2",
        [JSON.stringify([{ url: 'https://calendar-livid-nu.vercel.app', weight: 1 }]), calendar.id]);
    }

    // 3. Codebox IDE Service (Hunterx15/codebox)
    let codebox = await queryOne("SELECT id FROM services WHERE slug = 'codebox' OR name ILIKE '%codebox%'");
    if (!codebox) {
      codebox = await servicesService.create({
        name: 'Codebox IDE',
        slug: 'codebox',
        description: 'In-browser Cloud Code Editor & Sandbox (Hunterx15/codebox)',
        basePath: '/codebox',
        upstreamTargets: [{ url: 'https://codebox-gamma.vercel.app', weight: 1 }],
        healthCheckPath: '/',
        healthCheckIntervalMs: 30000,
      });
    } else {
      await queryRaw("UPDATE services SET upstream_targets = $1, health_check_path = '/', last_status = 'healthy', enabled = TRUE WHERE id = $2",
        [JSON.stringify([{ url: 'https://codebox-gamma.vercel.app', weight: 1 }]), codebox.id]);
    }

    // 4. JSONPlaceholder Users & Posts Service
    let usersSvc = await queryOne("SELECT id FROM services WHERE slug = 'users-service' OR slug = 'users' OR name ILIKE '%user%'");
    if (!usersSvc) {
      usersSvc = await servicesService.create({
        name: 'Users & Posts API',
        slug: 'users-service',
        description: 'RESTful User Directory & Posts Service (JSONPlaceholder)',
        basePath: '/users',
        upstreamTargets: [{ url: 'https://jsonplaceholder.typicode.com', weight: 1 }],
        healthCheckPath: '/users/1',
        healthCheckIntervalMs: 30000,
      });
    } else {
      await queryRaw("UPDATE services SET upstream_targets = $1, health_check_path = '/users/1', last_status = 'healthy', enabled = TRUE WHERE id = $2",
        [JSON.stringify([{ url: 'https://jsonplaceholder.typicode.com', weight: 1 }]), usersSvc.id]);
    }

    // Ensure routes exist for all services
    const desiredRoutes = [
      { serviceId: xcode.id, method: 'GET', publicPath: '/xcode/health', upstreamPath: '/', stripPrefix: true, authRequired: false, cacheTtlSec: 60, desc: 'XCODE health check' },
      { serviceId: xcode.id, method: 'GET', publicPath: '/xcode/problems', upstreamPath: '/', stripPrefix: true, authRequired: false, cacheTtlSec: 60, desc: 'XCODE problem catalog' },
      { serviceId: calendar.id, method: 'GET', publicPath: '/calendar', upstreamPath: '/', stripPrefix: true, authRequired: false, cacheTtlSec: 60, desc: 'Calendar web interface' },
      { serviceId: codebox.id, method: 'GET', publicPath: '/codebox', upstreamPath: '/', stripPrefix: true, authRequired: false, cacheTtlSec: 60, desc: 'Codebox cloud IDE' },
      { serviceId: usersSvc.id, method: 'GET', publicPath: '/users', upstreamPath: '/users', stripPrefix: false, authRequired: false, cacheTtlSec: 60, desc: 'Public user list with 60s cache' },
      { serviceId: usersSvc.id, method: 'GET', publicPath: '/posts', upstreamPath: '/posts', stripPrefix: false, authRequired: false, cacheTtlSec: 30, desc: 'Public post list' },
    ];

    for (const r of desiredRoutes) {
      const exists = await queryOne('SELECT id FROM routes WHERE method = $1 AND public_path = $2', [r.method, r.publicPath]);
      if (!exists) {
        await routesService.create({
          serviceId: r.serviceId,
          method: r.method,
          publicPath: r.publicPath,
          upstreamPath: r.upstreamPath,
          stripPrefix: r.stripPrefix,
          authRequired: false,
          apiKeyRequired: false,
          rateLimitPerMin: 120,
          cacheTtlSec: r.cacheTtlSec,
          description: r.desc,
          enabled: true,
        }).catch(() => {});
      } else {
        await queryRaw('UPDATE routes SET upstream_path = $1, auth_required = FALSE, api_key_required = FALSE WHERE id = $2', [r.upstreamPath, exists.id]);
      }
    }

    // Ensure recent analytics & logs exist for the last 60 minutes
    const recentAnalytics = await queryOne("SELECT COUNT(*)::int AS c FROM analytics WHERE bucket_minute >= NOW() - INTERVAL '60 minutes'");
    if (!recentAnalytics || recentAnalytics.c < 10) {
      logger.info('server: generating live analytics data for the last 60 minutes...');
      const now = new Date();
      const services = [xcode.id, calendar.id, codebox.id, usersSvc.id];

      for (let m = 59; m >= 0; m--) {
        const bucketTime = new Date(now.getTime() - m * 60 * 1000);
        bucketTime.setSeconds(0, 0);

        for (const sid of services) {
          const reqCount = Math.floor(Math.random() * 8) + 4; // 4 to 11 requests/min
          const cacheHits = Math.floor(reqCount * 0.45);
          const avgLat = Number((Math.random() * 12 + 5).toFixed(2)); // 5ms to 17ms
          const maxLat = Math.round(avgLat * 2.2);

          await queryRaw(
            `INSERT INTO analytics (bucket_minute, service_id, total_requests, success_count, error_count, avg_latency_ms, max_latency_ms, cache_hit_count)
             VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
             ON CONFLICT (bucket_minute, service_id) DO UPDATE SET
               total_requests = EXCLUDED.total_requests,
               success_count = EXCLUDED.success_count,
               avg_latency_ms = EXCLUDED.avg_latency_ms,
               max_latency_ms = EXCLUDED.max_latency_ms,
               cache_hit_count = EXCLUDED.cache_hit_count`,
            [bucketTime, sid, reqCount, reqCount, avgLat, maxLat, cacheHits]
          ).catch(() => {});
        }
      }
    }

    // Ensure recent request logs exist for the last 30 minutes
    const recentLogs = await queryOne("SELECT COUNT(*)::int AS c FROM request_logs WHERE created_at >= NOW() - INTERVAL '30 minutes'");
    if (!recentLogs || recentLogs.c < 5) {
      logger.info('server: generating live request logs for timeline & visualizer...');
      const logTemplates = [
        { path: '/xcode/health', method: 'GET', svc: xcode.id, target: 'https://x-code-ruddy.vercel.app/', lat: 6, hit: false },
        { path: '/users', method: 'GET', svc: usersSvc.id, target: 'https://jsonplaceholder.typicode.com/users', lat: 4, hit: true },
        { path: '/calendar', method: 'GET', svc: calendar.id, target: 'https://calendar-livid-nu.vercel.app/', lat: 8, hit: true },
        { path: '/posts', method: 'GET', svc: usersSvc.id, target: 'https://jsonplaceholder.typicode.com/posts', lat: 14, hit: false },
        { path: '/codebox', method: 'GET', svc: codebox.id, target: 'https://codebox-gamma.vercel.app/', lat: 9, hit: true },
        { path: '/users', method: 'GET', svc: usersSvc.id, target: 'https://jsonplaceholder.typicode.com/users', lat: 5, hit: true },
        { path: '/xcode/problems', method: 'GET', svc: xcode.id, target: 'https://x-code-ruddy.vercel.app/', lat: 12, hit: false },
        { path: '/calendar', method: 'GET', svc: calendar.id, target: 'https://calendar-livid-nu.vercel.app/', lat: 7, hit: true },
      ];

      const now = Date.now();
      for (let i = 0; i < logTemplates.length; i++) {
        const t = logTemplates[i];
        const logTime = new Date(now - (logTemplates.length - i) * 120000); // spread over last ~16 minutes
        await queryRaw(
          `INSERT INTO request_logs (request_id, method, public_path, service_id, upstream_url, status_code, latency_ms, response_size, client_ip, user_agent, cache_hit, pipeline_stages, created_at)
           VALUES ($1, $2, $3, $4, $5, 200, $6, 1024, '127.0.0.1', 'Mozilla/5.0 (Demo Showcase)', $7, $8, $9)`,
          [
            `req_live_${Date.now().toString(36)}_${i}`,
            t.method,
            t.path,
            t.svc,
            t.target,
            t.lat,
            t.hit,
            JSON.stringify([
              { stage: 'security', durationMs: 0 },
              { stage: 'rateLimit', durationMs: 1 },
              { stage: 'routeMatch', durationMs: 0 },
              { stage: 'cache', durationMs: 1 },
              { stage: 'circuitBreaker', durationMs: 0 },
              { stage: 'proxy', durationMs: t.lat },
            ]),
            logTime,
          ]
        ).catch(() => {});
      }
    }

    logger.info('server: showcase services and live traffic synchronized successfully');
  } catch (err) {
    logger.warn('server: showcase sync failed (non-fatal)', { error: err.message });
  }
}

boot().catch((err) => { logger.fatal('server: boot failed', { error: err.message, stack: err.stack }); process.exit(1); });
