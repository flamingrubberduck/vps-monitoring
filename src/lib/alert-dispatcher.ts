/**
 * Pluggable alert dispatcher.
 *
 * Evaluates alert_rules for a given agent heartbeat and fires configured
 * channels (Telegram, Email, Slack, Discord, Webhook) subject to per-rule
 * cooldown. Designed to be called from the heartbeat API route.
 */

import { and, eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Db } from './db';
import { alertRules, agents, appSettings } from './schema';
import { telegramSendMessageHtml } from './telegram-client';
import { formatBytes, percent } from './utils';

export type HeartbeatSnapshot = {
  agentId:       string;
  hostname:      string;
  label?:        string | null;
  publicIp?:     string | null;
  cpuPercent:    number;
  memUsedBytes:  number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes:number;
};

// ─── Metric extractors ────────────────────────────────────────────────────────

function extractMetric(snap: HeartbeatSnapshot, metric: string): number | null {
  switch (metric) {
    case 'cpu_percent':   return snap.cpuPercent;
    case 'mem_percent':   return percent(snap.memUsedBytes, snap.memTotalBytes);
    case 'disk_percent':  return percent(snap.diskUsedBytes, snap.diskTotalBytes);
    case 'mem_used':      return snap.memUsedBytes;
    case 'disk_used':     return snap.diskUsedBytes;
    default:              return null;
  }
}

function evaluate(value: number, operator: string, threshold: number): boolean {
  if (operator === 'gt') return value > threshold;
  if (operator === 'lt') return value < threshold;
  if (operator === 'eq') return value === threshold;
  return false;
}

// ─── Channel dispatchers ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildAlertText(
  snap: HeartbeatSnapshot,
  ruleName: string,
  metric: string,
  value: number,
  threshold: number,
  operator: string,
  appUrl: string,
): string {
  const name = (snap.label?.trim() || snap.hostname || snap.agentId).slice(0, 200);
  const opLabel = operator === 'gt' ? '>' : operator === 'lt' ? '<' : '=';
  const valueStr = metric.endsWith('_percent') ? `${value.toFixed(1)}%`
    : metric.endsWith('_used') ? formatBytes(value)
    : String(value);
  const threshStr = metric.endsWith('_percent') ? `${threshold}%`
    : metric.endsWith('_used') ? formatBytes(threshold)
    : String(threshold);

  return (
    `⚠️ Alert: ${ruleName}\n` +
    `Server: ${name} (${snap.agentId})\n` +
    (snap.publicIp ? `IP: ${snap.publicIp}\n` : '') +
    `${metric}: ${valueStr} ${opLabel} ${threshStr}\n` +
    `${appUrl.replace(/\/$/, '')}/servers/${encodeURIComponent(snap.agentId)}`
  );
}

function buildHtmlAlertText(
  snap: HeartbeatSnapshot,
  ruleName: string,
  metric: string,
  value: number,
  threshold: number,
  operator: string,
  appUrl: string,
): string {
  const name = (snap.label?.trim() || snap.hostname || snap.agentId).slice(0, 200);
  const opLabel = operator === 'gt' ? '&gt;' : operator === 'lt' ? '&lt;' : '=';
  const valueStr = metric.endsWith('_percent') ? `${value.toFixed(1)}%`
    : metric.endsWith('_used') ? formatBytes(value)
    : String(value);
  const threshStr = metric.endsWith('_percent') ? `${threshold}%`
    : metric.endsWith('_used') ? formatBytes(threshold)
    : String(threshold);

  const url = `${appUrl.replace(/\/$/, '')}/servers/${encodeURIComponent(snap.agentId)}`;
  const href = url.replace(/&/g, '&amp;');

  return [
    `<b>⚠️ VPS Monitor — ${escapeHtml(ruleName)}</b>`,
    `<b>Server:</b> ${escapeHtml(name)}`,
    ...(snap.publicIp ? [`<b>IP:</b> <code>${escapeHtml(snap.publicIp)}</code>`] : []),
    `<b>${escapeHtml(metric)}:</b> ${valueStr} ${opLabel} ${threshStr}`,
    `<a href="${href}">Open dashboard</a>`,
  ].join('\n');
}

async function dispatchTelegram(
  settings: typeof appSettings.$inferSelect,
  text: string,
): Promise<void> {
  if (!settings.telegramBotToken || !settings.telegramChatId) return;
  const result = await telegramSendMessageHtml(
    settings.telegramBotToken,
    settings.telegramChatId,
    text,
  );
  if (!result.ok) {
    console.error('[alert] telegram failed:', result.httpStatus, result.description);
  }
}

async function dispatchSlack(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error('[alert] slack webhook failed:', res.status);
  } catch (e) {
    console.error('[alert] slack webhook error:', e);
  }
}

async function dispatchDiscord(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) console.error('[alert] discord webhook failed:', res.status);
  } catch (e) {
    console.error('[alert] discord webhook error:', e);
  }
}

async function dispatchEmail(
  settings: typeof appSettings.$inferSelect,
  subject: string,
  text: string,
): Promise<void> {
  const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom, smtpTo } = settings;
  if (!smtpHost || !smtpTo || !smtpFrom) return;
  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort || 587,
      secure: (smtpPort || 587) === 465,
      auth: smtpUser ? { user: smtpUser, pass: smtpPassword } : undefined,
    });
    await transporter.sendMail({ from: smtpFrom, to: smtpTo, subject, text });
  } catch (e) {
    console.error('[alert] email failed:', e);
  }
}

async function dispatchWebhook(
  webhookUrl: string,
  secret: string,
  payload: object,
): Promise<void> {
  if (!webhookUrl) return;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Vpsmon-Secret'] = secret;
  try {
    const res = await fetch(webhookUrl, { method: 'POST', headers, body });
    if (!res.ok) console.error('[alert] generic webhook failed:', res.status);
  } catch (e) {
    console.error('[alert] generic webhook error:', e);
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function dispatchAlerts(
  db: Db,
  teamId: string,
  snap: HeartbeatSnapshot,
  appUrl: string,
): Promise<void> {
  const [settingsRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);

  if (!settingsRow) return;

  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.teamId, teamId),
        eq(alertRules.enabled, true),
        eq(alertRules.resource, 'agent'),
      ),
    );

  const now = new Date();

  for (const rule of rules) {
    // resourceId = null means applies to all agents in team
    if (rule.resourceId && rule.resourceId !== snap.agentId) continue;

    const value = extractMetric(snap, rule.metric);
    if (value === null) continue;

    if (!evaluate(value, rule.operator, rule.threshold)) continue;

    // cooldown check
    if (rule.lastFiredAt) {
      const elapsed = now.getTime() - rule.lastFiredAt.getTime();
      if (elapsed < rule.cooldownS * 1000) continue;
    }

    // stamp before dispatching to prevent duplicate storms on slow channels
    await db
      .update(alertRules)
      .set({ lastFiredAt: now, updatedAt: now })
      .where(eq(alertRules.id, rule.id));

    const plainText = buildAlertText(snap, rule.name, rule.metric, value, rule.threshold, rule.operator, appUrl);
    const htmlText  = buildHtmlAlertText(snap, rule.name, rule.metric, value, rule.threshold, rule.operator, appUrl);
    const emailSubject = `[VPS Monitor] ${rule.name} — ${(snap.label?.trim() || snap.hostname || snap.agentId).slice(0, 80)}`;

    const channels = rule.channels ?? ['telegram'];

    await Promise.allSettled(
      channels.map((ch) => {
        switch (ch) {
          case 'telegram': return dispatchTelegram(settingsRow, htmlText);
          case 'email':    return dispatchEmail(settingsRow, emailSubject, plainText);
          case 'slack':    return dispatchSlack(settingsRow.slackWebhookUrl, plainText);
          case 'discord':  return dispatchDiscord(settingsRow.discordWebhookUrl, plainText);
          case 'webhook':  return dispatchWebhook(settingsRow.webhookUrl, settingsRow.webhookSecret, {
            rule: rule.name,
            agentId: snap.agentId,
            metric: rule.metric,
            value,
            threshold: rule.threshold,
            operator: rule.operator,
            firedAt: now.toISOString(),
          });
          default: return Promise.resolve();
        }
      }),
    );
  }
}
