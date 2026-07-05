/**
 * EdgeFlow - Services management page
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Server, Trash2, Pencil, Activity } from 'lucide-react';
import { servicesApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import TableSkeleton from '../components/ui/TableSkeleton';
import { useToast } from '../utils/toast';
import { formatRelative, statusBadge, classNames } from '../utils/format';

const emptyForm = {
  name: '', slug: '', description: '', basePath: '/users',
  upstreamTargets: 'http://localhost:3001',
  version: 'v1', enabled: true,
  healthCheckPath: '/health', healthCheckIntervalMs: 30000,
};

export default function ServicesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await servicesApi.list({ limit: 200 })); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (svc) => {
    try {
      const updated = await servicesApi.setEnabled(svc.id, !svc.enabled);
      setItems((arr) => arr.map((x) => (x.id === svc.id ? updated : x)));
      toast.success(`${svc.name} ${updated.enabled ? 'enabled' : 'disabled'}`);
    } catch {}
  };

  const handleHealthCheck = async (svc) => {
    try {
      const result = await servicesApi.checkHealth(svc.id);
      setItems((arr) => arr.map((x) => (x.id === svc.id ? { ...x, last_status: result.lastStatus, last_heartbeat_at: result.lastHeartbeatAt, upstream_targets: result.upstreamTargets } : x)));
      toast.success(`Health check complete: ${result.lastStatus}`);
    } catch {}
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try { await servicesApi.remove(confirmDelete.id); setItems((arr) => arr.filter((x) => x.id !== confirmDelete.id)); toast.success('Service deleted'); }
    catch {} finally { setConfirmDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-semibold text-slate-100">Backend Services</h2><p className="text-sm text-slate-500 mt-1">Register and manage the backend services EdgeFlow proxies to.</p></div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-primary"><Plus size={16} /> New Service</button>
      </div>

      <Card noPadding>
        {loading ? <TableSkeleton rows={6} cols={5} /> : items.length === 0 ? (
          <EmptyState icon={Server} title="No services registered" description="Register your first backend service to start routing traffic through EdgeFlow."
            action={<button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-primary"><Plus size={16} /> Register Service</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Base Path</th>
                <th className="px-4 py-3 font-medium">Upstreams</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Heartbeat</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {items.map((svc) => (
                  <tr key={svc.id} className="table-row">
                    <td className="px-4 py-3"><div className="flex items-center gap-3">
                      <div className={classNames('w-8 h-8 rounded-lg flex items-center justify-center', svc.enabled ? 'bg-brand-500/15 text-brand-300' : 'bg-slate-800 text-slate-500')}><Server size={14} /></div>
                      <div><div className="font-medium text-slate-100">{svc.name}</div><div className="text-xs text-slate-500">{svc.slug} · {svc.version}</div></div>
                    </div></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{svc.base_path}</td>
                    <td className="px-4 py-3"><div className="text-xs space-y-0.5">
                      {(svc.upstream_targets || []).map((t, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className={classNames('w-1.5 h-1.5 rounded-full', t.healthy !== false ? 'bg-brand-400' : 'bg-rose-400')} />
                          <span className="font-mono text-slate-400">{t.url}</span>
                          {t.weight > 1 && <span className="text-slate-600">×{t.weight}</span>}
                        </div>
                      ))}
                    </div></td>
                    <td className="px-4 py-3"><div className="flex flex-col gap-1">
                      <span className={classNames('badge', `badge-${statusBadge(svc.last_status)}`)}>{svc.last_status || 'unknown'}</span>
                      {!svc.enabled && <span className="badge-neutral">disabled</span>}
                    </div></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatRelative(svc.last_heartbeat_at)}</td>
                    <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleHealthCheck(svc)} title="Run health check" className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100"><Activity size={14} /></button>
                      <button onClick={() => { setEditing(svc); setModalOpen(true); }} title="Edit" className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100"><Pencil size={14} /></button>
                      <ToggleSwitch checked={svc.enabled} onChange={() => handleToggle(svc)} />
                      <button onClick={() => setConfirmDelete(svc)} title="Delete" className="p-2 rounded-lg hover:bg-rose-950/40 text-slate-400 hover:text-rose-300"><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ServiceFormModal open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete service?"
        footer={<><button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="btn-danger" onClick={handleDelete}>Delete</button></>}>
        <p className="text-sm text-slate-300">This will permanently delete <strong className="text-slate-100">{confirmDelete?.name}</strong> and all of its routes. This action cannot be undone.</p>
      </Modal>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button onClick={onChange} className={classNames('relative w-9 h-5 rounded-full transition-colors', checked ? 'bg-brand-500' : 'bg-slate-700')} role="switch" aria-checked={checked} title={checked ? 'Disable' : 'Enable'}>
      <span className={classNames('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} />
    </button>
  );
}

function ServiceFormModal({ open, editing, onClose, onSaved }) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      reset({
        name: editing.name, slug: editing.slug, description: editing.description || '',
        basePath: editing.base_path,
        upstreamTargets: (editing.upstream_targets || []).map((t) => t.url).join('\n'),
        version: editing.version, enabled: editing.enabled,
        healthCheckPath: editing.health_check_path, healthCheckIntervalMs: editing.health_check_interval_ms,
      });
    } else { reset(emptyForm); }
  }, [open, editing, reset]);

  const onSubmit = async (values) => {
    const upstreamTargets = values.upstreamTargets.split('\n').map((s) => s.trim()).filter(Boolean).map((url) => ({ url, weight: 1 }));
    if (upstreamTargets.length === 0) { toast.error('At least one upstream URL is required'); return; }
    const payload = { ...values, upstreamTargets, healthCheckIntervalMs: parseInt(values.healthCheckIntervalMs, 10) };
    try {
      if (editing) { await servicesApi.update(editing.id, payload); toast.success('Service updated'); }
      else { await servicesApi.create(payload); toast.success('Service registered'); }
      onSaved();
    } catch {}
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'Register New Service'} size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>{isSubmitting ? 'Saving...' : (editing ? 'Save Changes' : 'Register')}</button></>}>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Name</label><input className="input" {...register('name', { required: true })} placeholder="User Service" /></div>
          <div><label className="label">Slug (optional)</label><input className="input" {...register('slug')} placeholder="auto-generated from name" /></div>
        </div>
        <div><label className="label">Description</label><textarea className="input" rows={2} {...register('description')} placeholder="What does this service do?" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Base Path (gateway prefix)</label><input className="input font-mono" {...register('basePath', { required: true })} placeholder="/users" /></div>
          <div><label className="label">Version</label><input className="input" {...register('version')} placeholder="v1" /></div>
        </div>
        <div><label className="label">Upstream Targets (one URL per line)</label>
          <textarea className="input font-mono text-xs" rows={3} {...register('upstreamTargets', { required: true })} placeholder={'http://user-svc-1:3001\nhttp://user-svc-2:3001'} />
          <p className="text-xs text-slate-500 mt-1">Multiple URLs enable round-robin load balancing.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Health Check Path</label><input className="input font-mono" {...register('healthCheckPath')} placeholder="/health" /></div>
          <div><label className="label">Health Check Interval (ms)</label><input type="number" className="input" {...register('healthCheckIntervalMs')} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" {...register('enabled')} className="rounded bg-slate-900 border-slate-700" /> Enabled</label>
      </form>
    </Modal>
  );
}
