import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, teamMembers } from '@/lib/schema';
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
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
    .from(users)
    .where(eq(users.username, parsed.data.username.toLowerCase()))
    .limit(1);

  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const membership = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  if (!membership[0]) {
    return NextResponse.json({ error: 'No team assigned to this user' }, { status: 403 });
  }

  const token = await signSession({
    sub:      user.id,
    username: user.username,
    teamId:   membership[0].teamId,
    role:     membership[0].role,
  });
  await setSessionCookie(token);

  return NextResponse.json({ ok: true, username: user.username });
}
