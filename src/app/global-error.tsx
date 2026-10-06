"use client";

import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-canvas p-6 font-sans text-ink">
        <div className="max-w-md text-center">
          <p className="eyebrow text-muted">Something went wrong</p>
          <h1 className="headline mt-3 text-4xl">The app couldn&apos;t load</h1>
          <p className="mt-4 text-[15px] text-muted">Please try again in a moment.</p>
          {error.digest && <p className="mt-2 text-xs text-subtle">Reference: {error.digest}</p>}
          <button onClick={reset} className="mt-8 h-10 rounded-md bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
