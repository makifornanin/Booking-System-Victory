import "server-only";
import { getDataMode, getSiteUrl } from "@/lib/env";
import { getCalendarGateway } from "@/lib/ghl/gateway";
import { getGoogleCalendar } from "@/lib/google/gateway";
import type { BotDeps, BotProfile } from "@/lib/bot/tools";

/** Real dependencies for the bot tools: the same repositories and gateways the website uses. */
export async function getBotDeps(): Promise<BotDeps> {
  const [calendar, google] = await Promise.all([getCalendarGateway(), getGoogleCalendar()]);
  const base = { calendar, google, now: () => new Date(), siteUrl: getSiteUrl() ?? "http://localhost:3000" };

  if (getDataMode() === "demo") {
    const [{ createDemoRepository }, { getDemoState }] = await Promise.all([import("@/lib/demo/repository"), import("@/lib/demo/store")]);
    return {
      ...base,
      async findProfilesByPhone(phone) {
        return getDemoState()
          .users.filter((u) => u.phone === phone)
          .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, accessStatus: u.accessStatus, accessReason: u.accessReason }));
      },
      repoFor: (userId) => createDemoRepository(userId),
    };
  }

  const [{ createPostgresRepository }, { systemQuery }] = await Promise.all([import("@/lib/data/postgres/repository"), import("@/lib/db/client")]);
  return {
    ...base,
    // The only query that runs without a user context: an exact, parameterized phone match
    // (indexed). Everything after it runs as that user under row-level security.
    async findProfilesByPhone(phone) {
      const rows = await systemQuery<{
        id: string;
        full_name: string;
        email: string;
        phone: string | null;
        role: BotProfile["role"];
        access_status: BotProfile["accessStatus"];
        access_reason: string | null;
      }>("select id, full_name, email, phone, role, access_status, access_reason from public.profiles where phone = $1 limit 5", [phone]);
      return rows.map((r) => ({ id: r.id, fullName: r.full_name, email: r.email, phone: r.phone, role: r.role, accessStatus: r.access_status, accessReason: r.access_reason }));
    },
    repoFor: (userId) => createPostgresRepository(userId),
  };
}
