/**
 * EdgeFlow - API Keys page
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Trash2, KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';
import { apiKeysApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import TableSkeleton from '../components/ui/TableSkeleton';
import { useToast } from '../utils/toast';
import { formatRelative, classNames, copyToClipboard, formatNumber } from '../utils/format';

export default function ApiKeysPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [issueOpen, setIssueOpen] = useState(false);
  const [newlyIssued, setNewlyIssued] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await apiKeysApi.list({ limit: 200 })); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (k) => {
    try { const updated = await apiKeysApi.setEnabled(k.id, !k.enabled); setItems((arr) => arr.map((x) => (x.id === k.id ? updated : x))); toast.success(`API key ${updated.enabled ? 'enabled' : 'disabled'}`); } catch {}
  };
  const handleRevoke = async () => {
    if (!confirmRevoke) return;
    try { await apiKeysApi.revoke(confirmRevoke.id); setItems((arr) => arr.filter((x) => x.id !== confirmRevoke.id)); toast.success('API key revoked'); } catch {} finally { setConfirmRevoke(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-semibold text-slate-100">API Keys</h2><p className="text-sm text-slate-500 mt-1">Issue credentials for API consumers. The plaintext key is shown only once.</p></div>
        <button onClick={() => setIssueOpen(true)} className="btn-primary"><Plus size={16} /> Issue API Key</button>
      </div>

      <Card noPadding>
        {loading ? <TableSkeleton rows={4} cols={5} /> : items.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys issued" description="Issue an API key so external consumers can authenticate proxied requests via the X-API-Key header."
            action={<button onClick={() => setIssueOpen(true)} className="btn-primary"><Plus size={16} /> Issue First Key</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Key ID</th>
                <th className="px-4 py-3 font-medium">Rate Limit</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Last Used</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {items.map((k) => (
                  <tr key={k.id} className="table-row">
                    <td className="px-4 py-3"><div className="font-medium text-slate-100">{k.name}</div>
                      {k.scopes?.length > 0 && <div className="flex gap-1 mt-1">{k.scopes.map((s) => <span key={s} className="badge-neutral">{s}</span>)}</div>}
                    </td>
                    <td className="px-4 py-3"><code className="text-xs text-slate-400 font-mono">{k.key_id}</code></td>
                    <td className="px-4 py-3 text-slate-300">{k.rate_limit_per_min}/min</td>
                    <td className="px-4 py-3 text-slate-300">{formatNumber(k.total_requests)} reqs</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatRelative(k.last_used_at)}</td>
                    <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                      <ToggleSwitch checked={k.enabled} onChange={() => handleToggle(k)} />
                      <button onClick={() => setConfirmRevoke(k)} className="p-2 rounded-lg hover:bg-rose-950/40 text-slate-400 hover:text-rose-300" title="Revoke"><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <IssueModal open={issueOpen} onClose={() => setIssueOpen(false)} onIssued={(k) => { setNewlyIssued(k); setIssueOpen(false); load(); }} />
      <PlaintextKeyModal apiKey={newlyIssued} onClose={() => setNewlyIssued(null)} />
      <Modal open={!!confirmRevoke} onClose={() => setConfirmRevoke(null)} title="Revoke API key?"
        footer={<><button className="btn-secondary" onClick={() => setConfirmRevoke(null)}>Cancel</button><button className="btn-danger" onClick={handleRevoke}>Revoke permanently</button></>}>
        <p className="text-sm text-slate-300">Revoking <strong className="text-slate-100">{confirmRevoke?.name}</strong> will immediately invalidate the key. Any clients still using it will receive 401 errors.</p>
      </Modal>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return <button onClick={onChange} className={classNames('relative w-9 h-5 rounded-full transition-colors', checked ? 'bg-brand-500' : 'bg-slate-700')} role="switch" aria-checked={checked}>
    <span className={classNames('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} />
  </button>;
}

function IssueModal({ open, onClose, onIssued }) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm({ defaultValues: { name: '', rateLimitPerMin: 100, expiresInDays: 30, environment: 'live' } });
  const toast = useToast();
  useEffect(() => { if (open) reset(); }, [open, reset]);
  const onSubmit = async (values) => {
    try {
      const k = await apiKeysApi.issue({ ...values, rateLimitPerMin: parseInt(values.rateLimitPerMin, 10), expiresInDays: values.expiresInDays ? parseInt(values.expiresInDays, 10) : null });
      toast.success('API key issued'); onIssued(k);
    } catch {}
  };
  return <Modal open={open} onClose={onClose} title="Issue New API Key"
    footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>{isSubmitting ? 'Issuing...' : 'Issue Key'}</button></>}>
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <div><label className="label">Name</label><input className="input" {...register('name', { required: true })} placeholder="Mobile app production key" /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="label">Rate Limit /min</label><input type="number" className="input" {...register('rateLimitPerMin')} /></div>
        <div><label className="label">Expires (days)</label><input type="number" className="input" {...register('expiresInDays')} /></div>
        <div><label className="label">Environment</label><select className="input" {...register('environment')}><option value="live">live</option><option value="test">test</option></select></div>
      </div>
    </form>
  </Modal>;
}

function PlaintextKeyModal({ apiKey, onClose }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => { await copyToClipboard(apiKey?.plaintextKey); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return <Modal open={!!apiKey} onClose={onClose} title="API Key Issued" footer={<button className="btn-primary" onClick={onClose}>I've saved it</button>}>
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-200">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <p className="text-sm">Copy this key now. For security, the plaintext is <strong>never</strong> stored or shown again.</p>
      </div>
      <div><label className="label">Plaintext Key</label>
        <div className="flex gap-2">
          <code className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-brand-300 break-all">{apiKey?.plaintextKey}</code>
          <button onClick={handleCopy} className="btn-secondary">{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
        </div>
      </div>
      <div><label className="label">Key ID (safe to share)</label>
        <code className="block bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-400">{apiKey?.key_id}</code>
      </div>
    </div>
  </Modal>;
}
