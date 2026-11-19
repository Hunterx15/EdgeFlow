const pathRewriter = require('../pathRewriter');

describe('Path Rewriter', () => {
  test('rewrites path with strip_prefix = true and suffix', () => {
    const route = {
      public_path: '/users/*',
      upstream_path: '/api/v1/users',
      strip_prefix: true,
    };
    const rewritten = pathRewriter.rewrite({
      route,
      publicPath: '/users/profile/123',
      originalQuery: 'active=true',
    });
    expect(rewritten).toBe('/api/v1/users/profile/123?active=true');
  });

  test('rewrites exact path with strip_prefix = true', () => {
    const route = {
      public_path: '/health',
      upstream_path: '/internal/health',
      strip_prefix: true,
    };
    const rewritten = pathRewriter.rewrite({
      route,
      publicPath: '/health',
      originalQuery: '',
    });
    expect(rewritten).toBe('/internal/health');
  });

  test('preserves query strings and handles existing question mark', () => {
    const route = {
      public_path: '/search',
      upstream_path: '/find?version=2',
      strip_prefix: true,
    };
    const rewritten = pathRewriter.rewrite({
      route,
      publicPath: '/search',
      originalQuery: 'q=hello',
    });
    expect(rewritten).toBe('/find?version=2&q=hello');
  });

  test('keeps upstream path as is when strip_prefix = false', () => {
    const route = {
      public_path: '/api/*',
      upstream_path: '/upstream',
      strip_prefix: false,
    };
    const rewritten = pathRewriter.rewrite({
      route,
      publicPath: '/api/orders',
      originalQuery: '',
    });
    expect(rewritten).toBe('/upstream');
  });
});
