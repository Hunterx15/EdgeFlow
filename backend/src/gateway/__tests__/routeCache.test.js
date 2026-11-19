const routesService = require('../../services/routesService');
const routeCache = require('../routeCache');

jest.mock('../../services/routesService');

describe('Route Cache', () => {
  const sampleRoutes = [
    { id: '1', method: 'GET', public_path: '/users', service_id: 's1' },
    { id: '2', method: 'POST', public_path: '/users', service_id: 's1' },
    { id: '3', method: 'GET', public_path: '/users/*', service_id: 's1' },
    { id: '4', method: 'GET', public_path: '/users/admin/*', service_id: 's2' },
    { id: '5', method: '*', public_path: '/wildcard/*', service_id: 's3' },
  ];

  beforeEach(async () => {
    routesService.listAllEnabled.mockResolvedValue(sampleRoutes);
    routeCache.invalidate();
    await routeCache.refresh();
  });

  test('matches exact route by method and public path', async () => {
    const route = await routeCache.match('GET', '/users');
    expect(route).toBeDefined();
    expect(route.id).toBe('1');

    const postRoute = await routeCache.match('POST', '/users');
    expect(postRoute).toBeDefined();
    expect(postRoute.id).toBe('2');
  });

  test('matches wildcard route with prefix', async () => {
    const route = await routeCache.match('GET', '/users/123');
    expect(route).toBeDefined();
    expect(route.id).toBe('3');
  });

  test('longest prefix wins for overlapping wildcard routes', async () => {
    const route = await routeCache.match('GET', '/users/admin/settings');
    expect(route).toBeDefined();
    expect(route.id).toBe('4');
  });

  test('matches wildcard HTTP method *', async () => {
    const route = await routeCache.match('DELETE', '/wildcard/test');
    expect(route).toBeDefined();
    expect(route.id).toBe('5');
  });

  test('returns null when no route matches', async () => {
    const route = await routeCache.match('GET', '/unmatched');
    expect(route).toBeNull();
  });
});
