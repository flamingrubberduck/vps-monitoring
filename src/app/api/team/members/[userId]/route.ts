import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { teamMembers } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { userId: string };
}

const patchSchema = z.object({
  role: z.enum(['admin', 'viewer']),
});

// PATCH /api/team/members/[userId] — change role (owner/admin only, cannot change owner)
export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const db = getDb();

  const target = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, session.teamId), eq(teamMembers.userId, params.userId)))
    .limit(1);

  if (!target[0]) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (target[0].role === 'owner') {
    return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 });
  }

  await db
    .update(teamMembers)
    .set({ role: parsed.data.role })
    .where(and(eq(teamMembers.teamId, session.teamId), eq(teamMembers.userId, params.userId)));

  return NextResponse.json({ ok: true });
}

// DELETE /api/team/members/[userId] — remove member (owner/admin only, cannot remove owner)
export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (params.userId === session.sub) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
  }

  const db = getDb();

  const target = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, session.teamId), eq(teamMembers.userId, params.userId)))
    .limit(1);

  if (!target[0]) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (target[0].role === 'owner') {
    return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 });
  }

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, session.teamId), eq(teamMembers.userId, params.userId)));

  return NextResponse.json({ ok: true });
}
