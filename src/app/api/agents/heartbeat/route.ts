import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { agents, metrics } from '@/lib/schema';
import { dispatchAlerts } from '@/lib/alert-dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const diskEntrySchema = z.object({
  mount:      z.string().min(1).max(256),
  usedBytes:  z.number().min(0),
  totalBytes: z.number().min(0),
});

const schema = z.object({
  agentId:       z.string().min(1),
  token:         z.string().min(1),
  cpuPercent:    z.number().min(0).max(100).default(0),
  loadAvg1:      z.number().min(0).default(0),
  loadAvg5:      z.number().min(0).default(0),
  loadAvg15:     z.number().min(0).default(0),
  memUsedBytes:  z.number().min(0).default(0),
  memTotalBytes: z.number().min(0).default(0),
  swapUsedBytes: z.number().min(0).default(0),
  swapTotalBytes:z.number().min(0).default(0),
  diskUsedBytes: z.number().min(0).default(0),
  diskTotalBytes:z.number().min(0).default(0),
  // Optional array of additional mount points beyond /
  extraDisks:    z.array(diskEntrySchema).max(32).optional(),
  netRxBytes:    z.number().min(0).default(0),
  netTxBytes:    z.number().min(0).default(0),
  netRxBps:      z.number().min(0).default(0),
  netTxBps:      z.number().min(0).default(0),
  uptimeSeconds: z.number().min(0).default(0),
  processCount:  z.number().int().min(0).default(0),
});

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.agentId, parsed.data.agentId))
    .limit(1);

  const agent = rows[0];
  if (!agent || agent.token !== parsed.data.token) {
    return NextResponse.json({ error: 'Unknown agent or invalid token' }, { status: 401 });
  }

  const now = new Date();

  await db
    .update(agents)
    .set({ lastSeenAt: now, updatedAt: now })
    .where(eq(agents.agentId, agent.agentId));

  await db.insert(metrics).values({
    time:          now,
    agentId:       agent.agentId,
    cpuPercent:    parsed.data.cpuPercent,
    loadAvg1:      parsed.data.loadAvg1,
    loadAvg5:      parsed.data.loadAvg5,
    loadAvg15:     parsed.data.loadAvg15,
    memUsedBytes:  parsed.data.memUsedBytes,
    memTotalBytes: parsed.data.memTotalBytes,
    swapUsedBytes: parsed.data.swapUsedBytes,
    swapTotalBytes:parsed.data.swapTotalBytes,
    diskUsedBytes: parsed.data.diskUsedBytes,
    diskTotalBytes:parsed.data.diskTotalBytes,
    extraDisks:    parsed.data.extraDisks ? JSON.stringify(parsed.data.extraDisks) : null,
    netRxBytes:    parsed.data.netRxBytes,
    netTxBytes:    parsed.data.netTxBytes,
    netRxBps:      parsed.data.netRxBps,
    netTxBps:      parsed.data.netTxBps,
    uptimeSeconds: parsed.data.uptimeSeconds,
    processCount:  parsed.data.processCount,
  });

  await dispatchAlerts(db, agent.teamId, {
    agentId:       agent.agentId,
    hostname:      agent.hostname,
    label:         agent.label,
    publicIp:      agent.publicIp,
    cpuPercent:    parsed.data.cpuPercent,
    memUsedBytes:  parsed.data.memUsedBytes,
    memTotalBytes: parsed.data.memTotalBytes,
    diskUsedBytes: parsed.data.diskUsedBytes,
    diskTotalBytes:parsed.data.diskTotalBytes,
  }, env.APP_URL);

  return NextResponse.json({ ok: true });
}
