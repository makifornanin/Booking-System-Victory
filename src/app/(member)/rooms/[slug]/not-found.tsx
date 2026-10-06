import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function RoomNotFound() {
  return (
    <EmptyState
      title="Room not found"
      description="This room doesn't exist or isn't open for booking right now."
      action={
        <Link href="/rooms" className={buttonStyles()}>
          See all rooms
        </Link>
      }
    />
  );
}
