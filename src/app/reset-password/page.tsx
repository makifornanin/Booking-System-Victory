import type { Metadata } from "next";
import Link from "next/link";
import { firstParam } from "@/lib/validation/params";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Reset password" };

/** Landing page for the password-reset email link (Neon Auth appends ?token= or ?error=). */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = firstParam(params.token) ?? "";
  const invalid = Boolean(firstParam(params.error)) || token.length < 10;

  return (
    <AuthLayout>
      <h1 className="headline text-[2.6rem]">Choose a new password</h1>
      {invalid ? (
        <>
          <Notice tone="error" className="mt-8">
            This reset link is invalid or has expired. Reset links work for 15 minutes.
          </Notice>
          <Link href="/login" className="mt-6 inline-block text-sm font-bold text-brand underline-offset-4 hover:underline">
            Back to sign in to request a new link
          </Link>
        </>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </AuthLayout>
  );
}
