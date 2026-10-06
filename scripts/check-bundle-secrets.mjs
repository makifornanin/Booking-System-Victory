// Scans the built browser assets for secrets and server-only code. Run after `next build`.
// Prints only key names and file paths, never values. Usage: npm run check:bundle
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = ".next";
// Everything a browser can download: client chunks plus prerendered HTML/RSC payloads.
const TARGETS = [join(ROOT, "static"), join(ROOT, "server", "app")];
const PUBLIC_EXTENSIONS = /\.(js|mjs|css|html|rsc|txt|json)$/;

const SECRET_KEYS = [
  "DATABASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
  "ESV_API_KEY",
];

// Names that only server code mentions; seeing them in a client chunk means server code leaked.
const SERVER_MARKERS = [...SECRET_KEYS, "refresh_token_ciphertext", "set local role app_member", "app.user_id", "Authorization: Token"];

function files(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out = out.concat(files(path));
    else if (PUBLIC_EXTENSIONS.test(name)) out.push(path);
  }
  return out;
}

const secrets = [];
for (const key of SECRET_KEYS) {
  const value = process.env[key]?.trim();
  if (value && value.length >= 8) secrets.push({ key, value });
}
// The database password on its own, in case only part of the URL leaks.
try {
  const password = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : "";
  if (password.length >= 8) secrets.push({ key: "DATABASE_URL (password)", value: password });
} catch {
  // not a URL; the full-value check still applies
}

const staticDir = join(ROOT, "static");
const all = TARGETS.flatMap(files);
if (all.length === 0) {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(1);
}

const problems = [];
for (const path of all) {
  const text = readFileSync(path, "utf8");
  for (const { key, value } of secrets) {
    if (text.includes(value)) problems.push(`${relative(".", path)}: contains the value of ${key}`);
  }
  // Server chunks legitimately reference env names; only client chunks must not.
  if (path.startsWith(staticDir)) {
    for (const marker of SERVER_MARKERS) {
      if (text.includes(marker)) problems.push(`${relative(".", path)}: mentions server-only "${marker}"`);
    }
  }
}

if (problems.length) {
  console.error(`FAIL  ${problems.length} problem(s) in browser assets:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`ok    scanned ${all.length} browser-facing files; checked ${secrets.length} secret value(s) and ${SERVER_MARKERS.length} server-only markers`);
