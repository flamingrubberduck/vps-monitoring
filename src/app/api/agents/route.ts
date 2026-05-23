import { NextResponse } from 'next/server';
import { eq, inArray, desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agents, metrics } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db   = getDb();
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.teamId, session.teamId))
    .orderBy(agents.hostname, agents.agentId);
  const ids  = rows.map((a) => a.agentId);

  // latest metric per agent using TimescaleDB's last() aggregate
  const latestRows = ids.length > 0
    ? await db.execute(sql`
        SELECT DISTINCT ON (agent_id)
          agent_id, time, cpu_percent, mem_used_bytes, mem_total_bytes,
          disk_used_bytes, disk_total_bytes, net_rx_bytes, net_tx_bytes,
          net_rx_bps, net_tx_bps, uptime_seconds, load_avg1
        FROM metrics
        WHERE agent_id = ANY(${ids})
        ORDER BY agent_id, time DESC
      `)
    : [];

  const latestMap = new Map<string, Record<string, unknown>>();
  for (const row of latestRows) {
    latestMap.set(row.agent_id as string, row as Record<string, unknown>);
  }

  const offlineMs = env.AGENT_OFFLINE_AFTER_SECONDS * 1000;
  const now       = Date.now();

  const data = rows.map((a) => {
    const m      = latestMap.get(a.agentId);
    const online = a.lastSeenAt ? now - a.lastSeenAt.getTime() <= offlineMs : false;
    return {
      agentId:          a.agentId,
      hostname:         a.hostname,
      label:            a.label,
      os:               a.os,
      osVersion:        a.osVersion,
      kernel:           a.kernel,
      arch:             a.arch,
      cpuModel:         a.cpuModel,
      cpuCores:         a.cpuCores,
      totalMemoryBytes: a.totalMemoryBytes,
      totalDiskBytes:   a.totalDiskBytes,
      publicIp:         a.publicIp,
      privateIp:        a.privateIp,
      tags:             a.tags,
      online,
      lastSeenAt:       a.lastSeenAt,
      registeredAt:     a.registeredAt,
      latest: m ? {
        ts:            m.time,
        cpuPercent:    m.cpu_percent,
        memUsedBytes:  m.mem_used_bytes,
        memTotalBytes: m.mem_total_bytes,
        diskUsedBytes: m.disk_used_bytes,
        diskTotalBytes:m.disk_total_bytes,
        netRxBytes:    m.net_rx_bytes,
        netTxBytes:    m.net_tx_bytes,
        netRxBps:      m.net_rx_bps,
        netTxBps:      m.net_tx_bps,
        uptimeSeconds: m.uptime_seconds,
        loadAvg1:      m.load_avg1,
      } : null,
    };
  });

  return NextResponse.json({ agents: data });
}
