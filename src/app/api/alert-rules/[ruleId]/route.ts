import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { alertRules } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { ruleId: string };
}

const patchSchema = z.object({
  name:       z.string().min(1).max(128).optional(),
  resourceId: z.string().max(128).optional().nullable(),
  metric:     z.enum(['cpu_percent', 'mem_percent', 'disk_percent', 'mem_used', 'disk_used']).optional(),
  operator:   z.enum(['gt', 'lt', 'eq']).optional(),
  threshold:  z.number().min(0).max(100).optional(),
  durationS:  z.number().int().min(0).max(3600).optional(),
  channels:   z.array(z.enum(['telegram', 'slack', 'discord', 'webhook'])).min(1).optional(),
  cooldownS:  z.number().int().min(60).max(86400).optional(),
  enabled:    z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body   = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const result = await db
    .update(alertRules)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(alertRules.id, params.ruleId), eq(alertRules.teamId, session.teamId)))
    .returning({ id: alertRules.id });

  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDb();
  const result = await db
    .delete(alertRules)
    .where(and(eq(alertRules.id, params.ruleId), eq(alertRules.teamId, session.teamId)))
    .returning({ id: alertRules.id });

  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
