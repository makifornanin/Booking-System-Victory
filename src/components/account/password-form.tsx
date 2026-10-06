"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { changePasswordAction, type PasswordFormState } from "@/app/actions/account";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<PasswordFormState, FormData>(changePasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field id="currentPassword" label="Current password" error={errors.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required aria-invalid={Boolean(errors.currentPassword)} aria-describedby={describedBy("currentPassword", errors.currentPassword)} />
      </Field>
      <Field id="password" label="New password" error={errors.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors.password)} aria-describedby={describedBy("password", errors.password)} />
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={errors.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={describedBy("confirmPassword", errors.confirmPassword)} />
      </Field>
      <SubmitButton pending={pending} pendingLabel="Updating…">
        Update password
      </SubmitButton>
    </form>
  );
}
