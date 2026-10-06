import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { getSupportEmail } from "@/lib/env";
import { LegalSection, PublicShell } from "@/components/public/public-shell";

export const metadata: Metadata = {
  title: { absolute: `Terms of Use | ${APP_NAME}` },
  description: `The terms for using ${APP_NAME} to reserve Victory Church facilities.`,
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "6 October 2026";

export default function TermsPage() {
  const supportEmail = getSupportEmail();

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:px-10 sm:py-20">
        <p className="eyebrow text-muted">{APP_NAME}</p>
        <h1 className="headline mt-4 text-5xl">Terms of Use</h1>
        <p className="mt-4 text-sm text-muted">Last updated {LAST_UPDATED}</p>

        <p className="mt-8 text-[17px] leading-relaxed text-ink">
          {APP_NAME} is provided by Victory Church so that members, volunteers and staff can request the use of church rooms and facilities. By creating
          an account you agree to these terms.
        </p>

        <div className="mt-10 space-y-10">
          <LegalSection id="accounts" title="Accounts">
            <ul>
              <li>Use your real name, email address and mobile number, and keep your password private.</li>
              <li>New accounts are reviewed by the church office. The church office may decline an account, or revoke access, at its discretion.</li>
              <li>You are responsible for requests made from your account.</li>
            </ul>
          </LegalSection>

          <LegalSection id="bookings" title="Bookings">
            <ul>
              <li>A request is not a reservation until the church office approves it.</li>
              <li>
                The church office may decline a request, or cancel an approved booking when a room is needed for church events, maintenance or safety. We
                will let you know when that happens.
              </li>
              <li>Cancel bookings you no longer need, so the room is free for others.</li>
              <li>Keep to the approved time and the room&rsquo;s capacity, and follow the church&rsquo;s facility guidelines.</li>
              <li>The booking flow asks you to connect Google Calendar before your first request, so approved reservations appear in your calendar.</li>
            </ul>
          </LegalSection>

          <LegalSection id="use" title="Acceptable use">
            <ul>
              <li>Use the system only to arrange gatherings for Victory groups, ministries and church activities.</li>
              <li>Don&rsquo;t submit false information, or try to access other people&rsquo;s information or administrator features.</li>
              <li>Don&rsquo;t interfere with the system or try to get around its security.</li>
            </ul>
          </LegalSection>

          <LegalSection id="availability" title="Availability">
            <p>
              We work to keep the system available and its schedules accurate, but we can&rsquo;t guarantee it will always be available or free of errors.
              If something looks wrong with a booking, contact the church office.
            </p>
          </LegalSection>

          <LegalSection id="privacy" title="Privacy">
            <p>
              How we handle your information, including Google Calendar access, is explained in the <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </LegalSection>

          <LegalSection id="changes" title="Changes and contact">
            <p>
              We may update these terms; the date above shows the latest version. Questions:{" "}
              {supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : "contact the Victory church office that manages this system"}.
            </p>
          </LegalSection>
        </div>
      </article>
    </PublicShell>
  );
}
