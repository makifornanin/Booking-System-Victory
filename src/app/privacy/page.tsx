import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { getSupportEmail } from "@/lib/env";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google/api";
import { LegalSection, PublicShell } from "@/components/public/public-shell";

export const metadata: Metadata = {
  title: { absolute: `Privacy Policy | ${APP_NAME}` },
  description: `How ${APP_NAME} handles account, booking and Google Calendar information.`,
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "6 October 2026";

export default function PrivacyPage() {
  const supportEmail = getSupportEmail();
  const contact = supportEmail ? (
    <>
      email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
    </>
  ) : (
    "contact the Victory church office that manages this system"
  );

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:px-10 sm:py-20">
        <p className="eyebrow text-muted">{APP_NAME}</p>
        <h1 className="headline mt-4 text-5xl">Privacy Policy</h1>
        <p className="mt-4 text-sm text-muted">Last updated {LAST_UPDATED}</p>

        <div className="mt-8 text-[17px] leading-relaxed text-ink">
          <p>
            {APP_NAME} (&ldquo;the system&rdquo;, &ldquo;we&rdquo;) is operated by Victory Church to manage reservations of its rooms and facilities. This policy
            explains what information the system processes, why, and the choices you have. It applies to everyone who creates an account or requests a
            booking.
          </p>
        </div>

        <nav aria-label="On this page" className="mt-10 border-t border-line pt-6">
          <p className="eyebrow text-muted">On this page</p>
          <ol className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            {[
              ["information", "Information we collect"],
              ["use", "How we use information"],
              ["google-calendar", "Google Calendar"],
              ["notifications", "Notifications (GoHighLevel)"],
              ["sharing", "Service providers and sharing"],
              ["storage", "Files and images"],
              ["security", "Security"],
              ["retention", "Retention and deletion"],
              ["choices", "Your choices"],
              ["contact", "Contact"],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="font-semibold text-ink-soft hover:text-brand hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          <LegalSection id="information" title="Information we collect">
            <p>
              <strong>Account information.</strong> When you create an account we collect your full name, email address, mobile number and a password.
              Passwords are handled by our sign-in provider and stored only in hashed form. We also keep your account access status (pending, active,
              denied or revoked), any reason the church office gives when access is denied or revoked, and when that decision was made and by whom.
            </p>
            <p>
              <strong>Booking information.</strong> For each request we store the room, date and time, the event name and type, the expected number of
              attendees, the purpose you describe, its status (pending, approved, denied or cancelled), any reason given for a denial, and your booking
              history.
            </p>
            <p>
              <strong>Google Calendar information.</strong> Only if you choose to connect Google Calendar. See <a href="#google-calendar">Google Calendar</a>{" "}
              below.
            </p>
            <p>
              <strong>Technical information.</strong> The system uses a sign-in session cookie to keep you signed in, and a short-lived security cookie
              while you connect Google Calendar. It does not use advertising or analytics cookies. Our hosting provider records standard server logs (such
              as IP address and the page requested) for security and troubleshooting.
            </p>
          </LegalSection>

          <LegalSection id="use" title="How we use information">
            <ul>
              <li>to create your account and confirm that the church office has approved your access;</li>
              <li>to show room availability and process your booking requests;</li>
              <li>to let church office administrators review, approve, deny or cancel requests;</li>
              <li>to send you notifications about your account and bookings;</li>
              <li>to add approved reservations to your Google Calendar, if you connected it;</li>
              <li>to keep the system secure, prevent misuse, and keep a record of booking and access decisions for church operations.</li>
            </ul>
            <p>We do not sell personal information, and we do not use it for advertising.</p>
          </LegalSection>

          <LegalSection id="google-calendar" title="Google Calendar">
            <p>
              Connecting Google Calendar is something you do yourself, from the booking flow or your Account page, through Google&rsquo;s own consent
              screen. The system requests a single Google Calendar permission:
            </p>
            <p>
              <code className="rounded-sm bg-sunken px-1.5 py-0.5 text-[13px] break-all text-ink">{GOOGLE_CALENDAR_SCOPE}</code> — which Google
              describes as permission to see, create, change and delete events on Google calendars you own.
            </p>
            <p>
              <strong>How we use it.</strong> Only to create an event in your primary Google Calendar when one of your room reservations is approved
              (event name, room, location, date and time), and to remove that same event if the reservation is cancelled. We do not read, copy or store
              your other calendar events.
            </p>
            <p>
              <strong>What we don&rsquo;t access.</strong> The system uses Google Calendar only. It does not request access to Gmail, Google Drive, Google
              Contacts, your Google profile or any other Google product.
            </p>
            <p>
              <strong>What we store.</strong> An encrypted refresh token, so that approved reservations can be added even when you&rsquo;re not signed in,
              and the ID of each calendar event we created, so we can remove it later. Tokens are kept on our servers only. They are never sent to your
              browser and never shown to other users or to administrators. Administrators can see whether an approved booking was added to your calendar,
              but not your calendar or your token.
            </p>
            <p>
              <strong>Disconnecting.</strong> You can disconnect at any time from your Account page. When you do, we ask Google to revoke the access and
              delete the stored token. Events that were already added stay in your calendar until you delete them. You can also remove access from your
              Google Account at{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
                myaccount.google.com/permissions
              </a>
              ; once Google reports that access was removed, we delete the stored token.
            </p>
            <p>
              <strong>Limited use.</strong> Google user data is used only to provide the calendar sync you asked for. {APP_NAME}&rsquo;s use and transfer of
              information received from Google APIs adheres to the{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Google Calendar data is not used for advertising, is not sold, is not shared with GoHighLevel or
              any other third party, and is not read by people except where you ask us to help, where it is needed for security, or where the law
              requires it.
            </p>
          </LegalSection>

          <LegalSection id="notifications" title="Notifications (GoHighLevel)">
            <p>
              The church uses GoHighLevel, a messaging and scheduling platform, to send emails about your account and bookings and to keep each
              room&rsquo;s calendar. To do this, the system syncs your name, email address and mobile number to a contact record in the church&rsquo;s
              GoHighLevel account, together with the details a message needs — for example the room, event, date and time of a booking, your account
              status, or the reason a request or account was declined. Approved reservations are recorded as appointments in that room&rsquo;s calendar.
            </p>
          </LegalSection>

          <LegalSection id="sharing" title="Service providers and sharing">
            <p>We use these providers to run the system. They process information on the church&rsquo;s behalf:</p>
            <ul>
              <li>
                <strong>Neon</strong> — database, sign-in and private file storage. The database is hosted in Singapore.
              </li>
              <li>
                <strong>Vercel</strong> — hosting for the web application.
              </li>
              <li>
                <strong>GoHighLevel</strong> — notifications and room calendars, as described above.
              </li>
              <li>
                <strong>Google</strong> — calendar sync, only if you connect Google Calendar.
              </li>
              <li>
                <strong>ESV API (Crossway)</strong> — provides the daily Bible verse. No personal information is sent.
              </li>
            </ul>
            <p>
              Church office administrators can see the account and booking details they need to manage reservations. We may also disclose information
              when the law requires it.
            </p>
          </LegalSection>

          <LegalSection id="storage" title="Files and images">
            <p>
              Announcement posters and room photos and maps are stored in private object storage. They are shown only to signed-in members, through
              links that expire after a few minutes.
            </p>
          </LegalSection>

          <LegalSection id="security" title="Security">
            <ul>
              <li>Every request is checked on the server, and database access rules limit members to their own account and bookings.</li>
              <li>Administrator access is granted by the church office only; it cannot be obtained through the app itself.</li>
              <li>Google tokens are encrypted, passwords are stored hashed by our sign-in provider, and all traffic uses HTTPS.</li>
            </ul>
            <p>We take reasonable steps to protect your information, but no online system can be guaranteed to be completely secure.</p>
          </LegalSection>

          <LegalSection id="retention" title="Retention and deletion">
            <p>
              Account and booking information is kept while your account exists. Accounts are not removed automatically when access is denied or revoked,
              so that decisions and booking history remain available to the church office. Booking records and the history of access decisions may be
              kept for church operational and audit purposes, including after an account is closed.
            </p>
            <p>
              To ask for your account and data to be deleted, {contact}. We may need to confirm your identity. We will then delete or anonymise your
              account details, disconnect Google Calendar and delete its stored token, and remove your contact record from GoHighLevel — except for
              records the church needs to keep for operational or legal reasons, which we keep to the minimum necessary.
            </p>
          </LegalSection>

          <LegalSection id="choices" title="Your choices">
            <ul>
              <li>See all of your requests and their status under My bookings.</li>
              <li>Connect or disconnect Google Calendar at any time from your Account page.</li>
              <li>Ask the church office to correct your name or mobile number, or to access or delete your information.</li>
            </ul>
            <p>
              Depending on where you live, data protection law (such as the Philippine Data Privacy Act of 2012) may give you further rights over your
              information.
            </p>
          </LegalSection>

          <LegalSection id="contact" title="Contact">
            <p>For privacy questions or requests, {contact}.</p>
            <p>
              If this policy changes, we will update the date above and, for significant changes, let members know in the system. See also our{" "}
              <Link href="/terms">Terms of Use</Link>.
            </p>
          </LegalSection>
        </div>
      </article>
    </PublicShell>
  );
}
