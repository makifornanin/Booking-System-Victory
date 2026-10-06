import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";

export default function NotFound() {
  return (
    <StatusScreen eyebrow="Error 404" title="Page not found" description="The page you're looking for doesn't exist or has moved.">
      <Link href="/" className={buttonStyles()}>
        Go to home
      </Link>
    </StatusScreen>
  );
}
