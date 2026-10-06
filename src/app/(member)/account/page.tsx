import type { ReactNode } from "react";
import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth/session";
import { getRepositoryForRequest } from "@/lib/data/queries";
import { formatPhone } from "@/lib/domain/phone";
import { formatDate } from "@/lib/domain/time";
import { getGoogleCalendar } from "@/lib/google/gateway";
import { firstParam } from "@/lib/validation/params";
import { GoogleCalendarRow } from "@/components/account/google-calendar-row";
import { PasswordForm } from "@/components/account/password-form";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = { title: "Account" };

const googleNotices: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Google Calendar connected." },
  declined: { tone: "warning", text: "Google Calendar wasn't connected." },
  error: { tone: "error", text: "We couldn't connect Google Calendar. Please try again." },
  no_refresh: { tone: "error", text: "Google didn't grant ongoing access. Remove Victory Booking System at myaccount.google.com/permissions, then connect again." },
  scope: { tone: "error", text: "Calendar permission wasn't granted. Please connect again and allow calendar access." },
  unavailable: { tone: "warning", text: "Google Calendar sync isn't set up on this server yet." },
};

/** Settings section: label and description on the left, content on the right. */
function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-line py-8 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-12">
      <div>
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser();
  const [profile, google, query] = await Promise.all([(await getRepositoryForRequest()).getProfile(user.id), getGoogleCalendar(), searchParams]);
  const connected = google.mode !== "disabled" && (await google.isConnected(user.id));
  const notice = googleNotices[firstParam(query.google) ?? ""];

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Account" title="Your account" />
      {notice && (
        <Notice tone={notice.tone} className="mb-6">
          {notice.text}
        </Notice>
      )}

      <SettingsSection title="Profile" description="Contact the church office to change your name or number.">
        <dl className="divide-y divide-line text-[15px]">
          {[
            ["Name", user.fullName],
            ["Email", user.email],
            ["Mobile", formatPhone(user.phone)],
            ["Access", user.role === "admin" ? "Church office admin" : "Member"],
            ["Member since", profile ? formatDate(profile.createdAt, "d MMMM yyyy") : "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6 py-3 first:pt-0">
              <dt className="text-muted">{label}</dt>
              <dd className="truncate text-right font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>

      <SettingsSection title="Google Calendar" description="Where your approved bookings appear.">
        <GoogleCalendarRow connected={connected} available={google.mode !== "disabled"} />
      </SettingsSection>

      <SettingsSection title="Password" description="Use at least 8 characters.">
        <div className="max-w-sm">
          <PasswordForm />
        </div>
      </SettingsSection>

      <SettingsSection title="Sign out">
        <form action={signOutAction}>
          <SubmitButton variant="secondary" pendingLabel="Signing out…">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </SubmitButton>
        </form>
      </SettingsSection>
    </div>
  );
}
