import { NextResponse } from 'next/server';
import { and, eq, gte, asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agents, metrics } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { agentId: string };
}

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url   = new URL(req.url);
  const range = url.searchParams.get('range') ?? '1h';

  const now   = Date.now();
  const rangeMap: Record<string, number> = {
    '1h':  60 * 60 * 1000,
    '6h':  6  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d':  7  * 24 * 60 * 60 * 1000,
  };
  const fromMs = now - (rangeMap[range] ?? rangeMap['1h']);

  const db = getDb();

  // verify the agent belongs to this team before streaming its metrics
  const owned = await db
    .select({ agentId: agents.agentId })
    .from(agents)
    .where(and(eq(agents.agentId, params.agentId), eq(agents.teamId, session.teamId)))
    .limit(1);
  if (!owned[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select({
      ts:            metrics.time,
      cpuPercent:    metrics.cpuPercent,
      memUsedBytes:  metrics.memUsedBytes,
      memTotalBytes: metrics.memTotalBytes,
      diskUsedBytes: metrics.diskUsedBytes,
      diskTotalBytes:metrics.diskTotalBytes,
      netRxBps:      metrics.netRxBps,
      netTxBps:      metrics.netTxBps,
      loadAvg1:      metrics.loadAvg1,
      loadAvg5:      metrics.loadAvg5,
      loadAvg15:     metrics.loadAvg15,
    })
    .from(metrics)
    .where(and(eq(metrics.agentId, params.agentId), gte(metrics.time, new Date(fromMs))))
    .orderBy(asc(metrics.time))
    .limit(2000);

  return NextResponse.json({ metrics: rows });
}
