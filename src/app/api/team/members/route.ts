import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';
import { getSessionFromCookies } from '@/lib/auth';
import { hashPassword } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/team/members — list members of the caller's team
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select({
      userId:   users.id,
      username: users.username,
      role:     teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, session.teamId));

  return NextResponse.json({ members: rows });
}

const inviteSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(128),
  role:     z.enum(['admin', 'viewer']).default('viewer'),
});

// POST /api/team/members — invite (create) a new user into the caller's team
export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, parsed.data.username.toLowerCase()))
    .limit(1);

  if (existing[0]) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const [newUser] = await db.insert(users).values({
    username:     parsed.data.username.toLowerCase(),
    passwordHash,
  }).returning();

  await db.insert(teamMembers).values({
    teamId: session.teamId,
    userId: newUser.id,
    role:   parsed.data.role,
  });

  return NextResponse.json({ ok: true, username: newUser.username, role: parsed.data.role }, { status: 201 });
}
