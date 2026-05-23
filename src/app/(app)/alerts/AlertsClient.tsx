'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { Bell, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AlertRule = {
  id: string;
  name: string;
  resource: string;
  resourceId: string | null;
  metric: string;
  operator: string;
  threshold: number;
  durationS: number;
  channels: string[];
  cooldownS: number;
  enabled: boolean;
  lastFiredAt: string | null;
};

const METRICS = [
  { value: 'cpu_percent',  label: 'CPU %' },
  { value: 'mem_percent',  label: 'RAM %' },
  { value: 'disk_percent', label: 'Disk %' },
  { value: 'mem_used',     label: 'RAM used (bytes)' },
  { value: 'disk_used',    label: 'Disk used (bytes)' },
];

const CHANNELS = ['telegram', 'slack', 'discord', 'webhook'] as const;

const blank = {
  name: '',
  metric: 'cpu_percent',
  operator: 'gt',
  threshold: 85,
  durationS: 0,
  channels: ['telegram'] as string[],
  cooldownS: 300,
  enabled: true,
  resourceId: '',
};

export function AlertsClient() {
  const { data, mutate, isLoading } = useSWR<{ rules: AlertRule[] }>('/api/alert-rules', fetcher);
  const { data: meData } = useSWR<{ user: { role: string } | null }>('/api/auth/me', fetcher);

  const isViewer = meData?.user?.role === 'viewer';

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setForm({ ...blank });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (rule: AlertRule) => {
    setForm({
      name:       rule.name,
      metric:     rule.metric,
      operator:   rule.operator,
      threshold:  rule.threshold,
      durationS:  rule.durationS,
      channels:   rule.channels,
      cooldownS:  rule.cooldownS,
      enabled:    rule.enabled,
      resourceId: rule.resourceId ?? '',
    });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const toggleChannel = (ch: string) => {
    setForm((f) =>
      f.channels.includes(ch)
        ? { ...f, channels: f.channels.filter((c) => c !== ch) }
        : { ...f, channels: [...f.channels, ch] }
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.channels.length === 0) return toast.error('Select at least one channel.');
    setSaving(true);

    const payload = {
      name:       form.name,
      metric:     form.metric,
      operator:   form.operator,
      threshold:  Number(form.threshold),
      durationS:  Number(form.durationS),
      channels:   form.channels,
      cooldownS:  Number(form.cooldownS),
      enabled:    form.enabled,
      resourceId: form.resourceId || null,
    };

    const url    = editingId ? `/api/alert-rules/${editingId}` : '/api/alert-rules';
    const method = editingId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success(editingId ? 'Rule updated' : 'Rule created');
    setShowForm(false);
    mutate();
  };

  const deleteRule = async (id: string, name: string) => {
    if (!confirm(`Delete rule "${name}"?`)) return;
    const res = await fetch(`/api/alert-rules/${id}`, { method: 'DELETE' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success('Rule deleted');
    mutate();
  };

  const toggleEnabled = async (rule: AlertRule) => {
    const res = await fetch(`/api/alert-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (!res.ok) return toast.error('Failed');
    mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Alert Rules</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Define thresholds and which notification channels to fire when they breach.
          </p>
        </div>
        {!isViewer && (
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New rule
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
        </div>
      )}

      {!isLoading && data?.rules.length === 0 && (
        <div className="card card-pad flex flex-col items-center gap-3 py-12 text-center">
          <Bell className="h-8 w-8 text-ink-muted" />
          <p className="text-sm text-ink-muted">No alert rules yet.</p>
          {!isViewer && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Create first rule
            </button>
          )}
        </div>
      )}

      {!isLoading && (data?.rules.length ?? 0) > 0 && (
        <div className="card divide-y divide-border overflow-hidden">
          {data!.rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-4 px-4 py-3">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={() => !isViewer && toggleEnabled(rule)}
                disabled={isViewer}
                className="h-4 w-4 cursor-pointer accent-success"
                title={rule.enabled ? 'Disable rule' : 'Enable rule'}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{rule.name}</span>
                  {!rule.enabled && <span className="chip-muted">disabled</span>}
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {rule.metric} {rule.operator === 'gt' ? '>' : rule.operator === 'lt' ? '<' : '='}{' '}
                  {rule.metric.endsWith('_percent') ? `${rule.threshold}%` : rule.threshold}
                  {' · '}cooldown {rule.cooldownS}s
                  {' · '}channels: {rule.channels.join(', ')}
                  {rule.lastFiredAt && ` · last fired ${new Date(rule.lastFiredAt).toLocaleString()}`}
                </p>
              </div>
              {!isViewer && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
                    onClick={() => openEdit(rule)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-ink-soft hover:bg-danger/10 hover:text-danger"
                    onClick={() => deleteRule(rule.id, rule.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div className="card card-pad">
          <h2 className="text-base font-semibold text-ink">
            {editingId ? 'Edit rule' : 'New rule'}
          </h2>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Rule name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  maxLength={128}
                  placeholder="High CPU on production servers"
                />
              </div>
              <div>
                <label className="label">Metric</label>
                <select
                  className="input"
                  value={form.metric}
                  onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
                >
                  {METRICS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Operator</label>
                <select
                  className="input"
                  value={form.operator}
                  onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))}
                >
                  <option value="gt">greater than (&gt;)</option>
                  <option value="lt">less than (&lt;)</option>
                  <option value="eq">equal to (=)</option>
                </select>
              </div>
              <div>
                <label className="label">Threshold</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="any"
                  value={form.threshold}
                  onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))}
                  required
                />
              </div>
              <div>
                <label className="label">Cooldown (seconds)</label>
                <input
                  className="input"
                  type="number"
                  min={60}
                  max={86400}
                  value={form.cooldownS}
                  onChange={(e) => setForm((f) => ({ ...f, cooldownS: Number(e.target.value) }))}
                  required
                />
              </div>
              <div>
                <label className="label">Agent ID filter (blank = all agents)</label>
                <input
                  className="input font-mono text-sm"
                  value={form.resourceId}
                  onChange={(e) => setForm((f) => ({ ...f, resourceId: e.target.value }))}
                  placeholder="vps_abc123 or leave blank"
                />
              </div>
              <div>
                <label className="label">Sustain duration (seconds)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={3600}
                  value={form.durationS}
                  onChange={(e) => setForm((f) => ({ ...f, durationS: Number(e.target.value) }))}
                />
                <p className="mt-1 text-[11px] text-ink-soft">Breach must persist this long before firing. 0 = fire immediately.</p>
              </div>
            </div>

            <div>
              <label className="label mb-2">Channels</label>
              <div className="flex flex-wrap gap-3">
                {CHANNELS.map((ch) => (
                  <label key={ch} className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={form.channels.includes(ch)}
                      onChange={() => toggleChannel(ch)}
                      className="h-4 w-4 accent-success"
                    />
                    {ch}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="h-4 w-4 accent-success"
              />
              Enabled
            </label>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? 'Save changes' : 'Create rule'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
