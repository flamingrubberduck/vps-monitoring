import { NextResponse } from 'next/server';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { appSettings, alertRules, uptimeEvents, uptimeMonitors } from '@/lib/schema';
import { env } from '@/lib/env';
import { dispatchUptimeAlert } from '@/lib/uptime-checker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called by cron (internal secret) or admin manually.
// Runs all due checks in the team context where each monitor lives.
export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db  = getDb();
  const now = new Date();

  // Fetch monitors that are enabled and whose next check time has passed
  const due = await db
    .select()
    .from(uptimeMonitors)
    .where(
      and(
        eq(uptimeMonitors.enabled, true),
        or(
          isNull(uptimeMonitors.lastCheckedAt),
          lte(
            sql`${uptimeMonitors.lastCheckedAt} + (${uptimeMonitors.intervalS} * interval '1 second')`,
            sql`now()`,
          ),
        ),
      ),
    );

  if (due.length === 0) {
    return NextResponse.json({ checked: 0 });
  }

  const [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);

  const results = await Promise.allSettled(
    due.map((monitor) => dispatchUptimeAlert(db, monitor, settingsRow ?? null, env.APP_URL)),
  );

  const checked  = results.filter((r) => r.status === 'fulfilled').length;
  const failures = results.filter((r) => r.status === 'rejected').length;

  return NextResponse.json({ checked, failures });
}
