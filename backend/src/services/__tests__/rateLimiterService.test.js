const mockMemoryStore = new Map();

jest.mock('../../database/redis', () => ({
  getClient: jest.fn().mockImplementation(async () => ({
    multi: () => {
      const ops = [];
      const self = {
        incr: (k) => {
          ops.push(['incr', k]);
          return self;
        },
        expire: (k, ttl) => {
          ops.push(['expire', k, ttl]);
          return self;
        },
        get: (k) => {
          ops.push(['get', k]);
          return self;
        },
        exec: async () => {
          const results = [];
          for (const op of ops) {
            const [action, key] = op;
            if (action === 'incr') {
              const cur = (mockMemoryStore.get(key) || 0) + 1;
              mockMemoryStore.set(key, cur);
              results.push(cur);
            } else if (action === 'expire') {
              results.push(1);
            } else if (action === 'get') {
              results.push(mockMemoryStore.get(key) || null);
            }
          }
          return results;
        },
      };
      return self;
    },
    incr: async (k) => {
      const cur = (mockMemoryStore.get(k) || 0) + 1;
      mockMemoryStore.set(k, cur);
      return cur;
    },
    get: async (k) => mockMemoryStore.get(k) || null,
    expire: async () => 1,
  })),
  isFallback: () => false,
}));

const rateLimiter = require('../rateLimiterService');

describe('Sliding-Window Rate Limiter', () => {
  beforeEach(() => {
    mockMemoryStore.clear();
  });

  test('allows requests within limit', async () => {
    const res = await rateLimiter.check({
      identity: 'test-user-1',
      routeId: 'route-1',
      limitPerMin: 10,
      limitPerHour: 100,
    });
    expect(res.allowed).toBe(true);
    expect(res.minute.count).toBe(1);
    expect(res.minute.remaining).toBe(9);
  });

  test('blocks requests that exceed the limit', async () => {
    const identity = 'test-burst-user';
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check({
        identity,
        routeId: 'route-strict',
        limitPerMin: 5,
        limitPerHour: 100,
      });
    }

    const blocked = await rateLimiter.check({
      identity,
      routeId: 'route-strict',
      limitPerMin: 5,
      limitPerHour: 100,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.minute.remaining).toBe(0);
  });
});
