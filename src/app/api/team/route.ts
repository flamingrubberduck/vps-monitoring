import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { teams } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/team — get current team info
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select()
    .from(teams)
    .where(eq(teams.id, session.teamId))
    .limit(1);

  if (!rows[0]) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  return NextResponse.json({ team: { id: rows[0].id, name: rows[0].name } });
}

const patchSchema = z.object({
  name: z.string().min(1).max(64),
});

// PATCH /api/team — rename team (owner only)
export async function PATCH(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can rename the team' }, { status: 403 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(teams)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(teams.id, session.teamId));

  return NextResponse.json({ ok: true });
}
