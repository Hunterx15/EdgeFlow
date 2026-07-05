/**
 * EdgeFlow - Routes management page
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Trash2, Pencil, Route as RouteIcon } from 'lucide-react';
import { routesApi, servicesApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import TableSkeleton from '../components/ui/TableSkeleton';
import { useToast } from '../utils/toast';
import { classNames } from '../utils/format';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', '*'];
const emptyForm = { serviceId: '', method: 'GET', publicPath: '/gateway/users/*', upstreamPath: '/api/users', stripPrefix: true, authRequired: true, apiKeyRequired: false, rateLimitPerMin: 100, cacheTtlSec: 0, description: '', enabled: true };

export default function RoutesPage() {
  const [items, setItems] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [routes, svcs] = await Promise.all([routesApi.list({ limit: 200 }), servicesApi.list({ limit: 200 })]);
      setItems(routes); setServices(svcs);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (route) => {
    try { const updated = await routesApi.setEnabled(route.id, !route.enabled); setItems((arr) => arr.map((x) => (x.id === route.id ? updated : x))); toast.success(`Route ${updated.enabled ? 'enabled' : 'disabled'}`); } catch {}
  };
  const handleDelete = async () => {
    if (!confirmDelete) return;
    try { await routesApi.remove(confirmDelete.id); setItems((arr) => arr.filter((x) => x.id !== confirmDelete.id)); toast.success('Route deleted'); } catch {} finally { setConfirmDelete(null); }
  };
  const serviceName = (id) => services.find((s) => s.id === id)?.name || '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-semibold text-slate-100">Routes</h2><p className="text-sm text-slate-500 mt-1">Define how incoming gateway requests map to backend services.</p></div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-primary"><Plus size={16} /> New Route</button>
      </div>

      <Card noPadding>
        {loading ? <TableSkeleton rows={6} cols={6} /> : items.length === 0 ? (
          <EmptyState icon={RouteIcon} title="No routes registered" description="Routes bind a public path (e.g. /gateway/users/*) to a backend service + upstream path."
            action={<button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-primary"><Plus size={16} /> Register Route</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Public Path</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Upstream Path</th>
                <th className="px-4 py-3 font-medium">Auth & Limits</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="table-row">
                    <td className="px-4 py-3"><span className={classNames('badge font-mono', r.method === 'GET' ? 'badge-success' : r.method === 'POST' ? 'badge-info' : r.method === 'DELETE' ? 'badge-danger' : 'badge-warning')}>{r.method}</span></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-200">{r.public_path}</td>
                    <td className="px-4 py-3 text-slate-300">{serviceName(r.service_id)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{r.upstream_path}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
                      {r.auth_required && <span className="badge-info">JWT</span>}
                      {r.api_key_required && <span className="badge-warning">API Key</span>}
                      {r.cache_ttl_sec > 0 && <span className="badge-success">cache {r.cache_ttl_sec}s</span>}
                      <span className="badge-neutral">{r.rate_limit_per_min}/min</span>
                    </div></td>
                    <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                      <ToggleSwitch checked={r.enabled} onChange={() => handleToggle(r)} />
                      <button onClick={() => { setEditing(r); setModalOpen(true); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100"><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDelete(r)} className="p-2 rounded-lg hover:bg-rose-950/40 text-slate-400 hover:text-rose-300"><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RouteFormModal open={modalOpen} editing={editing} services={services} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete route?"
        footer={<><button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="btn-danger" onClick={handleDelete}>Delete</button></>}>
        <p className="text-sm text-slate-300">Delete route <strong className="font-mono text-slate-100">{confirmDelete?.method} {confirmDelete?.public_path}</strong>?</p>
      </Modal>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return <button onClick={onChange} className={classNames('relative w-9 h-5 rounded-full transition-colors', checked ? 'bg-brand-500' : 'bg-slate-700')} role="switch" aria-checked={checked}>
    <span className={classNames('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} />
  </button>;
}

function RouteFormModal({ open, editing, services, onClose, onSaved }) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      reset({
        serviceId: editing.service_id, method: editing.method, publicPath: editing.public_path,
        upstreamPath: editing.upstream_path, stripPrefix: editing.strip_prefix,
        authRequired: editing.auth_required, apiKeyRequired: editing.api_key_required,
        rateLimitPerMin: editing.rate_limit_per_min, cacheTtlSec: editing.cache_ttl_sec,
        description: editing.description || '', enabled: editing.enabled,
      });
    } else { reset({ ...emptyForm, serviceId: services[0]?.id || '' }); }
  }, [open, editing, reset, services]);

  const onSubmit = async (values) => {
    const payload = { ...values, rateLimitPerMin: parseInt(values.rateLimitPerMin, 10), cacheTtlSec: parseInt(values.cacheTtlSec, 10) };
    try {
      if (editing) { await routesApi.update(editing.id, payload); toast.success('Route updated'); }
      else { await routesApi.create(payload); toast.success('Route registered'); }
      onSaved();
    } catch {}
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Route' : 'Register New Route'} size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>{isSubmitting ? 'Saving...' : (editing ? 'Save' : 'Register')}</button></>}>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Service</label><select className="input" {...register('serviceId', { required: true })}>
            <option value="">Select a service...</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
          <div><label className="label">HTTP Method</label><select className="input" {...register('method')}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Public Path</label><input className="input font-mono" {...register('publicPath', { required: true })} placeholder="/gateway/users/*" /></div>
          <div><label className="label">Upstream Path</label><input className="input font-mono" {...register('upstreamPath', { required: true })} placeholder="/api/users" /></div>
        </div>
        <div><label className="label">Description</label><input className="input" {...register('description')} placeholder="What does this route do?" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Rate Limit (per minute)</label><input type="number" className="input" {...register('rateLimitPerMin')} /></div>
          <div><label className="label">Cache TTL (seconds, 0 = off)</label><input type="number" className="input" {...register('cacheTtlSec')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" {...register('stripPrefix')} className="rounded bg-slate-900 border-slate-700" /> Strip gateway prefix</label>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" {...register('enabled')} className="rounded bg-slate-900 border-slate-700" /> Enabled</label>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" {...register('authRequired')} className="rounded bg-slate-900 border-slate-700" /> Require JWT auth</label>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" {...register('apiKeyRequired')} className="rounded bg-slate-900 border-slate-700" /> Require API key</label>
        </div>
      </form>
    </Modal>
  );
}
