import Link from "next/link";
import { DAY_END_HOUR, DAY_START_HOUR } from "@/lib/config";
import type { BookingDetails, Room } from "@/lib/data/types";
import { formatTimeRange, zonedDateTime } from "@/lib/domain/time";
import { cn } from "@/lib/utils";

interface Props {
  dateKey: string;
  rooms: Room[];
  bookings: BookingDetails[];
  now: Date;
}

/** One track per room across bookable hours; approved blocks are solid, pending are hatched. */
export function RoomUsageTimeline({ dateKey, rooms, bookings, now }: Props) {
  const at = (hour: number) => zonedDateTime(dateKey, `${String(hour).padStart(2, "0")}:00`).getTime();
  const dayStart = at(DAY_START_HOUR);
  const span = at(DAY_END_HOUR) - dayStart;
  const pct = (ms: number) => `${(Math.min(Math.max(ms - dayStart, 0), span) / span) * 100}%`;
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
  const nowMs = now.getTime();
  const showNow = nowMs > dayStart && nowMs < dayStart + span;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="relative ml-28 h-5 text-[11px] font-semibold text-subtle">
          {hours.map((hour, index) => (
            <span key={hour} className={cn("absolute tabular-nums", index === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(at(hour)) }}>
              {hour === 12 ? "12p" : hour > 12 ? `${hour - 12}p` : `${hour}a`}
            </span>
          ))}
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {rooms.map((room) => (
            <li key={room.id} className="flex items-center">
              <span className="w-28 shrink-0 truncate py-3 pr-3 text-sm font-bold">{room.name}</span>
              <div className="relative h-12 flex-1">
                {hours.slice(1, -1).map((hour) => (
                  <span key={hour} className="absolute inset-y-0 w-px bg-line/70" style={{ left: pct(at(hour)) }} aria-hidden />
                ))}
                {bookings
                  .filter((b) => b.roomId === room.id)
                  .map((booking) => {
                    const start = new Date(booking.startTime).getTime();
                    const end = new Date(booking.endTime).getTime();
                    const label = `${booking.eventName}, ${formatTimeRange(booking.startTime, booking.endTime)}, ${booking.status}`;
                    return (
                      <Link
                        key={booking.id}
                        href={`/admin/bookings/${booking.id}`}
                        title={label}
                        aria-label={label}
                        className={cn(
                          "absolute inset-y-1.5 overflow-hidden rounded-sm px-2 py-1 text-[11px] leading-tight font-bold transition-[filter]",
                          booking.status === "approved"
                            ? "bg-brand text-white hover:brightness-110"
                            : "bg-[repeating-linear-gradient(135deg,var(--color-pending-bg)_0_6px,#f6e3c2_6px_12px)] text-pending shadow-[inset_0_0_0_1px_rgb(154_88_0/0.25)]",
                        )}
                        style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
                      >
                        <span className="block truncate">{booking.eventName}</span>
                        <span className="block truncate font-semibold opacity-80">{formatTimeRange(booking.startTime, booking.endTime)}</span>
                      </Link>
                    );
                  })}
                {showNow && <span className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: pct(nowMs) }} aria-hidden />}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 ml-28 flex gap-5 text-xs font-semibold text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-brand" aria-hidden />
            Approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-pending-bg shadow-[inset_0_0_0_1px_rgb(154_88_0/0.3)]" aria-hidden />
            Pending
          </span>
          {showNow && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-0.5 bg-accent" aria-hidden />
              Now
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
