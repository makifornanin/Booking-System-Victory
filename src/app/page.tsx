import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/config";
import { PublicShell } from "@/components/public/public-shell";
import { buttonStyles } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: APP_NAME },
  description: "Room reservations and facility scheduling for Victory Church.",
  robots: { index: true, follow: true },
};

const steps = [
  { title: "Check availability", body: "See each room's open times, kept in step with the church calendar." },
  { title: "Request a room", body: "Pick a date and time, and tell the church office what the gathering is for." },
  { title: "Admin approval", body: "The church office reviews every request and approves or declines it. You're notified by email either way." },
  { title: "Track your bookings", body: "Follow each request from pending to approved, and cancel anything you no longer need." },
  { title: "Google Calendar", body: "Connect your Google Calendar once, and approved reservations are added to it automatically — and removed if cancelled." },
];

/** The public face of the system: what it is, and the way in. Readable without signing in. */
export default async function HomePage() {
  await connection();
  let user: SessionUser | null = null;
  try {
    user = await getCurrentUser();
  } catch (error) {
    unstable_rethrow(error);
    // The homepage stays public even if sign-in is misconfigured.
    console.error("[home] session lookup failed:", error instanceof Error ? error.message : error);
  }

  const actions = user ? (
    <Link href="/portal" className={buttonStyles({ size: "sm" })}>
      Open portal
    </Link>
  ) : (
    <>
      <Link href="/login" className={buttonStyles({ variant: "quiet", size: "sm" })}>
        Sign in
      </Link>
      <Link href="/login?mode=signup" className={buttonStyles({ size: "sm" })}>
        Create account
      </Link>
    </>
  );

  return (
    <PublicShell actions={actions}>
      <div className="mx-auto grid max-w-6xl gap-14 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-12 lg:gap-16">
        <section aria-labelledby="intro-heading" className="lg:col-span-6">
          <p className="eyebrow text-muted">Victory Church · Facilities</p>
          <h1 id="intro-heading" className="headline mt-4 text-[2.75rem] sm:text-6xl">
            {APP_NAME}
          </h1>
          <p className="mt-6 text-xl leading-relaxed text-ink">A room reservation system for Victory Church facilities.</p>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
            Victory groups, ministries and staff use it to reserve classrooms and event spaces for meetings, classes and rehearsals. New accounts are
            approved by the church office before they can book.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            {user ? (
              <Link href="/portal" className={buttonStyles({ size: "lg" })}>
                Open portal
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonStyles({ size: "lg" })}>
                  Sign in
                </Link>
                <Link href="/login?mode=signup" className={buttonStyles({ variant: "secondary", size: "lg" })}>
                  Create account
                </Link>
              </>
            )}
          </div>
          {user && <p className="mt-4 text-sm text-muted">Signed in as {user.email}.</p>}
        </section>

        <section aria-labelledby="how-heading" className="lg:col-span-6 lg:pt-3">
          <h2 id="how-heading" className="eyebrow text-muted">
            How it works
          </h2>
          <ol className="mt-4 border-t border-ink">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-5 border-b border-line py-5">
                <span className="w-7 shrink-0 pt-0.5 font-serif text-lg text-subtle tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-[15px] font-extrabold text-ink">{step.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm leading-relaxed text-muted">
            Google Calendar access is used only to add and remove your approved reservations. Read the{" "}
            <Link href="/privacy#google-calendar" className="font-semibold text-brand hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
