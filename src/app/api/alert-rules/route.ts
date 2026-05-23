import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { alertRules } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const rules = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.teamId, session.teamId))
    .orderBy(alertRules.createdAt);

  return NextResponse.json({ rules });
}

const createSchema = z.object({
  name:       z.string().min(1).max(128),
  resource:   z.enum(['agent', 'container', 'database', 'uptime']).default('agent'),
  resourceId: z.string().max(128).optional().nullable(),
  metric:     z.enum(['cpu_percent', 'mem_percent', 'disk_percent', 'mem_used', 'disk_used']),
  operator:   z.enum(['gt', 'lt', 'eq']).default('gt'),
  threshold:  z.number().min(0).max(100),
  durationS:  z.number().int().min(0).max(3600).default(0),
  channels:   z.array(z.enum(['telegram', 'slack', 'discord', 'webhook'])).min(1).default(['telegram']),
  cooldownS:  z.number().int().min(60).max(86400).default(300),
  enabled:    z.boolean().default(true),
});

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body   = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const [rule] = await db.insert(alertRules).values({
    teamId:     session.teamId,
    ...parsed.data,
  }).returning();

  return NextResponse.json({ rule }, { status: 201 });
}
