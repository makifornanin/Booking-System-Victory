import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { imageUrl } from "@/lib/data";
import { getActiveRooms } from "@/lib/data/queries";
import { RoomDirectory, type DirectoryRoom } from "@/components/rooms/room-directory";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Book a Room" };

export default async function RoomsPage() {
  await requireUser();
  const rooms = await getActiveRooms();

  const directory: DirectoryRoom[] = rooms.map((room) => ({
    id: room.id,
    slug: room.slug,
    name: room.name,
    shortDescription: room.shortDescription,
    capacity: room.capacity,
    bestFor: room.bestFor,
    locationLabel: room.locationLabel,
    imageUrl: imageUrl(room.imagePath),
    mapUrl: imageUrl(room.mapImagePath),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Book a room"
        title="Find a space for your gathering"
        description="Choose a room to see its schedule. Every request is confirmed by the church office, and approved bookings go straight to your Google Calendar."
      />
      {directory.length > 0 ? (
        <RoomDirectory rooms={directory} />
      ) : (
        <EmptyState title="No rooms are open for booking" description="Please check back later or contact the church office." />
      )}
    </div>
  );
}
