import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, getDay, getDaysInMonth } from "date-fns";
import { cn } from "@/lib/utils";

interface MonthCalendarProps {
  selected: string;
  first: string;
  last: string;
  hrefFor: (dateKey: string) => string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const keyOf = (year: number, monthIndex: number, day: number) => format(new Date(year, monthIndex, day), "yyyy-MM-dd");

/** Server-rendered month grid; each day is a link, so it works without client JavaScript. */
export function MonthCalendar({ selected, first, last, hrefFor }: MonthCalendarProps) {
  const [year, month] = selected.split("-").map(Number);
  const monthIndex = month - 1;
  const monthStart = new Date(year, monthIndex, 1);
  const days = getDaysInMonth(monthStart);
  const leading = getDay(monthStart);

  const prevLastDay = keyOf(year, monthIndex, 0);
  const prevTarget = prevLastDay >= first ? (keyOf(year, monthIndex - 1, 1) < first ? first : keyOf(year, monthIndex - 1, 1)) : null;
  const nextFirstDay = keyOf(year, monthIndex + 1, 1);
  const nextTarget = nextFirstDay <= last ? nextFirstDay : null;

  const navClass = "flex size-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sunken hover:text-ink";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-extrabold" aria-live="polite">
          {format(monthStart, "MMMM yyyy")}
        </h3>
        <div className="flex gap-1">
          {prevTarget ? (
            <Link href={hrefFor(prevTarget)} scroll={false} className={navClass} aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={cn(navClass, "pointer-events-none opacity-30")} aria-hidden>
              <ChevronLeft className="size-4" />
            </span>
          )}
          {nextTarget ? (
            <Link href={hrefFor(nextTarget)} scroll={false} className={navClass} aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={cn(navClass, "pointer-events-none opacity-30")} aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((day, i) => (
          <div key={i} className="pb-2 text-[11px] font-bold text-subtle" aria-hidden>
            {day}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const dateKey = keyOf(year, monthIndex, i + 1);
          const isSelected = dateKey === selected;
          const isToday = dateKey === first;
          const disabled = dateKey < first || dateKey > last;
          const label = format(new Date(year, monthIndex, i + 1), "EEEE, d MMMM");
          const base = "relative mx-auto flex size-10 items-center justify-center rounded-full text-sm tabular-nums";

          if (disabled) {
            return (
              <span key={dateKey} className={cn(base, "text-line-strong")} aria-label={`${label}, unavailable`}>
                {i + 1}
              </span>
            );
          }
          return (
            <Link
              key={dateKey}
              href={hrefFor(dateKey)}
              scroll={false}
              aria-label={label}
              aria-current={isSelected ? "date" : undefined}
              className={cn(base, "font-bold transition-colors", isSelected ? "bg-brand text-white" : "text-ink hover:bg-sunken")}
            >
              {i + 1}
              {isToday && <span className={cn("absolute bottom-1.5 size-1 rounded-full", isSelected ? "bg-white" : "bg-accent")} aria-hidden />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
