import "server-only";
import type { AuthProvider, SessionUser } from "@/lib/auth/provider";
import { getNeonAuth } from "@/lib/auth/neon-instance";
import type { AccessStatus, Role } from "@/lib/data/types";
import { systemQuery } from "@/lib/db/client";

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

function friendlyAuthError(error: AuthErrorLike | null | undefined): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "invalid_credentials") return "Incorrect email or password.";
  if (/already exists/i.test(message) || code === "user_already_exists") return "An account with this email already exists. Sign in instead.";
  if (code === "weak_password") return "Choose a stronger password (at least 8 characters).";
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (code === "bad_jwt") return "This reset link is invalid or has expired. Request a new one.";
  if (code === "email_not_confirmed") return "Please confirm your email address first. Check your inbox.";
  if (code.startsWith("NETWORK_")) return "The sign-in service can't be reached right now. Please try again shortly.";
  if (error?.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (error?.status === 403 && /origin|redirect/i.test(message)) {
    console.error("[auth] Neon Auth rejected this origin. Add the site's domain under Neon Console → Auth → Domains.");
    return "Sign-in isn't set up for this web address yet. Please contact the church office.";
  }
  console.error(`[auth] ${code || "unknown"} (${error?.status ?? "no status"}): ${message}`);
  return "Something went wrong. Please try again.";
}

interface ProfileSnapshot {
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  access_status: AccessStatus;
  access_reason: string | null;
}

/**
 * Creates the profile on first sign-in (role 'user', access 'pending') and keeps
 * the email in sync, in one statement. Runs as the owner because members can't
 * insert profiles. A phone is only written when the profile is first created.
 */
async function syncProfile(user: { id: string; email: string; name: string }, phone: string | null = null): Promise<ProfileSnapshot> {
  const rows = await systemQuery<ProfileSnapshot & Record<string, unknown>>(
    `with upsert as (
       insert into public.profiles (id, email, full_name, phone) values ($1, $2, left($3, 120), $4)
       on conflict (id) do update set email = excluded.email, phone = coalesce(public.profiles.phone, excluded.phone)
         where public.profiles.email is distinct from excluded.email
            or (public.profiles.phone is null and excluded.phone is not null)
       returning full_name, email, phone, role, access_status, access_reason
     )
     select * from upsert
     union all
     select full_name, email, phone, role, access_status, access_reason
     from public.profiles where id = $1 and not exists (select 1 from upsert)
     limit 1`,
    [user.id, user.email, user.name || user.email.split("@")[0], phone],
  );
  return rows[0];
}

export function createNeonAuthProvider(): AuthProvider {
  const auth = getNeonAuth();

  return {
    async getCurrentUser(): Promise<SessionUser | null> {
      let user: { id: string; email: string; name: string } | undefined;
      try {
        const { data } = await auth.getSession();
        user = data?.user ?? undefined;
      } catch (error) {
        console.error("[auth] getSession failed:", error instanceof Error ? error.message : error);
        return null;
      }
      if (!user?.id) return null;

      const profile = await syncProfile({ id: user.id, email: user.email, name: user.name });
      return {
        id: user.id,
        email: profile.email || user.email,
        fullName: profile.full_name || user.name || user.email,
        phone: profile.phone,
        role: profile.role === "admin" ? "admin" : "user",
        accessStatus: profile.access_status,
        accessReason: profile.access_reason,
      };
    },

    async signIn(email, password) {
      const { error } = await auth.signIn.email({ email, password });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    },

    async signUp({ fullName, email, phone, password }) {
      const { data, error } = await auth.signUp.email({ email, password, name: fullName });
      if (error) return { ok: false, error: friendlyAuthError(error) };
      if (data?.user?.id) {
        // Create the profile now so the phone number is stored; access starts as pending.
        await syncProfile({ id: data.user.id, email, name: fullName }, phone);
      }
      // With email verification enabled in Neon Auth, sign-up returns no session token.
      return { ok: true, needsConfirmation: !data?.token };
    },

    async signOut() {
      await auth.signOut();
    },

    async changePassword(currentPassword, newPassword) {
      const { error } = await auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    },

    async sendPasswordReset(email, redirectTo) {
      const { error } = await auth.requestPasswordReset({ email, redirectTo });
      if (error && error.status !== 404) return { ok: false, error: friendlyAuthError(error) };
      return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
    },

    async resetPassword(token, newPassword) {
      const { error } = await auth.resetPassword({ newPassword, token });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true, message: "Password updated. You can sign in now." };
    },
  };
}
