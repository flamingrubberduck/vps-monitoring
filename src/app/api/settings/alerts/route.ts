import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getPublicAlertSettings,
  updateAppSettings,
} from '@/lib/app-settings';
import { getSessionFromCookies } from '@/lib/auth';
import { TelegramTokenRejectedError } from '@/lib/telegram-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  // Telegram
  telegramBotToken:     z.string().max(512).optional(),
  clearTelegramBotToken:z.boolean().optional(),
  telegramChatId:       z.string().max(64).optional(),
  // Email
  smtpHost:     z.string().max(253).optional(),
  smtpPort:     z.number().int().min(1).max(65535).optional(),
  smtpUser:     z.string().max(253).optional(),
  smtpPassword: z.string().max(512).optional(),
  smtpFrom:     z.string().max(253).optional(),
  smtpTo:       z.string().max(253).optional(),
  // Slack / Discord / Webhook
  slackWebhookUrl:   z.string().max(512).optional(),
  discordWebhookUrl: z.string().max(512).optional(),
  webhookUrl:        z.string().max(512).optional(),
  webhookSecret:     z.string().max(256).optional(),
  // Legacy thresholds
  alertCpuPercent:        z.number().int().min(1).max(100).optional(),
  alertRamPercent:        z.number().int().min(1).max(100).optional(),
  alertDiskPercent:       z.number().int().min(1).max(100).optional(),
  telegramCooldownSeconds:z.number().int().min(60).max(86_400).optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const settings = await getPublicAlertSettings();
    return NextResponse.json(settings);
  } catch (e) {
    console.error('[settings/alerts GET]', e);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const settings = await updateAppSettings(parsed.data);
    return NextResponse.json(settings);
  } catch (e) {
    if (e instanceof TelegramTokenRejectedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error('[settings/alerts PUT]', e);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
