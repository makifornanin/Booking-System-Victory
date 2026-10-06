"use client";

import { useActionState, useState } from "react";
import { requestPasswordResetAction, signInAction, signUpAction, type AuthFormState } from "@/app/actions/auth";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

type Mode = "signin" | "signup" | "reset";

const copy: Record<Mode, { title: string; lede: string; submit: string; pending: string }> = {
  signin: { title: "Welcome back", lede: "Sign in to book a room or check your requests.", submit: "Sign in", pending: "Signing in…" },
  signup: {
    title: "Create your account",
    lede: "The church office reviews new accounts before you can book.",
    submit: "Create account",
    pending: "Creating account…",
  },
  reset: { title: "Reset your password", lede: "We'll email you a link to choose a new password.", submit: "Send reset link", pending: "Sending…" },
};

export function AuthForm({ next, initialMode = "signin" }: { next: string; initialMode?: "signin" | "signup" }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  return <ModeForm key={mode} mode={mode} next={next} onModeChange={setMode} />;
}

function ModeForm({ mode, next, onModeChange }: { mode: Mode; next: string; onModeChange: (mode: Mode) => void }) {
  const action = mode === "signin" ? signInAction : mode === "signup" ? signUpAction : requestPasswordResetAction;
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});
  const errors = state.fieldErrors ?? {};
  const text = copy[mode];
  const passwordHint = mode === "signup" ? "At least 8 characters." : undefined;
  const phoneHint = "Mobile number, e.g. 0917 123 4567.";

  return (
    <div>
      <h1 className="headline text-[2.6rem]">{text.title}</h1>
      <p className="mt-3 text-[15px] text-muted">{text.lede}</p>

      <form action={formAction} className="mt-8 space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {state.message && <Notice tone="success">{state.message}</Notice>}

        {mode === "signup" && (
          <Field id="fullName" label="Full name" error={errors.fullName}>
            <Input id="fullName" name="fullName" autoComplete="name" defaultValue={state.fullName} required aria-invalid={Boolean(errors.fullName)} aria-describedby={describedBy("fullName", errors.fullName)} />
          </Field>
        )}

        <Field id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email}
            required
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("email", errors.email)}
          />
        </Field>

        {mode === "signup" && (
          <Field id="phone" label="Mobile number" error={errors.phone} hint={phoneHint}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="0917 123 4567"
              defaultValue={state.phone}
              required
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={describedBy("phone", errors.phone, phoneHint)}
            />
          </Field>
        )}

        {mode !== "reset" && (
          <Field id="password" label="Password" error={errors.password} hint={passwordHint}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy("password", errors.password, passwordHint)}
            />
          </Field>
        )}

        <SubmitButton className="w-full" size="lg" pending={pending} pendingLabel={text.pending}>
          {text.submit}
        </SubmitButton>
      </form>

      <div className="mt-8 space-y-2 border-t border-line pt-6 text-sm text-muted">
        {mode === "signin" ? (
          <>
            <p>
              New to the booking system?{" "}
              <button type="button" className="font-bold text-brand underline-offset-4 hover:underline" onClick={() => onModeChange("signup")}>
                Create an account
              </button>
            </p>
            <p>
              <button type="button" className="font-bold text-ink-soft underline-offset-4 hover:underline" onClick={() => onModeChange("reset")}>
                Forgot your password?
              </button>
            </p>
          </>
        ) : (
          <p>
            Already have an account?{" "}
            <button type="button" className="font-bold text-brand underline-offset-4 hover:underline" onClick={() => onModeChange("signin")}>
              Sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
