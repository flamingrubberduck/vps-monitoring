import { NextResponse } from 'next/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { uptimeEvents, uptimeMonitors } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext { params: { monitorId: string } }

const RANGES: Record<string, number> = {
  '1h':  1,
  '6h':  6,
  '24h': 24,
  '7d':  24 * 7,
};

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  // Verify ownership via team
  const owned = await db
    .select({ id: uptimeMonitors.id })
    .from(uptimeMonitors)
    .where(and(eq(uptimeMonitors.id, params.monitorId), eq(uptimeMonitors.teamId, session.teamId)))
    .limit(1);
  if (!owned[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const rangeKey = url.searchParams.get('range') ?? '24h';
  const hours = RANGES[rangeKey] ?? 24;
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const events = await db
    .select()
    .from(uptimeEvents)
    .where(and(eq(uptimeEvents.monitorId, params.monitorId), gte(uptimeEvents.time, since)))
    .orderBy(desc(uptimeEvents.time))
    .limit(500);

  // Uptime % for the window
  const total = events.length;
  const upCount = events.filter((e) => e.status === 'up').length;
  const uptimePct = total > 0 ? (upCount / total) * 100 : null;

  return NextResponse.json({ events, uptimePct, total });
}
