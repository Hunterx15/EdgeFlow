const request = require('supertest');

jest.mock('../database/pool', () => ({
  getPool: () => ({ query: async () => ({ rows: [] }), on: () => {} }),
  queryOne: jest.fn().mockResolvedValue(null),
  queryMany: jest.fn().mockResolvedValue([]),
  queryRaw: jest.fn().mockResolvedValue({ rows: [] }),
  tx: jest.fn().mockImplementation((cb) => cb({ query: async () => ({ rows: [] }) })),
  ping: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1, state: 'connected', pool: { total: 1, idle: 1, waiting: 0 } }),
  close: jest.fn().mockResolvedValue(),
  getState: () => 'connected',
}));

jest.mock('../database/redis', () => ({
  getClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    info: jest.fn().mockResolvedValue('redis_version:mock\n'),
    dbSize: jest.fn().mockResolvedValue(0),
    flushAll: jest.fn().mockResolvedValue('OK'),
  }),
  isFallback: () => false,
  ping: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1, fallback: false }),
  info: jest.fn().mockResolvedValue('redis_version:mock\n'),
  dbSize: jest.fn().mockResolvedValue(0),
  close: jest.fn().mockResolvedValue(),
}));

const { createApp } = require('../app');

describe('API Gateway Core App Endpoints', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('GET /health returns 200 and ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('edgeflow');
  });

  test('GET / and HEAD / return 200 for cloud health checks', async () => {
    const resGet = await request(app).get('/');
    expect(resGet.status).toBe(200);
    expect(resGet.body.status).toBe('ok');
    expect(resGet.body.service).toBe('edgeflow');

    const resHead = await request(app).head('/');
    expect(resHead.status).toBe(200);
  });

  test('GET /api/v1/unknown returns 404', async () => {
    const res = await request(app).get('/api/v1/unknown-endpoint-xyz');
    expect(res.status).toBe(404);
  });

  test('Protected endpoint returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/v1/services');
    expect(res.status).toBe(401);
  });

  test('Gateway proxy returns 404 for non-existent route', async () => {
    const res = await request(app).get('/gateway/non-existent-route-404');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
