import { createClient } from "./db-client.mjs";

/**
 * Grants the admin role to the Neon Auth account whose email is ADMIN_EMAIL.
 * Run it yourself right after signing up with that email; the app never grants
 * admin on its own because sign-up emails are not verified.
 */
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!email) {
  console.error("ADMIN_EMAIL is not set.");
  process.exit(1);
}

const client = createClient();
await client.connect();
try {
  const { rows } = await client.query(
    `select id, name, email, "createdAt" from neon_auth."user" where lower(email) = $1`,
    [email],
  );
  if (rows.length === 0) {
    console.error("No account uses ADMIN_EMAIL yet. Sign up in the app with that email, then run this again.");
    process.exit(1);
  }
  const user = rows[0];
  await client.query(
    `insert into public.profiles (id, email, full_name, role, access_status) values ($1, $2, $3, 'admin', 'active')
     on conflict (id) do update set role = 'admin', access_status = 'active', access_reason = null`,
    [user.id, user.email, (user.name ?? "").slice(0, 120)],
  );
  console.log(`Admin access granted to the account created ${new Date(user.createdAt).toISOString()}.`);
} finally {
  await client.end();
}
