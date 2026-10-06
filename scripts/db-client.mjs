import pg from "pg";

/** Connection for CLI scripts. Reads DATABASE_URL from the environment (npm scripts load .env.local). */
export function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local.");
    process.exit(1);
  }
  // pg already treats sslmode=require as verify-full; say so explicitly to avoid its deprecation warning.
  return new pg.Client({ connectionString: url.replace("sslmode=require", "sslmode=verify-full") });
}
