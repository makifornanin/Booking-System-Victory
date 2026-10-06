import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getDataMode } from "@/lib/env";
import { safeRedirectPath } from "@/lib/utils";
import { firstParam } from "@/lib/validation/params";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  // The homepage is public, so "/" (or no target) means "the portal" after sign-in.
  const requested = safeRedirectPath(firstParam(params.next), "/portal");
  const next = requested === "/" ? "/portal" : requested;
  if (await getCurrentUser()) redirect(next);

  const isDemo = getDataMode() === "demo";
  const passwordReset = firstParam(params.reset) === "1";

  return (
    <AuthLayout footer="For Victory members, volunteers and staff.">
      {passwordReset && (
        <Notice tone="success" className="mb-8">
          Password updated. Sign in with your new password.
        </Notice>
      )}
      <AuthForm next={next} initialMode={firstParam(params.mode) === "signup" ? "signup" : "signin"} />
      {isDemo && (
        <Notice tone="info" title="Demo accounts (development only)" className="mt-8">
          Member <strong>member@victory.test</strong> · Admin <strong>admin@victory.test</strong> · Pending <strong>pending@victory.test</strong>
          <br />
          Password <strong>victory-demo</strong>
        </Notice>
      )}
    </AuthLayout>
  );
}
