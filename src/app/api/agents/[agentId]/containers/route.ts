import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agents, containers, containerMetrics } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { agentId: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  const owned = await db
    .select({ agentId: agents.agentId })
    .from(agents)
    .where(and(eq(agents.agentId, params.agentId), eq(agents.teamId, session.teamId)))
    .limit(1);
  if (!owned[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const cutoff = new Date(Date.now() - 5 * 60 * 1000);

  // Latest stats row per container (last 5 min)
  const statsRows = await db
    .selectDistinctOn([containerMetrics.containerId], {
      containerId:     containerMetrics.containerId,
      name:            containerMetrics.name,
      image:           containerMetrics.image,
      status:          containerMetrics.status,
      cpuPercent:      containerMetrics.cpuPercent,
      memUsedBytes:    containerMetrics.memUsedBytes,
      memLimitBytes:   containerMetrics.memLimitBytes,
      netRxBytes:      containerMetrics.netRxBytes,
      netTxBytes:      containerMetrics.netTxBytes,
      blockReadBytes:  containerMetrics.blockReadBytes,
      blockWriteBytes: containerMetrics.blockWriteBytes,
      restartCount:    containerMetrics.restartCount,
      time:            containerMetrics.time,
    })
    .from(containerMetrics)
    .where(
      and(
        eq(containerMetrics.agentId, params.agentId),
        sql`${containerMetrics.time} >= ${cutoff}`
      )
    )
    .orderBy(containerMetrics.containerId, desc(containerMetrics.time));

  if (statsRows.length === 0) {
    return NextResponse.json({ containers: [] });
  }

  // Fetch config details for those container IDs
  const containerIds = statsRows.map((r) => r.containerId);
  const detailRows = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.agentId, params.agentId),
        sql`${containers.containerId} = ANY(${sql.raw(`ARRAY[${containerIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`)})`,
      )
    );

  const detailMap = new Map(detailRows.map((d) => [d.containerId, d]));

  const result = statsRows.map((s) => {
    const d = detailMap.get(s.containerId);
    return {
      ...s,
      // Static config — null if never sent (older agents)
      command:       d?.command ?? null,
      imageId:       d?.imageId ?? null,
      createdAt:     d?.createdAt ?? null,
      restartPolicy: d?.restartPolicy ?? null,
      networkMode:   d?.networkMode ?? null,
      ports:         d ? (JSON.parse(d.ports) as unknown[]) : null,
      volumes:       d ? (JSON.parse(d.volumes) as unknown[]) : null,
      envVars:       d ? (JSON.parse(d.envVars) as string[]) : null,
      labels:        d ? (JSON.parse(d.labels) as Record<string, string>) : null,
      networks:      d ? (JSON.parse(d.networks) as unknown[]) : null,
      firstSeenAt:   d?.firstSeenAt ?? null,
    };
  });

  return NextResponse.json({ containers: result });
}
