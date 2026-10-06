"use server";

import { getAuthProvider } from "@/lib/auth/provider";
import { getCurrentUser } from "@/lib/auth/session";
import { fieldErrorsFrom } from "@/lib/services/result";
import { passwordChangeSchema } from "@/lib/validation/auth";

export interface PasswordFormState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  if (!(await getCurrentUser())) return { error: "Your session has expired. Sign in again." };

  const parsed = passwordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const provider = await getAuthProvider();
  const result = await provider.changePassword(parsed.data.currentPassword, parsed.data.password);
  return result.ok ? { ok: true, message: "Password updated." } : { error: result.error };
}
