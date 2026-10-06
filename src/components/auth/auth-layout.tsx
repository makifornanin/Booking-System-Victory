import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { APP_NAME } from "@/lib/config";

/**
 * Split auth layout: the form on warm paper, beside a deep-navy panel carrying
 * Victory's tagline. The panel collapses away on small screens.
 */
export function AuthLayout({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
      <section className="flex flex-col px-6 py-10 sm:px-12 lg:px-16">
        <Link href="/" className="w-fit rounded-sm" aria-label={`${APP_NAME} home`}>
          <Image src="/brand/victory-logo.png" alt="Victory — Honor God. Make Disciples." width={654} height={132} loading="eager" className="h-auto w-44" />
        </Link>
        <div className="flex flex-1 items-center py-12">
          <div className="w-full max-w-[400px] animate-fade-up">{children}</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted">
          {footer && <p>{footer}</p>}
          <nav aria-label="Legal" className="flex gap-5">
            <Link href="/privacy" className="hover:text-ink hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-ink hover:underline">
              Terms of Use
            </Link>
          </nav>
        </div>
      </section>

      <aside className="relative hidden overflow-hidden bg-brand-deep text-white lg:flex lg:flex-col lg:justify-end">
        <Image
          src="/brand/victory-mark.png"
          alt=""
          width={512}
          height={512}
          className="pointer-events-none absolute -top-24 -right-28 size-[560px] opacity-[0.16] mix-blend-luminosity"
          aria-hidden
        />
        <div className="relative px-14 pb-16">
          <p className="eyebrow text-white/60">{APP_NAME}</p>
          <p className="headline mt-5 max-w-md text-5xl leading-[1.05]">Honor God. Make Disciples.</p>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-white/75">
            Reserve a room for your Victory group, ministry meeting, class or rehearsal. The church office confirms every request.
          </p>
        </div>
      </aside>
    </main>
  );
}
