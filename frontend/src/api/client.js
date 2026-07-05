/**
 * EdgeFlow - API client (Axios)
 *
 * - Reads access token from localStorage on every request
 * - On 401, transparently calls /auth/refresh and retries the original
 *   request once. If refresh fails, redirects to /login.
 */

import axios from 'axios';
import { toast } from '../utils/toast';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL, withCredentials: true, timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('edgeflow.accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let failedQueue = [];
const processQueue = (error, token = null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
};

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const originalRequest = error.config;
    const isAuthEndpoint = originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/refresh');
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => { failedQueue.push({ resolve, reject }); })
          .then((token) => { originalRequest.headers.Authorization = `Bearer ${token}`; return api(originalRequest); });
      }
      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        const newToken = data.data.accessToken;
        localStorage.setItem('edgeflow.accessToken', newToken);
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem('edgeflow.accessToken');
        if (!window.location.pathname.startsWith('/login')) {
          toast.error('Session expired. Please sign in again.');
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      } finally { isRefreshing = false; }
    }
    const payload = error.response?.data;
    const message = payload?.error?.message || error.message || 'Request failed';
    if (!originalRequest._silent) toast.error(message);
    return Promise.reject(payload || error);
  }
);

export const http = {
  get: (url, config = {}) => api.get(url, config).then((r) => r.data.data),
  post: (url, body = {}, config = {}) => api.post(url, body, config).then((r) => r.data.data),
  put: (url, body = {}, config = {}) => api.put(url, body, config).then((r) => r.data.data),
  patch: (url, body = {}, config = {}) => api.patch(url, body, config).then((r) => r.data.data),
  delete: (url, config = {}) => api.delete(url, config).then((r) => r.data.data),
  raw: api,
};

export default api;
