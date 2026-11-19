const loadBalancer = require('../loadBalancer');

describe('Load Balancer (Smooth Weighted Round-Robin)', () => {
  beforeEach(() => {
    loadBalancer.resetAll();
  });

  test('returns null when service or upstream targets are empty', () => {
    expect(loadBalancer.nextTarget(null)).toBeNull();
    expect(loadBalancer.nextTarget({ upstream_targets: [] })).toBeNull();
  });

  test('returns the only healthy target when single target exists', () => {
    const service = {
      id: 's1',
      upstream_targets: [{ url: 'http://localhost:3001', healthy: true, weight: 1 }],
    };
    expect(loadBalancer.nextTarget(service).url).toBe('http://localhost:3001');
  });

  test('filters out unhealthy targets', () => {
    const service = {
      id: 's1',
      upstream_targets: [
        { url: 'http://localhost:3001', healthy: false, weight: 1 },
        { url: 'http://localhost:3002', healthy: true, weight: 1 },
      ],
    };
    const target = loadBalancer.nextTarget(service);
    expect(target.url).toBe('http://localhost:3002');
  });

  test('distributes requests smoothly according to nginx weighted round-robin', () => {
    const service = {
      id: 's-weighted',
      upstream_targets: [
        { url: 'http://upstream-a:3000', healthy: true, weight: 5 },
        { url: 'http://upstream-b:3000', healthy: true, weight: 1 },
      ],
    };

    const selections = [];
    for (let i = 0; i < 6; i++) {
      selections.push(loadBalancer.nextTarget(service).url);
    }

    const countA = selections.filter((u) => u.includes('upstream-a')).length;
    const countB = selections.filter((u) => u.includes('upstream-b')).length;

    expect(countA).toBe(5);
    expect(countB).toBe(1);
    // Smoothness verification: B should not be at the very end after 5 consecutive A's
    expect(selections[3]).toBe('http://upstream-b:3000');
  });
});
