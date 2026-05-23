import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agents, metrics } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { agentId: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db   = getDb();
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.agentId, params.agentId), eq(agents.teamId, session.teamId)))
    .limit(1);
  const agent = rows[0];
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const latest = await db
    .select()
    .from(metrics)
    .where(eq(metrics.agentId, params.agentId))
    .orderBy(desc(metrics.time))
    .limit(1);

  const offlineMs = env.AGENT_OFFLINE_AFTER_SECONDS * 1000;
  const online    = agent.lastSeenAt ? Date.now() - agent.lastSeenAt.getTime() <= offlineMs : false;

  return NextResponse.json({
    agent: {
      agentId:          agent.agentId,
      hostname:         agent.hostname,
      label:            agent.label,
      os:               agent.os,
      osVersion:        agent.osVersion,
      kernel:           agent.kernel,
      arch:             agent.arch,
      cpuModel:         agent.cpuModel,
      cpuCores:         agent.cpuCores,
      totalMemoryBytes: agent.totalMemoryBytes,
      totalDiskBytes:   agent.totalDiskBytes,
      publicIp:         agent.publicIp,
      privateIp:        agent.privateIp,
      tags:             agent.tags,
      online,
      lastSeenAt:       agent.lastSeenAt,
      registeredAt:     agent.registeredAt,
      latest: latest[0]
        ? {
            ...latest[0],
            extraDisks: latest[0].extraDisks
              ? (JSON.parse(latest[0].extraDisks) as Array<{ mount: string; usedBytes: number; totalBytes: number }>)
              : [],
          }
        : null,
    },
  });
}

const patchSchema = z.object({
  label: z.string().max(64).optional(),
  tags:  z.array(z.string().max(32)).max(20).optional(),
});

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body   = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const db = getDb();
  const result = await db
    .update(agents)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(agents.agentId, params.agentId), eq(agents.teamId, session.teamId)))
    .returning({ agentId: agents.agentId });

  if (result.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  // verify ownership before deleting
  const owned = await db
    .select({ agentId: agents.agentId })
    .from(agents)
    .where(and(eq(agents.agentId, params.agentId), eq(agents.teamId, session.teamId)))
    .limit(1);
  if (!owned[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(metrics).where(eq(metrics.agentId, params.agentId));
  await db.delete(agents).where(eq(agents.agentId, params.agentId));

  return NextResponse.json({ ok: true });
}
