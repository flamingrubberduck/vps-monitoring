import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { appSettings } from './schema';
import {
  sanitizeTelegramBotToken,
  sanitizeTelegramChatId,
  telegramGetMe,
  TelegramTokenRejectedError,
} from './telegram-client';

export type ResolvedAppSettings = {
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string | undefined;
  smtpFrom: string;
  smtpTo: string;
  slackWebhookUrl: string | undefined;
  discordWebhookUrl: string | undefined;
  webhookUrl: string | undefined;
  webhookSecret: string | undefined;
  alertCpuPercent: number;
  alertRamPercent: number;
  alertDiskPercent: number;
  telegramCooldownSeconds: number;
};

export type PublicAlertSettings = {
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
  // Slack
  slackConfigured: boolean;
  slackWebhookUrl: string;
  // Discord
  discordConfigured: boolean;
  discordWebhookUrl: string;
  // Generic webhook
  webhookConfigured: boolean;
  webhookUrl: string;
  // Legacy thresholds
  alertCpuPercent: number;
  alertRamPercent: number;
  alertDiskPercent: number;
  telegramCooldownSeconds: number;
};

const CACHE_TTL_MS = 5000;
let cache: { expiresAt: number; value: ResolvedAppSettings } | null = null;

function toResolved(row: typeof appSettings.$inferSelect): ResolvedAppSettings {
  const token = row.telegramBotToken ? sanitizeTelegramBotToken(row.telegramBotToken) : '';
  const chat  = row.telegramChatId   ? sanitizeTelegramChatId(row.telegramChatId)     : '';
  return {
    telegramBotToken:        token || undefined,
    telegramChatId:          chat  || undefined,
    smtpHost:                row.smtpHost,
    smtpPort:                row.smtpPort,
    smtpUser:                row.smtpUser,
    smtpPassword:            row.smtpPassword || undefined,
    smtpFrom:                row.smtpFrom,
    smtpTo:                  row.smtpTo,
    slackWebhookUrl:         row.slackWebhookUrl || undefined,
    discordWebhookUrl:       row.discordWebhookUrl || undefined,
    webhookUrl:              row.webhookUrl || undefined,
    webhookSecret:           row.webhookSecret || undefined,
    alertCpuPercent:         row.alertCpuPercent,
    alertRamPercent:         row.alertRamPercent,
    alertDiskPercent:        row.alertDiskPercent,
    telegramCooldownSeconds: row.telegramCooldownSeconds,
  };
}

async function loadRow() {
  const db = getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (rows.length > 0) return rows[0];
  const inserted = await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing().returning();
  if (inserted.length > 0) return inserted[0];
  // race: another request inserted it first
  return (await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1))[0];
}

export function invalidateAppSettingsCache(): void {
  cache = null;
}

export async function getAppSettings(): Promise<ResolvedAppSettings> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.value;
  const row   = await loadRow();
  const value = toResolved(row);
  cache = { expiresAt: now + CACHE_TTL_MS, value };
  return value;
}

export async function getPublicAlertSettings(): Promise<PublicAlertSettings> {
  const row = await loadRow();
  const r   = toResolved(row);
  return {
    botTokenConfigured:      Boolean(r.telegramBotToken),
    telegramChatId:          r.telegramChatId ?? '',
    smtpConfigured:          Boolean(r.smtpHost && r.smtpUser && r.smtpTo),
    smtpHost:                r.smtpHost,
    smtpPort:                r.smtpPort,
    smtpUser:                r.smtpUser,
    smtpFrom:                r.smtpFrom,
    smtpTo:                  r.smtpTo,
    slackConfigured:         Boolean(r.slackWebhookUrl),
    slackWebhookUrl:         r.slackWebhookUrl ?? '',
    discordConfigured:       Boolean(r.discordWebhookUrl),
    discordWebhookUrl:       r.discordWebhookUrl ?? '',
    webhookConfigured:       Boolean(r.webhookUrl),
    webhookUrl:              r.webhookUrl ?? '',
    alertCpuPercent:         r.alertCpuPercent,
    alertRamPercent:         r.alertRamPercent,
    alertDiskPercent:        r.alertDiskPercent,
    telegramCooldownSeconds: r.telegramCooldownSeconds,
  };
}

export type UpdateAppSettingsInput = {
  // Telegram
  telegramBotToken?: string;
  clearTelegramBotToken?: boolean;
  telegramChatId?: string;
  // Email
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  smtpTo?: string;
  // Slack
  slackWebhookUrl?: string;
  // Discord
  discordWebhookUrl?: string;
  // Generic webhook
  webhookUrl?: string;
  webhookSecret?: string;
  // Legacy thresholds
  alertCpuPercent?: number;
  alertRamPercent?: number;
  alertDiskPercent?: number;
  telegramCooldownSeconds?: number;
};

export async function updateAppSettings(input: UpdateAppSettingsInput): Promise<PublicAlertSettings> {
  const db  = getDb();
  const row = await loadRow();
  const patch: Partial<typeof appSettings.$inferInsert> = {
    updatedAt: new Date(),
  };

  const newToken = input.telegramBotToken?.trim();
  if (newToken) {
    const clean = sanitizeTelegramBotToken(newToken);
    if (!clean.includes(':')) {
      throw new TelegramTokenRejectedError(
        'Token bot không đúng định dạng (cần dạng 123456789:AAH… từ @BotFather).'
      );
    }
    const me = await telegramGetMe(clean);
    if (!me.ok) throw new TelegramTokenRejectedError(me.description);
    patch.telegramBotToken = clean;
  } else if (input.clearTelegramBotToken) {
    patch.telegramBotToken = '';
  }

  if (input.telegramChatId !== undefined) {
    patch.telegramChatId = sanitizeTelegramChatId(input.telegramChatId);
  }
  if (input.smtpHost       !== undefined) patch.smtpHost     = input.smtpHost.trim().slice(0, 253);
  if (input.smtpPort       !== undefined) patch.smtpPort     = Math.max(1, Math.min(65535, Math.round(input.smtpPort)));
  if (input.smtpUser       !== undefined) patch.smtpUser     = input.smtpUser.trim().slice(0, 253);
  if (input.smtpPassword   !== undefined) patch.smtpPassword = input.smtpPassword.slice(0, 512);
  if (input.smtpFrom       !== undefined) patch.smtpFrom     = input.smtpFrom.trim().slice(0, 253);
  if (input.smtpTo         !== undefined) patch.smtpTo       = input.smtpTo.trim().slice(0, 253);
  if (input.slackWebhookUrl   !== undefined) patch.slackWebhookUrl   = input.slackWebhookUrl.trim().slice(0, 512);
  if (input.discordWebhookUrl !== undefined) patch.discordWebhookUrl = input.discordWebhookUrl.trim().slice(0, 512);
  if (input.webhookUrl        !== undefined) patch.webhookUrl        = input.webhookUrl.trim().slice(0, 512);
  if (input.webhookSecret     !== undefined) patch.webhookSecret     = input.webhookSecret.trim().slice(0, 256);
  if (input.alertCpuPercent !== undefined) {
    patch.alertCpuPercent = Math.max(1, Math.min(100, Math.round(input.alertCpuPercent)));
  }
  if (input.alertRamPercent !== undefined) {
    patch.alertRamPercent = Math.max(1, Math.min(100, Math.round(input.alertRamPercent)));
  }
  if (input.alertDiskPercent !== undefined) {
    patch.alertDiskPercent = Math.max(1, Math.min(100, Math.round(input.alertDiskPercent)));
  }
  if (input.telegramCooldownSeconds !== undefined) {
    patch.telegramCooldownSeconds = Math.max(60, Math.min(86_400, Math.round(input.telegramCooldownSeconds)));
  }

  await db.update(appSettings).set(patch).where(eq(appSettings.id, row.id));
  invalidateAppSettingsCache();
  return getPublicAlertSettings();
}
