import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getDatabaseUrl } from "@/lib/env";

type Row = Record<string, unknown>;

const globalForDb = globalThis as typeof globalThis & { __victorySql?: NeonQueryFunction<false, false> };

function sql(): NeonQueryFunction<false, false> {
  globalForDb.__victorySql ??= neon(getDatabaseUrl());
  return globalForDb.__victorySql;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs one statement as the restricted `app_member` role for a verified user (or
 * for nobody), so row-level security and column privileges apply
 * (see db/migrations/0002_security.sql).
 *
 * Uses Neon's HTTP transactions: the role switch, the user id and the statement
 * travel in a single round trip instead of three over TCP.
 */
export async function asMember<R extends Row = Row>(userId: string | null, text: string, params: unknown[] = []): Promise<R[]> {
  if (userId !== null && !UUID.test(userId)) throw new Error("Invalid user id");
  const db = sql();
  const results = await db.transaction([
    db.query("set local role app_member"),
    db.query("select set_config('app.user_id', $1, true)", [userId ?? ""]),
    db.query(text, params),
  ]);
  return results[2] as R[];
}

/** Single statement on the owner connection, for trusted server work only (profile sync, tokens, caches). */
export async function systemQuery<R extends Row = Row>(text: string, params: unknown[] = []): Promise<R[]> {
  return (await sql().query(text, params)) as R[];
}
