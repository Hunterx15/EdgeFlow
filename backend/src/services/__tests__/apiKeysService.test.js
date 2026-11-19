const mockRedisStore = new Map();

jest.mock('../../database/pool', () => ({
  queryOne: jest.fn(),
  queryMany: jest.fn(),
  queryRaw: jest.fn().mockResolvedValue({ rows: [] }),
}));

jest.mock('../../database/redis', () => ({
  getClient: jest.fn().mockImplementation(async () => ({
    get: async (k) => mockRedisStore.get(k) || null,
    set: async (k, v) => {
      mockRedisStore.set(k, v);
      return 'OK';
    },
    del: async (k) => {
      mockRedisStore.delete(k);
      return 1;
    },
  })),
}));

const db = require('../../database/pool');
const apiKeysService = require('../apiKeysService');
const { generateApiKey } = require('../../utils/apiKey');

describe('API Keys Service (with Caching & Batching)', () => {
  beforeEach(() => {
    mockRedisStore.clear();
    jest.clearAllMocks();
  });

  test('validates key and caches in Redis on first lookup', async () => {
    const generated = generateApiKey({ name: 'Test Key' });
    const mockDbKey = {
      id: 'k1',
      key_id: generated.keyId,
      key_hash: generated.keyHash,
      enabled: true,
      expires_at: null,
      rate_limit_per_min: 100,
    };

    db.queryOne.mockResolvedValueOnce(mockDbKey);

    // First validation hits DB
    const res1 = await apiKeysService.validate(generated.fullKey);
    expect(res1.valid).toBe(true);
    expect(res1.apiKey.key_id).toBe(generated.keyId);
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(mockRedisStore.has(`ef:apikey:${generated.keyId}`)).toBe(true);

    // Second validation hits Redis cache, avoiding DB query
    const res2 = await apiKeysService.validate(generated.fullKey);
    expect(res2.valid).toBe(true);
    expect(db.queryOne).toHaveBeenCalledTimes(1); // still 1!
  });

  test('rejects expired API key', async () => {
    const generated = generateApiKey({ name: 'Expired Key' });
    const mockDbKey = {
      id: 'k2',
      key_id: generated.keyId,
      key_hash: generated.keyHash,
      enabled: true,
      expires_at: new Date(Date.now() - 10000).toISOString(),
    };

    db.queryOne.mockResolvedValueOnce(mockDbKey);

    const res = await apiKeysService.validate(generated.fullKey);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('API key expired');
  });

  test('invalidates Redis cache on update or revoke', async () => {
    const generated = generateApiKey({ name: 'Revoke Key' });
    mockRedisStore.set(`ef:apikey:${generated.keyId}`, JSON.stringify({ id: 'k3', key_id: generated.keyId }));

    db.queryOne.mockResolvedValueOnce({ id: 'k3', key_id: generated.keyId });
    await apiKeysService.revoke('k3');

    expect(mockRedisStore.has(`ef:apikey:${generated.keyId}`)).toBe(false);
  });
});
