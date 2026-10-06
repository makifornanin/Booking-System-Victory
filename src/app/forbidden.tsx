import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";

export default function Forbidden() {
  return (
    <StatusScreen
      eyebrow="Error 403"
      title="You don't have access to this page"
      description="This area is for church office admins. If you need access, ask an existing admin."
    >
      <Link href="/dashboard" className={buttonStyles()}>
        Back to home
      </Link>
    </StatusScreen>
  );
}
