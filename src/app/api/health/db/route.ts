import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db   = getDb();
    const rows = await db.execute(sql`SELECT current_database() AS db, version() AS ver`);
    const row  = rows[0] as { db: string; ver: string };
    return NextResponse.json({ ok: true, database: row.db, version: row.ver });
  } catch (err) {
    const e   = err as { message?: string };
    const msg = String(e.message ?? 'unknown error').slice(0, 800);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
