import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getAppSettings } from '@/lib/app-settings';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const settings = await getAppSettings();
  const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom, smtpTo } = settings;

  if (!smtpHost || !smtpTo || !smtpFrom) {
    return NextResponse.json(
      { error: 'SMTP not configured. Fill in host, from, and to fields first.' },
      { status: 400 },
    );
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort || 587,
      secure: (smtpPort || 587) === 465,
      auth: smtpUser ? { user: smtpUser, pass: smtpPassword } : undefined,
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: smtpTo,
      subject: '[VPS Monitor] Test alert email',
      text: 'This is a test alert from VPS Monitor. If you received this, email alerts are configured correctly.',
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[settings/alerts/test-email]', e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
