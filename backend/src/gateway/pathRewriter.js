/**
 * EdgeFlow - Path rewriter
 *
 * Translates an incoming public path into the upstream path:
 *   - strip_prefix: drop the route's public prefix
 *   - upstream_path template: substitute :params
 *   - preserve trailing path & query string
 */

function rewrite({ route, publicPath, originalQuery }) {
  let upstream = route.upstream_path || '/';

  if (route.strip_prefix) {
    const publicPrefix = route.public_path.replace(/\/\*$/, '');

    let suffix = publicPath.slice(publicPrefix.length);

    // Only prepend "/" when suffix is non-empty.
    if (suffix && !suffix.startsWith('/')) {
      suffix = '/' + suffix;
    }

    if (suffix) {
      if (upstream.endsWith('/') && suffix.startsWith('/')) {
        upstream = upstream.slice(0, -1) + suffix;
      } else if (!upstream.endsWith('/') && !suffix.startsWith('/')) {
        upstream = upstream + '/' + suffix;
      } else {
        upstream = upstream + suffix;
      }
    }
  }

  if (originalQuery && originalQuery.length > 0) {
    upstream += (upstream.includes('?') ? '&' : '?') + originalQuery;
  }

  return upstream;
}

module.exports = { rewrite };
