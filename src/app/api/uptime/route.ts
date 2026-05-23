import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { uptimeMonitors } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const monitors = await db
    .select()
    .from(uptimeMonitors)
    .where(eq(uptimeMonitors.teamId, session.teamId))
    .orderBy(desc(uptimeMonitors.createdAt));

  return NextResponse.json({ monitors });
}

const createSchema = z.object({
  name:      z.string().min(1).max(100),
  url:       z.string().url().max(2048),
  intervalS: z.number().int().min(30).max(3600).default(60),
  timeoutS:  z.number().int().min(3).max(30).default(10),
  enabled:   z.boolean().default(true),
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
  const [monitor] = await db
    .insert(uptimeMonitors)
    .values({ ...parsed.data, teamId: session.teamId })
    .returning();

  return NextResponse.json({ monitor }, { status: 201 });
}
