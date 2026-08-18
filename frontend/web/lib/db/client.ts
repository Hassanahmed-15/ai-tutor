import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One pooled Postgres connection for the whole process.
 *
 * Cached on globalThis because Next's dev server re-evaluates modules on every hot reload, and a
 * fresh pool per reload exhausts the server's connection limit within a few edits. Azure's
 * Burstable B1ms tier allows relatively few connections, so this matters in production too, where
 * up to three replicas share that budget.
 *
 * `max: 5` per replica keeps the total well inside that limit while leaving headroom for the
 * occasional long query.
 */
const globalForDb = globalThis as unknown as { ariaDb?: ReturnType<typeof drizzle> };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Authentication requires a Postgres connection.");
  }
  // Azure Postgres requires TLS; `prepare: false` is needed because the connection may pass
  // through a pooler that does not support prepared statements.
  const sql = postgres(url, { ssl: "require", max: 5, prepare: false });
  return drizzle(sql, { schema });
}

export function db() {
  if (!globalForDb.ariaDb) globalForDb.ariaDb = connect();
  return globalForDb.ariaDb;
}

/** True when a database is configured. Lets routes degrade honestly instead of throwing. */
export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
