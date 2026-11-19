jest.mock('../../database/pool', () => ({
  queryRaw: jest.fn().mockResolvedValue({ rows: [] }),
  queryMany: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
}));

const circuitBreaker = require('../circuitBreaker');

describe('Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)', () => {
  const upstreamUrl = 'http://test-service:8080';

  beforeEach(() => {
    circuitBreaker.configure({
      failureThreshold: 3,
      successThreshold: 2,
      openStateMs: 50, // fast testing
      halfOpenMaxCalls: 2,
    });
    // Reset state for test url
    const s = circuitBreaker.getState(upstreamUrl);
    s.state = 'closed';
    s.failureCount = 0;
    s.successCount = 0;
    s.openedAt = 0;
    s.halfOpenInflight = 0;
  });

  test('starts in CLOSED state and allows requests', () => {
    const decision = circuitBreaker.allowRequest(upstreamUrl);
    expect(decision.allowed).toBe(true);
    expect(decision.state).toBe('closed');
  });

  test('transitions to OPEN after failureThreshold is reached', () => {
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);
    expect(circuitBreaker.getState(upstreamUrl).state).toBe('closed');

    circuitBreaker.recordFailure(upstreamUrl);
    expect(circuitBreaker.getState(upstreamUrl).state).toBe('open');

    const decision = circuitBreaker.allowRequest(upstreamUrl);
    expect(decision.allowed).toBe(false);
    expect(decision.state).toBe('open');
  });

  test('transitions to HALF_OPEN after openStateMs has elapsed', async () => {
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);
    expect(circuitBreaker.getState(upstreamUrl).state).toBe('open');

    // Wait for openStateMs
    await new Promise((r) => setTimeout(r, 60));

    const decision = circuitBreaker.allowRequest(upstreamUrl);
    expect(decision.allowed).toBe(true);
    expect(decision.state).toBe('half_open');
  });

  test('transitions from HALF_OPEN back to CLOSED after successThreshold successes', async () => {
    // Trip to open
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);

    await new Promise((r) => setTimeout(r, 60));
    circuitBreaker.allowRequest(upstreamUrl); // moves to half_open

    circuitBreaker.recordSuccess(upstreamUrl);
    expect(circuitBreaker.getState(upstreamUrl).state).toBe('half_open');

    circuitBreaker.recordSuccess(upstreamUrl);
    expect(circuitBreaker.getState(upstreamUrl).state).toBe('closed');
  });

  test('transitions from HALF_OPEN immediately back to OPEN on single failure', async () => {
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);
    circuitBreaker.recordFailure(upstreamUrl);

    await new Promise((r) => setTimeout(r, 60));
    circuitBreaker.allowRequest(upstreamUrl); // moves to half_open

    circuitBreaker.recordFailure(upstreamUrl);
    expect(circuitBreaker.getState(upstreamUrl).state).toBe('open');
  });
});
