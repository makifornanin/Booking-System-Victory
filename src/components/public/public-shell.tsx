import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { buttonStyles } from "@/components/ui/button";
import { SkipLink } from "@/components/shell/member-shell";

/** Header + footer for the public pages (home, privacy, terms). */
export function PublicShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="border-b border-line">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-6 px-6 sm:px-10">
          <Link href="/" className="rounded-sm" aria-label={`${APP_NAME} home`}>
            <Image src="/brand/victory-logo.png" alt="Victory — Honor God. Make Disciples." width={654} height={132} loading="eager" className="h-auto w-36 sm:w-40" />
          </Link>
          <div className="flex items-center gap-2">
            {actions ?? (
              <Link href="/login" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <p>
            {APP_NAME} · Victory Church
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-ink hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-ink hover:underline">
              Terms of Use
            </Link>
            <Link href="/login" className="hover:text-ink hover:underline">
              Sign In
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

/** Typography for long-form legal text: numbered sections with hairline rules. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-8 border-t border-line pt-8 text-[15px] leading-relaxed text-ink-soft [&_a]:font-semibold [&_a]:text-brand [&_a:hover]:underline [&_li]:mt-2 [&_p]:mt-3 [&_strong]:font-bold [&_strong]:text-ink [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
    >
      <h2 id={`${id}-heading`} className="title text-xl text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}
