import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { requireSignedIn } from "@/lib/auth/session";
import { formatPhone } from "@/lib/domain/phone";
import { firstName } from "@/lib/utils";
import { buttonStyles } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = { title: "Account status" };

const content = {
  pending: {
    eyebrow: "Account received",
    title: "Your account is awaiting approval",
    body: "The church office reviews every new account to keep rooms for Victory groups and ministries. You'll get an email as soon as you're approved — usually within a day or two.",
  },
  denied: {
    eyebrow: "Request not approved",
    title: "We couldn't approve this account",
    body: "If you think this is a mistake, contact the church office and mention the email address below.",
  },
  revoked: {
    eyebrow: "Access paused",
    title: "Your portal access has been revoked",
    body: "Your account and booking history are kept. Contact the church office if you'd like access restored.",
  },
} as const;

/** Signed-in users without active access land here; nothing else in the portal is reachable. */
export default async function PendingPage() {
  const user = await requireSignedIn();
  if (user.accessStatus === "active") redirect("/portal");
  const text = content[user.accessStatus];

  return (
    <main className="flex flex-1 flex-col px-6 py-10 sm:px-12">
      <Image src="/brand/victory-logo.png" alt="Victory — Honor God. Make Disciples." width={654} height={132} loading="eager" className="h-auto w-44" />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-16 animate-fade-up">
        <p className="eyebrow text-muted">{text.eyebrow}</p>
        <h1 className="headline mt-4 text-[2.75rem] sm:text-6xl">{text.title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-ink-soft">
          {user.accessStatus === "pending" ? `Thanks for signing up, ${firstName(user.fullName)}. ` : null}
          {text.body}
        </p>

        {user.accessReason && user.accessStatus !== "pending" && (
          <blockquote className="mt-8 border-l-2 border-accent pl-5">
            <p className="eyebrow text-muted">Note from the church office</p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink">{user.accessReason}</p>
          </blockquote>
        )}

        <dl className="mt-10 grid gap-x-8 gap-y-4 border-t border-line pt-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Name</dt>
            <dd className="mt-1 font-bold">{user.fullName}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Email</dt>
            <dd className="mt-1 truncate font-bold">{user.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Mobile</dt>
            <dd className="mt-1 font-bold">{formatPhone(user.phone)}</dd>
          </div>
        </dl>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {user.accessStatus === "pending" && (
            <Link href="/pending" className={buttonStyles({ variant: "secondary" })}>
              Check again
            </Link>
          )}
          <form action={signOutAction}>
            <SubmitButton variant="quiet" pendingLabel="Signing out…">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </SubmitButton>
          </form>
        </div>
      </div>
    </main>
  );
}
