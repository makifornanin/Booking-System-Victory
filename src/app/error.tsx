"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      eyebrow="Something went wrong"
      title="We couldn’t load this page"
      description="Try again in a moment. If it keeps happening, let the church office know."
      footnote={error.digest ? `Reference: ${error.digest}` : undefined}
    >
      <Button onClick={reset}>Try again</Button>
      <Link href="/" className={buttonStyles({ variant: "secondary" })}>
        Go to home
      </Link>
    </StatusScreen>
  );
}
