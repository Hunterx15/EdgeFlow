/**
 * EdgeFlow demo service - tiny Express echo server used by docker-compose
 * so you can immediately test /gateway/<...> without writing your own
 * backend. Returns a JSON echo of whatever hit it.
 */

const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'demo' }));

app.all('*', (req, res) => {
  res.json({
    service: 'edgeflow-demo',
    method: req.method, path: req.path, query: req.query, body: req.body,
    headers: {
      'x-edgeflow-request-id': req.headers['x-edgeflow-request-id'],
      'x-edgeflow-service-id': req.headers['x-edgeflow-service-id'],
      'x-edgeflow-route-id': req.headers['x-edgeflow-route-id'],
      'x-edgeflow-upstream': req.headers['x-edgeflow-upstream'],
      'x-forwarded-host': req.headers['x-forwarded-host'],
    },
    timestamp: new Date().toISOString(),
  });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`edgeflow-demo listening on :${port}`));
