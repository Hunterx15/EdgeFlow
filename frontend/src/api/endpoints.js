/**
 * EdgeFlow - Domain API endpoints
 */

import { http } from './client';

export const authApi = {
  login: (email, password) => http.post('/auth/login', { email, password }),
  refresh: () => http.post('/auth/refresh'),
  logout: () => http.post('/auth/logout'),
  me: () => http.get('/auth/me'),
};

export const dashboardApi = {
  overview: (windowMinutes = 60) => http.get('/dashboard/overview', { params: { windowMinutes } }),
  liveGraph: (minutes = 60) => http.get('/dashboard/live-graph', { params: { minutes } }),
  liveMetrics: () => http.get('/dashboard/live-metrics'),
};

export const servicesApi = {
  list: (params = {}) => http.get('/services', { params }),
  stats: () => http.get('/services/stats'),
  get: (id) => http.get(`/services/${id}`),
  create: (body) => http.post('/services', body),
  update: (id, body) => http.put(`/services/${id}`, body),
  setEnabled: (id, enabled) => http.patch(`/services/${id}/enabled`, { enabled }),
  remove: (id) => http.delete(`/services/${id}`),
  checkHealth: (id) => http.get(`/services/${id}/health`),
};

export const routesApi = {
  list: (params = {}) => http.get('/routes', { params }),
  get: (id) => http.get(`/routes/${id}`),
  create: (body) => http.post('/routes', body),
  update: (id, body) => http.put(`/routes/${id}`, body),
  setEnabled: (id, enabled) => http.patch(`/routes/${id}/enabled`, { enabled }),
  remove: (id) => http.delete(`/routes/${id}`),
};

export const apiKeysApi = {
  list: (params = {}) => http.get('/api-keys', { params }),
  get: (id) => http.get(`/api-keys/${id}`),
  issue: (body) => http.post('/api-keys', body),
  update: (id, body) => http.put(`/api-keys/${id}`, body),
  setEnabled: (id, enabled) => http.patch(`/api-keys/${id}/enabled`, { enabled }),
  revoke: (id) => http.delete(`/api-keys/${id}`),
};

export const logsApi = {
  list: (params = {}) => http.get('/logs', { params }),
  timeline: (limit = 20) => http.get('/logs/timeline', { params: { limit } }),
  get: (id) => http.get(`/logs/${id}`),
  pipeline: (id) => http.get(`/logs/${id}/pipeline`),
};

export const analyticsApi = {
  overview: (windowMinutes = 60) => http.get('/analytics/overview', { params: { windowMinutes } }),
  perMinute: (minutes = 60) => http.get('/analytics/per-minute', { params: { minutes } }),
  perService: (windowMinutes = 60) => http.get('/analytics/per-service', { params: { windowMinutes } }),
  topRoutes: (windowMinutes = 60) => http.get('/analytics/top-routes', { params: { windowMinutes } }),
  statusBreakdown: (windowMinutes = 60) => http.get('/analytics/status-breakdown', { params: { windowMinutes } }),
  // New endpoints
  latencyPercentiles: (windowMinutes = 60) => http.get('/analytics/latency-percentiles', { params: { windowMinutes } }),
  slowEndpoints: (windowMinutes = 1440, limit = 10) => http.get('/analytics/slow-endpoints', { params: { windowMinutes, limit } }),
  methodDistribution: (windowMinutes = 1440) => http.get('/analytics/method-distribution', { params: { windowMinutes } }),
  serviceDistribution: (windowMinutes = 1440) => http.get('/analytics/service-distribution', { params: { windowMinutes } }),
  trafficHeatmap: (days = 7) => http.get('/analytics/traffic-heatmap', { params: { days } }),
};

export const monitoringApi = {
  live: () => http.get('/monitoring/live'),
  ready: () => http.get('/monitoring/ready'),
  dependencyGraph: () => http.get('/monitoring/dependency-graph'),
  cacheStats: () => http.get('/monitoring/cache/stats'),
  cacheFlush: () => http.post('/monitoring/cache/flush'),
  cacheInvalidate: (pattern) => http.post('/monitoring/cache/invalidate', { pattern }),
  circuitBreakers: () => http.get('/monitoring/circuit-breakers'),
  resetCircuit: (upstreamUrl) => http.post('/monitoring/circuit-breakers/reset', { upstreamUrl }),
};

export const playgroundApi = {
  send: (payload) => http.post('/playground/send', payload, { _silent: true }),
};
