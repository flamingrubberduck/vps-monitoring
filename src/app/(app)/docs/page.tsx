import Link from 'next/link';
import { ArrowLeft, Boxes, Code2, ShieldCheck, Terminal } from 'lucide-react';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function DocsPage() {
  const cmd = `curl -fsSL ${env.APP_URL.replace(/\/$/, '')}/api/install | sudo bash`;
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Documentation
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          How VPS Monitor works and how to install agents.
        </p>
      </div>

      <Section icon={Terminal} title="Install the agent">
        <p className="text-sm text-ink-muted">
          SSH into the VPS as root (or with sudo) and run:
        </p>
        <pre className="terminal-block mt-3 overflow-x-auto rounded-xl border border-border p-4 text-sm font-mono text-ink-muted">
          {cmd}
        </pre>
        <p className="mt-3 text-sm text-ink-muted">
          The script:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink-muted">
          <li>Generates a unique <code className="text-ink-muted">agentId</code> and token.</li>
          <li>Auto-registers the VPS with this dashboard.</li>
          <li>
            Installs a systemd service <code className="text-ink-muted">vps-monitor-agent</code>{' '}
            that survives reboots.
          </li>
          <li>Reports CPU, memory, disk, network, load and uptime every 15s by default.</li>
          <li>
            If Docker is detected on the VPS, also installs a{' '}
            <code className="text-ink-muted">vps-monitor-docker-agent</code> service that reports
            per-container CPU, memory, network and block I/O.
          </li>
        </ul>
      </Section>

      <Section icon={ShieldCheck} title="Security model">
        <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">No login on the VPS</strong> — the agent talks outbound
            only to this dashboard.
          </li>
          <li>
            Each agent has its own token. The dashboard rejects metrics with an unknown or
            mismatched token.
          </li>
          <li>Dashboard sessions are HttpOnly cookies signed with HS256 (JWT).</li>
          <li>Passwords are hashed with bcrypt (cost 12).</li>
        </ul>
      </Section>

      <Section icon={Boxes} title="Architecture">
        <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">Web:</strong> Next.js 14 App Router (this app).
          </li>
          <li>
            <strong className="text-ink">Database:</strong> TimescaleDB (Postgres). Hypertables:{' '}
            <code className="text-ink-muted">metrics</code> and{' '}
            <code className="text-ink-muted">container_metrics</code>.
          </li>
          <li>
            <strong className="text-ink">Agent:</strong> Tiny bash script using{' '}
            <code className="text-ink-muted">/proc</code>, <code>df</code>, <code>uptime</code>{' '}
            etc. Zero compiled binaries to trust.
          </li>
        </ul>
      </Section>

      <Section icon={Code2} title="API endpoints">
        <div className="space-y-2 text-sm">
          <Endpoint
            method="POST"
            path="/api/agents/register"
            desc="Agent registers itself, server returns an agentId + token."
          />
          <Endpoint
            method="POST"
            path="/api/agents/heartbeat"
            desc="Agent posts a metric snapshot every N seconds (auth via token)."
          />
          <Endpoint
            method="POST"
            path="/api/agents/heartbeat-docker"
            desc="Docker agent posts per-container stats each interval (auth via token)."
          />
          <Endpoint method="GET" path="/api/agents" desc="List all agents (team-scoped)." />
          <Endpoint
            method="GET"
            path="/api/agents/:id/metrics"
            desc="Time-series metrics for a single VPS."
          />
          <Endpoint
            method="GET"
            path="/api/agents/:id/containers"
            desc="Latest container snapshot for a VPS (last 5 minutes)."
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Terminal;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card card-pad">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        <Icon className="h-4 w-4 text-ink-muted" />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Endpoint({
  method,
  path,
  desc,
}: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  desc: string;
}) {
  const color =
    method === 'GET'
      ? 'text-zinc-300 bg-zinc-900/60 ring-1 ring-inset ring-border'
      : method === 'POST'
      ? 'text-zinc-200 bg-zinc-800/50 ring-1 ring-inset ring-border'
      : method === 'DELETE'
      ? 'text-red-300 bg-red-950/40 ring-1 ring-inset ring-red-900/50'
      : 'text-zinc-400 bg-zinc-900/60 ring-1 ring-inset ring-border';
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-soft/40 px-3 py-2.5">
      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${color}`}>
        {method}
      </span>
      <div className="min-w-0">
        <code className="block truncate font-mono text-sm text-ink">{path}</code>
        <p className="text-xs text-ink-soft">{desc}</p>
      </div>
    </div>
  );
}
