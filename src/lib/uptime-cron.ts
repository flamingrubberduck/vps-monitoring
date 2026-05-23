/**
 * In-process uptime monitor scheduler.
 * Runs due checks every 30 seconds by scanning for monitors whose next
 * check time has passed. Each check fires dispatchUptimeAlert() directly
 * (no HTTP round-trip needed — we're in the same process).
 */

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import { appSettings, uptimeMonitors } from './schema';
import { env } from './env';
import { dispatchUptimeAlert } from './uptime-checker';

const POLL_INTERVAL_MS = 30_000;

export function startUptimeCron() {
  // Delay first tick so DB is ready after migrations settle
  setTimeout(tick, 5_000);
  console.log('[uptime-cron] started, polling every 30s');
}

async function tick() {
  try {
    await runDueChecks();
  } catch (e) {
    console.error('[uptime-cron] tick error:', e);
  } finally {
    setTimeout(tick, POLL_INTERVAL_MS);
  }
}

async function runDueChecks() {
  const db = getDb();

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

  if (due.length === 0) return;

  const [settingsRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);

  await Promise.allSettled(
    due.map((monitor) =>
      dispatchUptimeAlert(db, monitor, settingsRow ?? null, env.APP_URL),
    ),
  );
}
