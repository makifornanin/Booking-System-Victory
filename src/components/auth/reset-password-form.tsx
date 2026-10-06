"use client";

import { useActionState } from "react";
import { resetPasswordAction, type AuthFormState } from "@/app/actions/auth";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(resetPasswordAction, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-8 space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {(state.error || errors.token) && <Notice tone="error">{state.error ?? errors.token}</Notice>}
      <Field id="password" label="New password" error={errors.password} hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors.password)} aria-describedby={describedBy("password", errors.password, "At least 8 characters.")} />
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={errors.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={describedBy("confirmPassword", errors.confirmPassword)} />
      </Field>
      <SubmitButton className="w-full" size="lg" pending={pending} pendingLabel="Saving…">
        Set new password
      </SubmitButton>
    </form>
  );
}
