"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { queuePendingReviewNotification } from "@/lib/accounts/pending-review";
import { getAuthProvider } from "@/lib/auth/provider";
import { ConfigError, getSiteUrl } from "@/lib/env";
import { fieldErrorsFrom } from "@/lib/services/result";
import { safeRedirectPath } from "@/lib/utils";
import { passwordResetRequestSchema, passwordResetSchema, signInSchema, signUpSchema } from "@/lib/validation/auth";

export interface AuthFormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  email?: string;
  fullName?: string;
  phone?: string;
}

const EMAIL_LINKS_UNAVAILABLE = "Email links aren't configured yet. Please contact the church office.";

async function requestOrigin(): Promise<string | null> {
  let configured: string | null;
  try {
    configured = getSiteUrl();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[config] ${error.message}`);
    return null;
  }
  if (configured) return configured;
  // Development only: production requires SITE_URL (see getSiteUrl).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email");
  const parsed = signInSchema.safeParse({ email, password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues), email };

  const provider = await getAuthProvider();
  const result = await provider.signIn(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.error, email };

  redirect(safeRedirectPath(text(formData, "next")));
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email");
  const fullName = text(formData, "fullName");
  const phone = text(formData, "phone");
  const parsed = signUpSchema.safeParse({ email, fullName, phone, password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues), email, fullName, phone };

  const provider = await getAuthProvider();
  const result = await provider.signUp(parsed.data);
  if (!result.ok) return { error: result.error, email, fullName, phone };
  // Tell the church office a new account is waiting (GHL workflow). Runs after the
  // response and never affects registration.
  if (result.userId) {
    await queuePendingReviewNotification({
      id: result.userId,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      ghlContactId: null,
    }).catch((error: unknown) => console.error("[accounts] could not queue the pending-review notification:", error instanceof Error ? error.message : error));
  }
  if (result.needsConfirmation) {
    return { message: "Check your email to confirm your account, then sign in.", email };
  }
  // New accounts wait for an admin to approve access.
  redirect("/pending");
}

export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email");
  const parsed = passwordResetRequestSchema.safeParse({ email });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues), email };

  const origin = await requestOrigin();
  if (!origin) return { error: EMAIL_LINKS_UNAVAILABLE, email };
  const provider = await getAuthProvider();
  const result = await provider.sendPasswordReset(parsed.data.email, `${origin}/reset-password`);
  return result.ok ? { message: result.message, email } : { error: result.error, email };
}

export async function resetPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = passwordResetSchema.safeParse({
    token: text(formData, "token"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const provider = await getAuthProvider();
  const result = await provider.resetPassword(parsed.data.token, parsed.data.password);
  if (!result.ok) return { error: result.error };
  redirect("/login?reset=1");
}

export async function signOutAction(): Promise<void> {
  const provider = await getAuthProvider();
  await provider.signOut();
  redirect("/login");
}
