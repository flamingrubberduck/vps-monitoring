import { and, eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Db } from './db';
import { alertRules, appSettings, uptimeEvents, uptimeMonitors } from './schema';
import { telegramSendMessageHtml } from './telegram-client';

type Monitor    = typeof uptimeMonitors.$inferSelect;
type Settings   = typeof appSettings.$inferSelect | null;

// ─── HTTP check ───────────────────────────────────────────────────────────────

async function httpCheck(url: string, timeoutS: number): Promise<{
  up: boolean;
  latencyMs: number;
  statusCode: number | null;
  error: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutS * 1000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'VPSMonitor-Uptime/1.0' },
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    const up = res.status >= 200 && res.status < 400;
    return { up, latencyMs, statusCode: res.status, error: null };
  } catch (e: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    return { up: false, latencyMs, statusCode: null, error };
  }
}

// ─── Alert channels ───────────────────────────────────────────────────────────

function buildDownText(monitor: Monitor, error: string | null, statusCode: number | null): string {
  return (
    `🔴 DOWN: ${monitor.name}\n` +
    `URL: ${monitor.url}\n` +
    (statusCode ? `Status: ${statusCode}\n` : '') +
    (error ? `Error: ${error}\n` : '')
  );
}

function buildDownHtml(monitor: Monitor, error: string | null, statusCode: number | null, appUrl: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    `<b>🔴 DOWN — ${esc(monitor.name)}</b>`,
    `<b>URL:</b> <code>${esc(monitor.url)}</code>`,
    ...(statusCode ? [`<b>HTTP status:</b> ${statusCode}`] : []),
    ...(error ? [`<b>Error:</b> ${esc(error)}`] : []),
    `<a href="${esc(appUrl.replace(/\/$/, ''))}/uptime">Open uptime dashboard</a>`,
  ].join('\n');
}

function buildUpText(monitor: Monitor): string {
  return `✅ RECOVERED: ${monitor.name}\nURL: ${monitor.url}`;
}

function buildUpHtml(monitor: Monitor, appUrl: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    `<b>✅ RECOVERED — ${esc(monitor.name)}</b>`,
    `<b>URL:</b> <code>${esc(monitor.url)}</code>`,
    `<a href="${esc(appUrl.replace(/\/$/, ''))}/uptime">Open uptime dashboard</a>`,
  ].join('\n');
}

async function sendEmail(settings: Settings, subject: string, text: string) {
  if (!settings?.smtpHost || !settings?.smtpTo || !settings?.smtpFrom) return;
  try {
    const t = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort || 587,
      secure: (settings.smtpPort || 587) === 465,
      auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPassword } : undefined,
    });
    await t.sendMail({ from: settings.smtpFrom, to: settings.smtpTo, subject, text });
  } catch (e) {
    console.error('[uptime] email failed:', e);
  }
}

async function sendTelegram(settings: Settings, html: string) {
  if (!settings?.telegramBotToken || !settings?.telegramChatId) return;
  const r = await telegramSendMessageHtml(settings.telegramBotToken, settings.telegramChatId, html);
  if (!r.ok) console.error('[uptime] telegram failed:', r.description);
}

async function sendSlack(settings: Settings, text: string) {
  if (!settings?.slackWebhookUrl) return;
  try {
    await fetch(settings.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error('[uptime] slack failed:', e);
  }
}

async function sendDiscord(settings: Settings, text: string) {
  if (!settings?.discordWebhookUrl) return;
  try {
    await fetch(settings.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
  } catch (e) {
    console.error('[uptime] discord failed:', e);
  }
}

// ─── Main check + alert ───────────────────────────────────────────────────────

export async function dispatchUptimeAlert(
  db: Db,
  monitor: Monitor,
  settings: Settings,
  appUrl: string,
): Promise<void> {
  const { up, latencyMs, statusCode, error } = await httpCheck(monitor.url, monitor.timeoutS);
  const now    = new Date();
  const status = up ? 'up' : 'down';

  // Record event
  await db.insert(uptimeEvents).values({
    time:       now,
    monitorId:  monitor.id,
    status,
    latencyMs,
    statusCode,
    error,
  });

  const wasDown = monitor.status === 'down';
  const changed = monitor.status !== status && monitor.status !== 'unknown';

  // Update monitor state
  await db
    .update(uptimeMonitors)
    .set({
      status,
      lastCheckedAt:  now,
      lastLatencyMs:  latencyMs,
      lastStatusCode: statusCode,
      ...((!up && !wasDown) ? { lastDownAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(uptimeMonitors.id, monitor.id));

  // Only alert on state transitions (up→down or down→up)
  if (!changed || !settings) return;

  const plain = up ? buildUpText(monitor) : buildDownText(monitor, error, statusCode);
  const html  = up ? buildUpHtml(monitor, appUrl) : buildDownHtml(monitor, error, statusCode, appUrl);
  const subject = up
    ? `[VPS Monitor] RECOVERED: ${monitor.name}`
    : `[VPS Monitor] DOWN: ${monitor.name}`;

  // Get alert rules for this team that cover 'uptime' resource
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.teamId, monitor.teamId),
        eq(alertRules.enabled, true),
        eq(alertRules.resource, 'uptime'),
      ),
    );

  // Collect unique channel set from matching rules (or fall back to all available channels)
  const channelSet = new Set<string>();
  for (const rule of rules) {
    if (!rule.resourceId || rule.resourceId === monitor.id) {
      for (const ch of rule.channels) channelSet.add(ch);
    }
  }

  // If no uptime rules configured, default to telegram + email if available
  if (channelSet.size === 0) {
    channelSet.add('telegram');
    channelSet.add('email');
  }

  await Promise.allSettled([
    channelSet.has('telegram') ? sendTelegram(settings, html) : Promise.resolve(),
    channelSet.has('email')    ? sendEmail(settings, subject, plain) : Promise.resolve(),
    channelSet.has('slack')    ? sendSlack(settings, plain) : Promise.resolve(),
    channelSet.has('discord')  ? sendDiscord(settings, plain) : Promise.resolve(),
  ]);
}
