'use client';

import useSWR from 'swr';
import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type MonitorStatus = 'up' | 'down' | 'unknown';

interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalS: number;
  timeoutS: number;
  enabled: boolean;
  status: MonitorStatus;
  lastCheckedAt?: string;
  lastDownAt?: string;
  lastStatusCode?: number;
  lastLatencyMs?: number;
  createdAt: string;
}

const BLANK = { name: '', url: 'https://', intervalS: 60, timeoutS: 10, enabled: true };

export function UptimeClient() {
  const { data, mutate, isLoading } = useSWR<{ monitors: Monitor[] }>(
    '/api/uptime',
    fetcher,
    { refreshInterval: 15_000 },
  );

  const [formOpen, setFormOpen]   = useState(false);
  const [editing, setEditing]     = useState<Monitor | null>(null);
  const [fields, setFields]       = useState(BLANK);
  const [saving, setSaving]       = useState(false);
  const [deleteId, setDeleteId]   = useState<string | null>(null);

  const monitors = data?.monitors ?? [];

  const openCreate = () => {
    setEditing(null);
    setFields(BLANK);
    setFormOpen(true);
  };

  const openEdit = (m: Monitor) => {
    setEditing(m);
    setFields({ name: m.name, url: m.url, intervalS: m.intervalS, timeoutS: m.timeoutS, enabled: m.enabled });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!fields.name.trim() || !fields.url.trim()) return;
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/uptime/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
          })
        : await fetch('/api/uptime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
          });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to save');
        return;
      }
      toast.success(editing ? 'Monitor updated' : 'Monitor created');
      setFormOpen(false);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (m: Monitor) => {
    const res = await fetch(`/api/uptime/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !m.enabled }),
    });
    if (!res.ok) { toast.error('Failed to update'); return; }
    mutate();
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/uptime/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Failed to delete'); return; }
    toast.success('Monitor removed');
    setDeleteId(null);
    mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Uptime</h1>
          <p className="mt-1 text-sm text-ink-muted">HTTP monitors — get alerted when a URL goes down.</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add monitor
        </button>
      </div>

      {/* Summary bar */}
      {monitors.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <StatCard
            label="Total"
            value={monitors.length}
            icon={Globe}
          />
          <StatCard
            label="Up"
            value={monitors.filter((m) => m.status === 'up').length}
            icon={CheckCircle2}
            color="text-success"
          />
          <StatCard
            label="Down"
            value={monitors.filter((m) => m.status === 'down').length}
            icon={XCircle}
            color="text-danger"
          />
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center justify-center py-16 text-ink-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!isLoading && monitors.length === 0 && (
        <div className="card card-pad py-16 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-ink-muted" />
          <p className="text-sm text-ink-muted">No monitors yet. Add one to start tracking uptime.</p>
          <button onClick={openCreate} className="btn-primary mx-auto mt-4">
            <Plus className="h-4 w-4" />
            Add monitor
          </button>
        </div>
      )}

      {monitors.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-muted/40 text-[11px] uppercase tracking-wider text-ink-soft">
                <th className="px-4 py-2.5 text-left font-medium">Monitor</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium hidden sm:table-cell">Latency</th>
                <th className="px-4 py-2.5 text-right font-medium hidden md:table-cell">Interval</th>
                <th className="px-4 py-2.5 text-right font-medium hidden lg:table-cell">Last checked</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {monitors.map((m) => (
                <tr key={m.id} className="hover:bg-bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{m.name}</div>
                    <div className="truncate font-mono text-xs text-ink-muted max-w-[200px] sm:max-w-[300px]">{m.url}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={m.enabled ? m.status : 'unknown'} paused={!m.enabled} />
                  </td>
                  <td className="px-4 py-3 text-right text-ink hidden sm:table-cell">
                    {m.lastLatencyMs != null ? `${m.lastLatencyMs} ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted hidden md:table-cell">
                    {m.intervalS}s
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted hidden lg:table-cell">
                    {m.lastCheckedAt ? timeAgo(m.lastCheckedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggle(m)}
                        className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-bg-muted hover:text-ink"
                        title={m.enabled ? 'Pause' : 'Resume'}
                      >
                        {m.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => openEdit(m)}
                        className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteId(m.id)}
                        className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-danger"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="card card-pad w-full max-w-md space-y-4">
            <h2 className="text-base font-semibold text-ink">{editing ? 'Edit monitor' : 'New monitor'}</h2>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-ink-soft">Name</span>
                <input
                  className="input mt-1 w-full"
                  placeholder="My API"
                  value={fields.name}
                  onChange={(e) => setFields({ ...fields, name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-ink-soft">URL</span>
                <input
                  className="input mt-1 w-full font-mono text-sm"
                  placeholder="https://example.com/health"
                  value={fields.url}
                  onChange={(e) => setFields({ ...fields, url: e.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-ink-soft">Check interval (s)</span>
                  <input
                    type="number"
                    min={30}
                    max={3600}
                    className="input mt-1 w-full"
                    value={fields.intervalS}
                    onChange={(e) => setFields({ ...fields, intervalS: Number(e.target.value) })}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-ink-soft">Timeout (s)</span>
                  <input
                    type="number"
                    min={3}
                    max={30}
                    className="input mt-1 w-full"
                    value={fields.timeoutS}
                    onChange={(e) => setFields({ ...fields, timeoutS: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={fields.enabled}
                  onChange={(e) => setFields({ ...fields, enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                Enabled
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setFormOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? 'Save changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="card card-pad w-full max-w-sm space-y-4">
            <h2 className="text-base font-semibold text-ink">Delete monitor?</h2>
            <p className="text-sm text-ink-muted">This will remove the monitor and all its history. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="btn-danger">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status, paused }: { status: MonitorStatus; paused?: boolean }) {
  if (paused) return <span className="chip chip-muted text-[10px]">Paused</span>;
  if (status === 'up')      return <span className="chip chip-success text-[10px]">Up</span>;
  if (status === 'down')    return <span className="chip chip-danger text-[10px]">Down</span>;
  return <span className="chip chip-muted text-[10px]">Pending</span>;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-ink',
}: {
  label: string;
  value: number;
  icon: typeof Globe;
  color?: string;
}) {
  return (
    <div className="card card-pad flex items-center gap-3">
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div>
        <div className={`text-xl font-semibold ${color}`}>{value}</div>
        <div className="text-xs text-ink-muted">{label}</div>
      </div>
    </div>
  );
}
