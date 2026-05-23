import { redirect } from 'next/navigation';
import { getDb } from './db';
import { users } from './schema';

export async function querySetupComplete(): Promise<boolean> {
  const db   = getDb();
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}

export async function isSetupComplete(): Promise<boolean> {
  try {
    return await querySetupComplete();
  } catch (err) {
    console.error('[isSetupComplete] database error:', err);
    redirect('/service-unavailable');
  }
}
