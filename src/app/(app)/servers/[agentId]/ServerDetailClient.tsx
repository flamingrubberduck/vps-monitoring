'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Network,
  Pencil,
  RefreshCw,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusDot } from '@/components/StatusDot';
import { OsBadge } from '@/components/OsBadge';
import { UsageBar } from '@/components/UsageBar';
import { MetricChart } from '@/components/MetricChart';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RenameServerDialog } from '@/components/RenameServerDialog';
import { formatBps, formatBytes, formatUptime, percent, timeAgo } from '@/lib/utils';

interface AgentDetail {
  agentId: string;
  hostname: string;
  label?: string;
  os: string;
  osVersion: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  totalDiskBytes: number;
  publicIp?: string;
  privateIp?: string;
  tags: string[];
  online: boolean;
  lastSeenAt?: string;
  registeredAt: string;
  latest: {
    cpuPercent: number;
    memUsedBytes: number;
    memTotalBytes: number;
    swapUsedBytes: number;
    swapTotalBytes: number;
    diskUsedBytes: number;
    diskTotalBytes: number;
    extraDisks: Array<{ mount: string; usedBytes: number; totalBytes: number }>;
    netRxBps: number;
    netTxBps: number;
    uptimeSeconds: number;
    processCount: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
  } | null;
}

interface MetricPoint {
  ts: string;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  netRxBps: number;
  netTxBps: number;
  loadAvg1: number;
}

interface PortBinding { hostIp: string; hostPort: string; containerPort: string; protocol: string }
interface VolumeMount { source: string; destination: string; mode: string }
interface ContainerNetwork { name: string; ipAddress: string }

interface ContainerRow {
  containerId: string;
  name: string;
  image: string;
  status: string;
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  restartCount: number;
  time: string;
  // Static config — null if agent hasn't sent details yet
  command: string | null;
  imageId: string | null;
  createdAt: string | null;
  restartPolicy: string | null;
  networkMode: string | null;
  ports: PortBinding[] | null;
  volumes: VolumeMount[] | null;
  envVars: string[] | null;
  labels: Record<string, string> | null;
  networks: ContainerNetwork[] | null;
  firstSeenAt: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const RANGES = [
  { v: '1h', label: '1h' },
  { v: '6h', label: '6h' },
  { v: '24h', label: '24h' },
  { v: '7d', label: '7d' },
];

export function ServerDetailClient({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [range, setRange] = useState('1h');
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<{ agent: AgentDetail }>(
    `/api/agents/${agentId}`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: metricsData, isLoading: loadingMetrics } = useSWR<{ metrics: MetricPoint[] }>(
    `/api/agents/${agentId}/metrics?range=${range}`,
    fetcher,
    { refreshInterval: 10000 }
  );
  const { data: containersData } = useSWR<{ containers: ContainerRow[] }>(
    `/api/agents/${agentId}/containers`,
    fetcher,
    { refreshInterval: 10000 }
  );

  const agent = data?.agent;
  const metrics = metricsData?.metrics ?? [];
  const containers = containersData?.containers ?? [];

  const performDelete = async () => {
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Failed to delete');
      throw new Error('delete failed');
    }
    toast.success('Server removed');
    router.push('/servers');
  };

  const saveRename = async (trimmed: string) => {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    });
    if (!res.ok) {
      toast.error('Failed to update');
      throw new Error('rename failed');
    }
    toast.success('Updated');
    mutate();
  };

  if (isLoading && !agent) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading server…
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="card card-pad text-center">
        <p className="text-ink-muted">Server not found.</p>
        <Link href="/servers" className="btn-secondary mt-4">
          Back to servers
        </Link>
      </div>
    );
  }

  const latest = agent.latest;
  const memPct = percent(latest?.memUsedBytes ?? 0, latest?.memTotalBytes ?? agent.totalMemoryBytes);
  const diskPct = percent(
    latest?.diskUsedBytes ?? 0,
    latest?.diskTotalBytes ?? agent.totalDiskBytes
  );
  const swapPct = percent(latest?.swapUsedBytes ?? 0, latest?.swapTotalBytes ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <Link
            href="/servers"
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            All servers
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusDot online={agent.online} className="h-3 w-3" />
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {agent.label || agent.hostname}
            </h1>
            <button
              type="button"
              onClick={() => setRenameOpen(true)}
              className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
              title="Edit label"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <span
              className={`chip ${agent.online ? 'chip-success' : 'chip-muted'} text-[10px]`}
            >
              {agent.online ? 'Online' : `Last seen ${timeAgo(agent.lastSeenAt)}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-mono">{agent.agentId}</span>
            {agent.publicIp && (
              <>
                {' · '}
                <span className="font-mono">{agent.publicIp}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => mutate()} className="btn-secondary">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" onClick={() => setDeleteOpen(true)} className="btn-danger">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GaugeCard
          icon={Cpu}
          label="CPU"
          value={`${(latest?.cpuPercent ?? 0).toFixed(1)}%`}
          sub={`${agent.cpuCores} cores · load ${(latest?.loadAvg1 ?? 0).toFixed(2)}`}
          pct={latest?.cpuPercent ?? 0}
        />
        <GaugeCard
          icon={MemoryStick}
          label="Memory"
          value={`${memPct.toFixed(1)}%`}
          sub={`${formatBytes(latest?.memUsedBytes ?? 0)} / ${formatBytes(
            latest?.memTotalBytes ?? agent.totalMemoryBytes
          )}`}
          pct={memPct}
        />
        <GaugeCard
          icon={HardDrive}
          label="Disk"
          value={`${diskPct.toFixed(1)}%`}
          sub={`${formatBytes(latest?.diskUsedBytes ?? 0)} / ${formatBytes(
            latest?.diskTotalBytes ?? agent.totalDiskBytes
          )}`}
          pct={diskPct}
        />
        <GaugeCard
          icon={Network}
          label="Network"
          value={`↓ ${formatBps(latest?.netRxBps ?? 0)}`}
          sub={`↑ ${formatBps(latest?.netTxBps ?? 0)}`}
          pct={Math.min(100, ((latest?.netRxBps ?? 0) + (latest?.netTxBps ?? 0)) / 10_000_000)}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Performance</h2>
            <p className="text-xs text-ink-soft">
              {loadingMetrics ? 'Loading…' : `${metrics.length} data points`}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-bg-muted p-1 text-xs">
            {RANGES.map((r) => (
              <button
                key={r.v}
                onClick={() => setRange(r.v)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  range === r.v
                    ? 'bg-bg-card text-ink shadow'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
          <ChartCard title="CPU usage" hint="%">
            <MetricChart
              data={metrics}
              series={[{ key: 'cpuPercent', label: 'CPU', color: '#a1a1aa' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Memory usage" hint={formatBytes(agent.totalMemoryBytes)}>
            <MetricChart
              data={metrics.map((m) => ({
                ...m,
                memPct: m.memTotalBytes ? (m.memUsedBytes / m.memTotalBytes) * 100 : 0,
              }))}
              series={[{ key: 'memPct', label: 'Memory', color: '#71717a' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Network throughput" hint="bytes/sec">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'netRxBps',
                  label: 'Download',
                  color: '#a1a1aa',
                  formatter: (v) => formatBps(v),
                },
                {
                  key: 'netTxBps',
                  label: 'Upload',
                  color: '#52525b',
                  formatter: (v) => formatBps(v),
                },
              ]}
              yFormatter={(v) => formatBytes(v)}
            />
          </ChartCard>

          <ChartCard title="Load average" hint="1 minute">
            <MetricChart
              data={metrics}
              series={[{ key: 'loadAvg1', label: 'Load (1m)', color: '#d4d4d8' }]}
              yFormatter={(v) => v.toFixed(2)}
            />
          </ChartCard>
        </div>
      </div>

      {containers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <Box className="h-4 w-4 text-ink-muted" />
            <h2 className="text-base font-semibold text-ink">Docker containers</h2>
            <span className="ml-auto text-xs text-ink-soft">{containers.length} container{containers.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-muted/40 text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="w-6 px-2 py-2.5" />
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Image</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">CPU</th>
                  <th className="px-4 py-2.5 text-right font-medium">Memory</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net I/O</th>
                  <th className="px-4 py-2.5 text-right font-medium">Restarts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {containers.map((c) => {
                  const memPct = c.memLimitBytes > 0 ? (c.memUsedBytes / c.memLimitBytes) * 100 : 0;
                  const isRunning = c.status === 'running';
                  const isExpanded = expandedContainer === c.containerId;
                  const hasDetails = c.command !== null;
                  return (
                    <>
                      <tr
                        key={c.containerId}
                        className={`${hasDetails ? 'cursor-pointer' : ''} hover:bg-bg-muted/30`}
                        onClick={() => hasDetails && setExpandedContainer(isExpanded ? null : c.containerId)}
                      >
                        <td className="px-2 py-3 text-ink-soft">
                          {hasDetails && (isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-ink">{c.name}</td>
                        <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-ink-soft">{c.image}</td>
                        <td className="px-4 py-3">
                          <span className={`chip text-[10px] ${isRunning ? 'chip-success' : 'chip-muted'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-ink">{c.cpuPercent.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right text-ink">
                          {formatBytes(c.memUsedBytes)}
                          {c.memLimitBytes > 0 && (
                            <span className="ml-1 text-ink-soft">/ {formatBytes(c.memLimitBytes)} ({memPct.toFixed(0)}%)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-ink">
                          ↓{formatBytes(c.netRxBytes)} ↑{formatBytes(c.netTxBytes)}
                        </td>
                        <td className="px-4 py-3 text-right text-ink">{c.restartCount}</td>
                      </tr>
                      {isExpanded && hasDetails && (
                        <tr key={`${c.containerId}-detail`} className="bg-bg-soft/60">
                          <td colSpan={8} className="px-6 pb-5 pt-3">
                            <ContainerDetail c={c} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <h3 className="mb-4 text-base font-semibold text-ink">System info</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Hostname" value={agent.hostname} mono />
            <Row label="Operating system" value={<OsBadge os={agent.os} version={agent.osVersion} />} />
            <Row label="Kernel" value={agent.kernel} mono />
            <Row label="Architecture" value={agent.arch} mono />
            <Row label="CPU" value={agent.cpuModel || '—'} />
            <Row label="Cores" value={String(agent.cpuCores)} />
            <Row label="Memory" value={formatBytes(agent.totalMemoryBytes)} />
            <Row label="Disk" value={formatBytes(agent.totalDiskBytes)} />
            <Row label="Public IP" value={agent.publicIp ?? '—'} mono />
            <Row label="Private IP" value={agent.privateIp ?? '—'} mono />
            <Row label="Uptime" value={formatUptime(latest?.uptimeSeconds ?? 0)} />
            <Row label="Processes" value={String(latest?.processCount ?? 0)} />
            <Row label="Registered" value={timeAgo(agent.registeredAt)} />
            <Row label="Last seen" value={timeAgo(agent.lastSeenAt)} />
          </dl>
        </div>

        <div className="card card-pad">
          <h3 className="mb-4 text-base font-semibold text-ink">Resource breakdown</h3>
          <div className="space-y-4">
            <UsageBar
              value={latest?.cpuPercent ?? 0}
              label="CPU"
              hint={`${(latest?.cpuPercent ?? 0).toFixed(1)}%`}
            />
            <UsageBar
              value={memPct}
              label="Memory"
              hint={`${formatBytes(latest?.memUsedBytes ?? 0)} / ${formatBytes(
                latest?.memTotalBytes ?? agent.totalMemoryBytes
              )}`}
            />
            <UsageBar
              value={swapPct}
              label="Swap"
              hint={`${formatBytes(latest?.swapUsedBytes ?? 0)} / ${formatBytes(
                latest?.swapTotalBytes ?? 0
              )}`}
            />
            <UsageBar
              value={diskPct}
              label="Disk (/)"
              hint={`${formatBytes(latest?.diskUsedBytes ?? 0)} / ${formatBytes(
                latest?.diskTotalBytes ?? agent.totalDiskBytes
              )}`}
            />
            {(latest?.extraDisks ?? []).map((d) => {
              const pct = percent(d.usedBytes, d.totalBytes);
              return (
                <UsageBar
                  key={d.mount}
                  value={pct}
                  label={`Disk (${d.mount})`}
                  hint={`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`}
                />
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-border bg-bg-soft/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ServerIcon className="h-4 w-4 text-ink-muted" />
              Load average
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              {(['loadAvg1', 'loadAvg5', 'loadAvg15'] as const).map((k, i) => (
                <div key={k} className="rounded-lg bg-bg-muted/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-soft">
                    {['1 min', '5 min', '15 min'][i]}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-ink">
                    {(latest?.[k] ?? 0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <RenameServerDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        label={agent.label}
        hostname={agent.hostname}
        onSave={saveRename}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete server?"
        description={
          <>
            Remove <span className="font-semibold text-ink">{agent.label || agent.hostname}</span> and
            all metrics. <span className="text-danger">This cannot be undone.</span>
          </>
        }
        cancelLabel="Cancel"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={performDelete}
      />
    </div>
  );
}

function GaugeCard({
  icon: Icon,
  label,
  value,
  sub,
  pct,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub: string;
  pct: number;
}) {
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-soft">{label}</div>
          <div className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink">
            {value}
          </div>
          <div className="mt-1 truncate text-xs text-ink-soft">{sub}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-bg-muted text-ink-muted">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <UsageBar value={pct} className="mt-4" />
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-soft/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        {hint && <span className="text-xs text-ink-soft">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className={`truncate text-ink ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
    </div>
  );
}

function ContainerDetail({ c }: { c: ContainerRow }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Left column — identity + config */}
      <div className="space-y-3 text-xs">
        <DetailRow label="Container ID" value={c.containerId} mono />
        <DetailRow label="Image ID"     value={c.imageId ?? '—'} mono />
        <DetailRow label="Created"      value={c.createdAt ? timeAgo(c.createdAt) : '—'} />
        <DetailRow label="Command"      value={c.command || '—'} mono />
        <DetailRow label="Restart policy" value={c.restartPolicy || 'no'} />
        <DetailRow label="Network mode"   value={c.networkMode || '—'} />

        {/* Ports */}
        {c.ports && c.ports.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">Ports</div>
            <div className="space-y-0.5 font-mono">
              {c.ports.map((p, i) => (
                <div key={i} className="text-ink">
                  {p.hostIp && p.hostIp !== '0.0.0.0' ? `${p.hostIp}:` : ''}{p.hostPort}→{p.containerPort}/{p.protocol}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Networks */}
        {c.networks && c.networks.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">Networks</div>
            <div className="space-y-0.5">
              {c.networks.map((n, i) => (
                <div key={i} className="font-mono text-ink">
                  {n.name}{n.ipAddress ? ` — ${n.ipAddress}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right column — volumes, labels, env vars */}
      <div className="space-y-3 text-xs">
        {/* Volumes */}
        {c.volumes && c.volumes.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">Volumes</div>
            <div className="space-y-0.5">
              {c.volumes.map((v, i) => (
                <div key={i} className="font-mono text-ink">
                  <span className="text-ink-muted">{v.source || '(anonymous)'}</span>
                  {' → '}{v.destination}
                  {v.mode && v.mode !== 'rw' && <span className="ml-1 text-ink-soft">({v.mode})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Labels */}
        {c.labels && Object.keys(c.labels).length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">Labels</div>
            <div className="space-y-0.5 font-mono">
              {Object.entries(c.labels).map(([k, v]) => (
                <div key={k} className="flex gap-1 text-ink">
                  <span className="text-ink-muted shrink-0">{k}=</span>
                  <span className="break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Env vars */}
        {c.envVars && c.envVars.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">
              Environment variables
              <span className="ml-1 normal-case text-ink-soft">({c.envVars.length})</span>
            </div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-bg-muted/40 p-2 font-mono">
              {c.envVars.map((e, i) => {
                const eqIdx = e.indexOf('=');
                const key = eqIdx > -1 ? e.slice(0, eqIdx) : e;
                const val = eqIdx > -1 ? e.slice(eqIdx + 1) : '';
                return (
                  <div key={i} className="flex gap-1 text-ink">
                    <span className="text-ink-muted shrink-0">{key}=</span>
                    <span className="break-all">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</div>
      <div className={`break-all text-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
