import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __pgClient: postgres.Sql | undefined;
}

function getClient(): postgres.Sql {
  if (!global.__pgClient) {
    global.__pgClient = postgres(env.DATABASE_URL, { max: 10 });
  }
  return global.__pgClient;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export type Db = ReturnType<typeof getDb>;
