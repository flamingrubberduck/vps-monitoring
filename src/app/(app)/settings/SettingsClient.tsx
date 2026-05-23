'use client';

import useSWR from 'swr';
import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Monitor,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/ThemeToggle';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AlertSettingsResponse = {
  // Telegram
  botTokenConfigured: boolean;
  telegramChatId: string;
  // Email
  smtpConfigured: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
  smtpTo: string;
  // Slack / Discord / Webhook
  slackConfigured: boolean;
  slackWebhookUrl: string;
  discordConfigured: boolean;
  discordWebhookUrl: string;
  webhookConfigured: boolean;
  webhookUrl: string;
  // Legacy thresholds
  alertCpuPercent: number;
  alertRamPercent: number;
  alertDiskPercent: number;
  telegramCooldownSeconds: number;
};

type Member = { userId: string; username: string; role: string };

export function SettingsClient({
  appUrl,
  offlineAfterSeconds,
}: {
  appUrl: string;
  offlineAfterSeconds: number;
}) {
  const { data: meData } = useSWR<{ user: { username: string; role: string; teamId: string } | null }>('/api/auth/me', fetcher);
  const { data: teamData, mutate: mutateTeam } = useSWR<{ team: { id: string; name: string } }>('/api/team', fetcher);
  const {
    data: alertData,
    error: alertError,
    isLoading: alertLoading,
    mutate: mutateAlerts,
  } = useSWR<AlertSettingsResponse>('/api/settings/alerts', fetcher);
  const { data: membersData, mutate: mutateMembers } = useSWR<{ members: Member[] }>('/api/team/members', fetcher);

  const isOwner = meData?.user?.role === 'owner';
  const isAdmin = meData?.user?.role === 'owner' || meData?.user?.role === 'admin';

  // ─── Change password ─────────────────────────────────────────────────────────
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving] = useState(false);

  // ─── App URL copy ────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // ─── Team name ───────────────────────────────────────────────────────────────
  const [teamName, setTeamName] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);

  useEffect(() => {
    if (teamData?.team?.name && !teamName) setTeamName(teamData.team.name);
  }, [teamData, teamName]);

  // ─── Invite member ────────────────────────────────────────────────────────────
  const [inviteUsername, setInviteUsername] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);

  // ─── Alert settings ───────────────────────────────────────────────────────────
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [clearBotToken, setClearBotToken] = useState(false);
  const [cpu, setCpu] = useState('85');
  const [ram, setRam] = useState('85');
  const [disk, setDisk] = useState('90');
  const [cooldown, setCooldown] = useState('300');
  // Slack / Discord / Webhook
  const [slackUrl, setSlackUrl] = useState('');
  const [discordUrl, setDiscordUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [alertsHydrated, setAlertsHydrated] = useState(false);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!alertData || alertsHydrated) return;
    setChatId(alertData.telegramChatId);
    setCpu(String(alertData.alertCpuPercent));
    setRam(String(alertData.alertRamPercent));
    setDisk(String(alertData.alertDiskPercent));
    setCooldown(String(alertData.telegramCooldownSeconds));
    setSlackUrl(alertData.slackWebhookUrl ?? '');
    setDiscordUrl(alertData.discordWebhookUrl ?? '');
    setWebhookUrl(alertData.webhookUrl ?? '');
    setAlertsHydrated(true);
  }, [alertData, alertsHydrated]);

  const copy = async () => {
    await navigator.clipboard.writeText(appUrl);
    setCopied(true);
    toast.success('Copied');
    setTimeout(() => setCopied(false), 1500);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 8) return toast.error('New password must be at least 8 chars.');
    if (newPwd !== confirmPwd) return toast.error('Passwords do not match.');
    setSaving(true);
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
    });
    const out = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success('Password updated');
    setOldPwd(''); setNewPwd(''); setConfirmPwd('');
  };

  const renameTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTeam(true);
    const res = await fetch('/api/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: teamName }),
    });
    const out = await res.json().catch(() => ({}));
    setSavingTeam(false);
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success('Team renamed');
    mutateTeam();
  };

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invitePassword.length < 8) return toast.error('Password must be at least 8 chars.');
    setInviting(true);
    const res = await fetch('/api/team/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: inviteUsername, password: invitePassword, role: inviteRole }),
    });
    const out = await res.json().catch(() => ({}));
    setInviting(false);
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success(`User "${out.username}" added as ${out.role}`);
    setInviteUsername(''); setInvitePassword('');
    mutateMembers();
  };

  const removeMember = async (userId: string, username: string) => {
    if (!confirm(`Remove ${username} from the team?`)) return;
    const res = await fetch(`/api/team/members/${userId}`, { method: 'DELETE' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success(`${username} removed`);
    mutateMembers();
  };

  const changeRole = async (userId: string, role: 'admin' | 'viewer') => {
    const res = await fetch(`/api/team/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? 'Failed');
    toast.success('Role updated');
    mutateMembers();
  };

  const saveAlerts = async (e: React.FormEvent) => {
    e.preventDefault();
    const nCpu = Math.round(Number(cpu));
    const nRam = Math.round(Number(ram));
    const nDisk = Math.round(Number(disk));
    const nCd = Math.round(Number(cooldown));
    if (!Number.isFinite(nCpu) || nCpu < 1 || nCpu > 100) return toast.error('CPU: 1–100');
    if (!Number.isFinite(nRam) || nRam < 1 || nRam > 100) return toast.error('RAM: 1–100');
    if (!Number.isFinite(nDisk) || nDisk < 1 || nDisk > 100) return toast.error('Disk: 1–100');
    if (!Number.isFinite(nCd) || nCd < 60 || nCd > 86_400) return toast.error('Cooldown: 60–86400s');

    const body: Record<string, unknown> = {
      telegramChatId: chatId,
      alertCpuPercent: nCpu,
      alertRamPercent: nRam,
      alertDiskPercent: nDisk,
      telegramCooldownSeconds: nCd,
      slackWebhookUrl: slackUrl,
      discordWebhookUrl: discordUrl,
      webhookUrl,
      webhookSecret,
    };
    const trimmed = botToken.trim();
    if (trimmed) body.telegramBotToken = trimmed;
    if (clearBotToken) body.clearTelegramBotToken = true;

    setSavingAlerts(true);
    const res = await fetch('/api/settings/alerts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setSavingAlerts(false);
    if (!res.ok) return toast.error(out.error ?? 'Failed to save');
    mutateAlerts(out, false);
    setBotToken(''); setClearBotToken(false);
    toast.success('Notification settings saved');
  };

  const sendTest = async () => {
    setTesting(true);
    const res = await fetch('/api/settings/alerts/test', { method: 'POST' });
    const out = await res.json().catch(() => ({}));
    setTesting(false);
    if (!res.ok) return toast.error(out.error ?? 'Test failed');
    toast.success('Test message sent — check Telegram');
  };

  const telegramConfigured =
    alertData?.botTokenConfigured && (alertData.telegramChatId?.trim() ?? '').length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Manage your account, team, and notifications.</p>
      </div>

      {/* Appearance */}
      <div className="card card-pad">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Monitor className="h-4 w-4 text-ink-muted" />
          Appearance
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Light or dark interface. Saved in this browser.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-soft">Theme</span>
          <ThemeToggle className="border border-border bg-bg-muted" />
        </div>
      </div>

      {/* Account */}
      <div className="card card-pad">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-success" />
          Account
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Row label="Username" value={meData?.user?.username ?? '—'} />
          <Row label="Role" value={meData?.user?.role ?? '—'} />
          <Row label="Team" value={teamData?.team?.name ?? '—'} />
        </dl>
      </div>

      {/* Change password */}
      <form onSubmit={changePassword} className="card card-pad">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <KeyRound className="h-4 w-4 text-ink-muted" />
          Change password
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="label">Current password</label>
            <input type="password" className="input" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} required autoComplete="current-password" />
          </div>
          <div>
            <label className="label">New password</label>
            <input type="password" className="input" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} minLength={8} required autoComplete="new-password" />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input type="password" className="input" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} minLength={8} required autoComplete="new-password" />
          </div>
        </div>
        <div className="mt-4">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Update password
          </button>
        </div>
      </form>

      {/* Team — owner only */}
      {isOwner && (
        <form onSubmit={renameTeam} className="card card-pad">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Users className="h-4 w-4 text-ink-muted" />
            Team
          </h2>
          <div className="mt-4 max-w-sm">
            <label className="label">Team name</label>
            <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} required minLength={1} maxLength={64} />
          </div>
          <div className="mt-4">
            <button type="submit" className="btn-primary" disabled={savingTeam}>
              {savingTeam && <Loader2 className="h-4 w-4 animate-spin" />}
              Save name
            </button>
          </div>
        </form>
      )}

      {/* Team members */}
      <div className="card card-pad">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Users className="h-4 w-4 text-ink-muted" />
          Team members
        </h2>

        <div className="mt-4 divide-y divide-border">
          {membersData?.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm font-medium text-ink">{m.username}</span>
                <span className="ml-2 text-xs text-ink-soft capitalize">{m.role}</span>
              </div>
              {isAdmin && m.role !== 'owner' && (
                <div className="flex items-center gap-2">
                  <select
                    className="input py-1 text-xs"
                    value={m.role}
                    onChange={(e) => changeRole(m.userId, e.target.value as 'admin' | 'viewer')}
                  >
                    <option value="admin">admin</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-ink-soft hover:bg-danger/10 hover:text-danger"
                    onClick={() => removeMember(m.userId, m.username)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <form onSubmit={inviteMember} className="mt-4 border-t border-border pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <UserPlus className="h-4 w-4" />
              Add member
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-1">
                <label className="label">Username</label>
                <input className="input" value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.\-]+" />
              </div>
              <div className="sm:col-span-1">
                <label className="label">Password</label>
                <input type="password" className="input" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} required minLength={8} />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'viewer')}>
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="flex items-end">
                <button type="submit" className="btn-primary w-full" disabled={inviting}>
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Add
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Notification channels */}
      <form onSubmit={saveAlerts} className="card card-pad">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Bell className="h-4 w-4 text-ink-muted" />
          Notification channels
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Configure where alerts are sent. Alert rules control which thresholds trigger which channels.
        </p>

        {alertLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {alertError && <p className="mt-4 text-sm text-danger">Failed to load settings.</p>}

        {!alertLoading && alertData && (
          <>
            {/* Telegram */}
            <div className="mt-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Send className="h-3.5 w-3.5 text-ink-muted" />
                Telegram
                {telegramConfigured
                  ? <span className="chip-success">configured</span>
                  : <span className="chip-muted">not configured</span>}
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="label">Bot token (@BotFather)</label>
                  <input
                    type="password"
                    className="input font-mono text-sm"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder={alertData.botTokenConfigured ? '•••• — leave blank to keep current' : '123456789:ABC…'}
                    autoComplete="off"
                  />
                  {alertData.botTokenConfigured && (
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
                      <input type="checkbox" checked={clearBotToken} onChange={(e) => setClearBotToken(e.target.checked)} />
                      Clear saved token
                    </label>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="label">Chat ID</label>
                  <input className="input font-mono text-sm" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100… or user id" autoComplete="off" />
                </div>
              </div>
            </div>

            {/* Slack */}
            <div className="mt-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                Slack
                {alertData.slackConfigured
                  ? <span className="chip-success">configured</span>
                  : <span className="chip-muted">not configured</span>}
              </h3>
              <div className="mt-3">
                <label className="label">Incoming webhook URL</label>
                <input className="input font-mono text-sm" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" autoComplete="off" />
              </div>
            </div>

            {/* Discord */}
            <div className="mt-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                Discord
                {alertData.discordConfigured
                  ? <span className="chip-success">configured</span>
                  : <span className="chip-muted">not configured</span>}
              </h3>
              <div className="mt-3">
                <label className="label">Webhook URL</label>
                <input className="input font-mono text-sm" value={discordUrl} onChange={(e) => setDiscordUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" autoComplete="off" />
              </div>
            </div>

            {/* Generic webhook */}
            <div className="mt-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                Generic webhook
                {alertData.webhookConfigured
                  ? <span className="chip-success">configured</span>
                  : <span className="chip-muted">not configured</span>}
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="label">URL (POST)</label>
                  <input className="input font-mono text-sm" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://…" autoComplete="off" />
                </div>
                <div>
                  <label className="label">Secret (sent as X-Vpsmon-Secret header)</label>
                  <input className="input font-mono text-sm" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="optional" autoComplete="off" />
                </div>
              </div>
            </div>

            {/* Legacy thresholds */}
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-ink">Default thresholds</h3>
              <p className="mt-1 text-xs text-ink-soft">Used when creating new alert rules as defaults. Existing rules use their own thresholds.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="label">CPU ≥ (%)</label>
                  <input className="input" type="number" min={1} max={100} value={cpu} onChange={(e) => setCpu(e.target.value)} />
                </div>
                <div>
                  <label className="label">RAM ≥ (%)</label>
                  <input className="input" type="number" min={1} max={100} value={ram} onChange={(e) => setRam(e.target.value)} />
                </div>
                <div>
                  <label className="label">Disk ≥ (%)</label>
                  <input className="input" type="number" min={1} max={100} value={disk} onChange={(e) => setDisk(e.target.value)} />
                </div>
                <div>
                  <label className="label">Cooldown (s)</label>
                  <input className="input" type="number" min={60} max={86400} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={savingAlerts}>
                {savingAlerts && <Loader2 className="h-4 w-4 animate-spin" />}
                Save channels
              </button>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                disabled={testing || !telegramConfigured}
                onClick={sendTest}
                title={!telegramConfigured ? 'Requires Telegram bot token + chat id' : undefined}
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Telegram test
              </button>
            </div>
          </>
        )}
      </form>

      {/* Dashboard info */}
      <div className="card card-pad">
        <h2 className="text-base font-semibold text-ink">Dashboard</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-ink-soft">App URL</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="truncate font-mono text-ink">{appUrl}</code>
              <button type="button" onClick={copy} className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </dd>
          </div>
          <Row label="Offline threshold" value={`${offlineAfterSeconds}s without heartbeat`} />
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </div>
  );
}
