import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agents, containers, containerMetrics } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Stats schema (sent every interval) ──────────────────────────────────────

const containerStatsSchema = z.object({
  containerId:     z.string().min(1),
  name:            z.string().min(1),
  image:           z.string().min(1),
  status:          z.string().min(1),
  cpuPercent:      z.number().min(0).default(0),
  memUsedBytes:    z.number().min(0).default(0),
  memLimitBytes:   z.number().min(0).default(0),
  netRxBytes:      z.number().min(0).default(0),
  netTxBytes:      z.number().min(0).default(0),
  blockReadBytes:  z.number().min(0).default(0),
  blockWriteBytes: z.number().min(0).default(0),
  restartCount:    z.number().int().min(0).default(0),
});

// ─── Details schema (sent only when static config changes) ───────────────────

const portSchema = z.object({
  hostIp:        z.string().default(''),
  hostPort:      z.string().default(''),
  containerPort: z.string(),
  protocol:      z.string().default('tcp'),
});

const volumeSchema = z.object({
  source:      z.string(),
  destination: z.string(),
  mode:        z.string().default(''),
});

const networkSchema = z.object({
  name:      z.string(),
  ipAddress: z.string().default(''),
});

const containerDetailSchema = z.object({
  containerId:   z.string().min(1),
  name:          z.string().min(1),
  image:         z.string().min(1),
  imageId:       z.string().default(''),
  command:       z.string().default(''),
  createdAt:     z.string().optional(),          // ISO timestamp from Docker
  restartPolicy: z.string().default(''),
  networkMode:   z.string().default(''),
  ports:         z.array(portSchema).default([]),
  volumes:       z.array(volumeSchema).default([]),
  envVars:       z.array(z.string()).default([]),
  labels:        z.record(z.string()).default({}),
  networks:      z.array(networkSchema).default([]),
  configHash:    z.string().min(1),              // computed by agent, sha256 of static fields
});

const schema = z.object({
  agentId:    z.string().min(1),
  token:      z.string().min(1),
  containers: z.array(containerStatsSchema).max(500),
  details:    z.array(containerDetailSchema).max(500).optional(),
});

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const db   = getDb();
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

  // ── Upsert static container details (only sent when hash changes) ────────────
  if (parsed.data.details && parsed.data.details.length > 0) {
    for (const d of parsed.data.details) {
      await db
        .insert(containers)
        .values({
          containerId:   d.containerId,
          agentId:       agent.agentId,
          name:          d.name,
          image:         d.image,
          imageId:       d.imageId,
          command:       d.command,
          createdAt:     d.createdAt ? new Date(d.createdAt) : null,
          restartPolicy: d.restartPolicy,
          networkMode:   d.networkMode,
          ports:         JSON.stringify(d.ports),
          volumes:       JSON.stringify(d.volumes),
          envVars:       JSON.stringify(d.envVars),
          labels:        JSON.stringify(d.labels),
          networks:      JSON.stringify(d.networks),
          configHash:    d.configHash,
          firstSeenAt:   now,
          updatedAt:     now,
        })
        .onConflictDoUpdate({
          target: [containers.containerId, containers.agentId],
          set: {
            name:          d.name,
            image:         d.image,
            imageId:       d.imageId,
            command:       d.command,
            createdAt:     d.createdAt ? new Date(d.createdAt) : null,
            restartPolicy: d.restartPolicy,
            networkMode:   d.networkMode,
            ports:         JSON.stringify(d.ports),
            volumes:       JSON.stringify(d.volumes),
            envVars:       JSON.stringify(d.envVars),
            labels:        JSON.stringify(d.labels),
            networks:      JSON.stringify(d.networks),
            configHash:    d.configHash,
            updatedAt:     now,
          },
        });
    }
  }

  // ── Insert time-series stats ──────────────────────────────────────────────────
  if (parsed.data.containers.length > 0) {
    await db.insert(containerMetrics).values(
      parsed.data.containers.map((c) => ({
        time:            now,
        agentId:         agent.agentId,
        containerId:     c.containerId,
        name:            c.name,
        image:           c.image,
        status:          c.status,
        cpuPercent:      c.cpuPercent,
        memUsedBytes:    c.memUsedBytes,
        memLimitBytes:   c.memLimitBytes,
        netRxBytes:      c.netRxBytes,
        netTxBytes:      c.netTxBytes,
        blockReadBytes:  c.blockReadBytes,
        blockWriteBytes: c.blockWriteBytes,
        restartCount:    c.restartCount,
      }))
    );
  }

  return NextResponse.json({ ok: true, stored: parsed.data.containers.length });
}
