import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/schema';
import { getSessionFromCookies, hashPassword, verifyPassword } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body   = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db   = getDb();
  const rows = await db.select().from(users).where(eq(users.id, session.sub)).limit(1);
  const user = rows[0];
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const ok = await verifyPassword(parsed.data.oldPassword, user.passwordHash);
  if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
    .where(eq(users.id, session.sub));

  return NextResponse.json({ ok: true });
}
