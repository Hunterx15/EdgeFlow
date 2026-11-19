jest.mock('../../database/pool', () => ({
  queryRaw: jest.fn().mockResolvedValue({ rows: [] }),
}));

const db = require('../../database/pool');
const logBatcher = require('../logBatcher');

describe('Asynchronous Request Log Batcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('buffers logs in memory and flushes in batches', async () => {
    const sampleLog = {
      requestId: 'req-1',
      method: 'GET',
      publicPath: '/test',
      serviceId: null,
      routeId: null,
      apiKeyId: null,
      upstreamUrl: 'http://localhost:3000',
      statusCode: 200,
      latencyMs: 15,
      responseSize: 100,
      error: null,
      clientIp: '127.0.0.1',
      userAgent: 'jest',
      cacheHit: false,
      retryCount: 0,
      pipelineStages: null,
    };

    logBatcher.enqueue(sampleLog);
    logBatcher.enqueue({ ...sampleLog, requestId: 'req-2' });

    expect(logBatcher.size()).toBeGreaterThanOrEqual(2);

    await logBatcher.flush();

    expect(db.queryRaw).toHaveBeenCalledTimes(1);
    const sql = db.queryRaw.mock.calls[0][0];
    const params = db.queryRaw.mock.calls[0][1];

    expect(sql).toContain('INSERT INTO request_logs');
    expect(params).toContain('req-1');
    expect(params).toContain('req-2');
  });
});
