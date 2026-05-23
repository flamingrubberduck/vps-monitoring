import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: { username: session.username, role: session.role, teamId: session.teamId },
  });
}
