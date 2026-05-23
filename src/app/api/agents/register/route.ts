import { NextResponse } from 'next/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agents } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  agentId:          z.string().min(8).max(64).optional(),
  hostname:         z.string().max(255).default('unknown'),
  os:               z.string().max(64).default('unknown'),
  osVersion:        z.string().max(128).default(''),
  kernel:           z.string().max(128).default(''),
  arch:             z.string().max(32).default(''),
  cpuModel:         z.string().max(255).default(''),
  cpuCores:         z.number().int().min(0).max(4096).default(0),
  totalMemoryBytes: z.number().min(0).default(0),
  totalDiskBytes:   z.number().min(0).default(0),
  publicIp:         z.string().max(64).optional(),
  privateIp:        z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body   = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();
  const d  = parsed.data;

  if (d.agentId) {
    const existing = await db
      .select()
      .from(agents)
      .where(and(eq(agents.agentId, d.agentId), eq(agents.teamId, session.teamId)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(agents).set({
        hostname:         d.hostname,
        os:               d.os,
        osVersion:        d.osVersion,
        kernel:           d.kernel,
        arch:             d.arch,
        cpuModel:         d.cpuModel,
        cpuCores:         d.cpuCores,
        totalMemoryBytes: d.totalMemoryBytes,
        totalDiskBytes:   d.totalDiskBytes,
        publicIp:         d.publicIp,
        privateIp:        d.privateIp,
        updatedAt:        new Date(),
      }).where(eq(agents.agentId, d.agentId));

      return NextResponse.json({
        ok: true,
        agentId: existing[0].agentId,
        token:   existing[0].token,
        reused:  true,
      });
    }
  }

  const agentId = d.agentId ?? `vps_${nanoid(16)}`;
  const token   = `tok_${nanoid(40)}`;
  const now     = new Date();

  await db.insert(agents).values({
    agentId,
    teamId:           session.teamId,
    token,
    hostname:         d.hostname,
    os:               d.os,
    osVersion:        d.osVersion,
    kernel:           d.kernel,
    arch:             d.arch,
    cpuModel:         d.cpuModel,
    cpuCores:         d.cpuCores,
    totalMemoryBytes: d.totalMemoryBytes,
    totalDiskBytes:   d.totalDiskBytes,
    publicIp:         d.publicIp,
    privateIp:        d.privateIp,
    registeredAt:     now,
  });

  return NextResponse.json({ ok: true, agentId, token, reused: false });
}
