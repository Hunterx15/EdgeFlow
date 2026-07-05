/**
 * EdgeFlow - Formatting utilities
 */

export function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
export function formatPercent(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(digits) + '%';
}
export function formatMs(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1) return '<1ms';
  if (n < 1000) return Math.round(n) + 'ms';
  return (n / 1000).toFixed(2) + 's';
}
export function formatBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + 'MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
}
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function formatRelative(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
export function formatUptime(sec) {
  if (!sec || sec < 60) return `${sec || 0}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}
export function statusBadge(status) {
  if (status === 'healthy') return 'success';
  if (status === 'unhealthy') return 'danger';
  if (status === 'unknown') return 'neutral';
  return 'neutral';
}
export function statusCodeBadge(code) {
  if (!code) return 'neutral';
  if (code < 300) return 'success';
  if (code < 400) return 'info';
  if (code < 500) return 'warning';
  return 'danger';
}
export function classNames(...classes) { return classes.filter(Boolean).join(' '); }
export function copyToClipboard(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea'); ta.value = text;
  document.body.appendChild(ta); ta.select(); document.execCommand('copy');
  document.body.removeChild(ta); return Promise.resolve();
}
