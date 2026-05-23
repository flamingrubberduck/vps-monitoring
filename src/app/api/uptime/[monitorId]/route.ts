import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { uptimeEvents, uptimeMonitors } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext { params: { monitorId: string } }

const patchSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  url:       z.string().url().max(2048).optional(),
  intervalS: z.number().int().min(30).max(3600).optional(),
  timeoutS:  z.number().int().min(3).max(30).optional(),
  enabled:   z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body   = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db = getDb();
  const result = await db
    .update(uptimeMonitors)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(uptimeMonitors.id, params.monitorId), eq(uptimeMonitors.teamId, session.teamId)))
    .returning({ id: uptimeMonitors.id });

  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDb();
  const owned = await db
    .select({ id: uptimeMonitors.id })
    .from(uptimeMonitors)
    .where(and(eq(uptimeMonitors.id, params.monitorId), eq(uptimeMonitors.teamId, session.teamId)))
    .limit(1);
  if (!owned[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(uptimeEvents).where(eq(uptimeEvents.monitorId, params.monitorId));
  await db.delete(uptimeMonitors).where(eq(uptimeMonitors.id, params.monitorId));
  return NextResponse.json({ ok: true });
}
