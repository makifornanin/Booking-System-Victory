"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck2 } from "lucide-react";
import { requestBookingAction, type BookingActionState } from "@/app/actions/bookings";
import { requestRescheduleAction, type RescheduleActionState } from "@/app/actions/reschedules";
import { EVENT_TYPES } from "@/lib/config";
import { endOptionsFrom, groupIntoSegments, type DaySlot } from "@/lib/domain/availability";
import { formatTime, formatTimeRange, timeKeyInZone } from "@/lib/domain/time";
import { cn } from "@/lib/utils";
import { buttonStyles } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

interface BookingPanelProps {
  roomId: string;
  roomName: string;
  capacity: number;
  dateKey: string;
  dateLabel: string;
  slots: DaySlot[];
  problem: string | null;
  maxMinutes: number;
  /** Google Calendar must be connected before booking (unless sync is disabled on this server). */
  googleRequired: boolean;
  googleConnected: boolean;
  returnTo: string;
  /** Reschedule mode: pick a new time for an existing approved booking in the same room. */
  reschedule?: { bookingId: string; durationMinutes: number; currentLabel: string };
}

function durationLabel(start: string, end: string): string {
  const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} h` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ");
}

export function BookingPanel(props: BookingPanelProps) {
  const { roomId, roomName, capacity, dateKey, dateLabel, slots, problem, maxMinutes, googleRequired, googleConnected, returnTo, reschedule } = props;
  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null);
  const [state, setState] = useState<BookingActionState | RescheduleActionState>(null);
  const [pending, startTransition] = useTransition();

  const segments = useMemo(() => groupIntoSegments(slots).filter((segment) => segment.status !== "past"), [slots]);
  const hasPast = slots.some((slot) => slot.status === "past");
  const anyAvailable = slots.some((slot) => slot.status === "available");

  // A refresh after a conflict can make the chosen start unavailable; treat it as unselected.
  const start = selectedStart && slots.some((s) => s.start === selectedStart && s.status === "available") ? selectedStart : null;
  const endOptions = useMemo(() => (start ? endOptionsFrom(slots, start, maxMinutes) : []), [slots, start, maxMinutes]);
  // Reschedules keep the current length when it fits; new bookings default to one hour.
  const keepLength = start && reschedule ? endOptions.find((option) => new Date(option).getTime() - new Date(start).getTime() === reschedule.durationMinutes * 60_000) : undefined;
  const end = start && selectedEnd && endOptions.includes(selectedEnd) ? selectedEnd : (keepLength ?? endOptions[Math.min(1, endOptions.length - 1)] ?? null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const purposeHint = "What's the gathering for? This helps the office review your request.";
  const blockedByGoogle = !reschedule && googleRequired && !googleConnected;

  /** First tap picks the start; a later tap within the open run picks the last half-hour. */
  function pick(slot: DaySlot) {
    if (start && slot.start > start && endOptions.includes(slot.end)) {
      setSelectedEnd(slot.end);
      return;
    }
    setSelectedStart(slot.start);
    setSelectedEnd(null);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    }
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      if (reschedule) {
        const result = await requestRescheduleAction(null, formData);
        setState(result);
        if (result?.ok) {
          toast.success("Reschedule request sent.");
          router.push(`/bookings?rescheduled=${reschedule.bookingId}`);
        } else if (result?.code === "unauthenticated") router.push("/login");
        else if (result?.code === "conflict") router.refresh();
        return;
      }
      const result = await requestBookingAction(null, formData);
      setState(result);
      if (result?.ok) {
        toast.success(result.message);
        router.push(`/bookings?new=${result.data.bookingId}`);
      } else if (result?.code === "unauthenticated") {
        router.push("/login");
      } else if (result?.code === "conflict") {
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:gap-14">
      <section aria-labelledby="schedule-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
          <h3 id="schedule-heading" className="text-lg font-extrabold">
            <span className="mr-2 font-serif text-base font-normal text-subtle">2</span>
            {dateLabel}
          </h3>
          <ul className="flex gap-4 text-xs font-semibold text-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-ink/30 bg-surface" aria-hidden />
              Open
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-line-strong)_0_2px,transparent_2px_4px)]" aria-hidden />
              Reserved
            </li>
          </ul>
        </div>

        {problem && (
          <Notice tone="warning" className="mt-5">
            {problem}
          </Notice>
        )}
        {!problem && !anyAvailable && (
          <Notice tone="info" className="mt-5" title="No open times on this day">
            Try another date on the calendar.
          </Notice>
        )}
        {!problem && anyAvailable && <p className="mt-4 text-sm text-muted">Tap a start time, then tap the last half-hour you need.</p>}
        {hasPast && !problem && <p className="mt-1 text-xs text-subtle">Earlier times today have passed.</p>}

        <ol className="mt-5 space-y-2.5">
          {segments.map((segment) =>
            segment.status === "available" ? (
              <li key={segment.start}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {segment.slots.map((slot) => {
                    const isStart = slot.start === start;
                    const isEnd = end !== null && slot.end === end && slot.start !== start;
                    const inRange = start !== null && end !== null && slot.start >= start && slot.start < end;
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => pick(slot)}
                        aria-pressed={inRange}
                        aria-label={`${formatTime(slot.start)}${isStart ? ", start" : isEnd ? ", end" : ""}`}
                        className={cn(
                          "h-11 rounded-md text-sm font-bold tabular-nums transition-[background-color,color,box-shadow] duration-150",
                          isStart || isEnd
                            ? "bg-brand text-white"
                            : inRange
                              ? "bg-brand-tint text-brand-deep"
                              : "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--color-brand)]",
                        )}
                      >
                        {formatTime(slot.start)}
                      </button>
                    );
                  })}
                </div>
              </li>
            ) : (
              <li
                key={segment.start}
                className={cn(
                  "flex items-center justify-between rounded-md px-3.5 py-3 text-sm",
                  segment.status === "reserved"
                    ? "bg-[repeating-linear-gradient(135deg,var(--color-sunken)_0_6px,var(--color-canvas)_6px_12px)] text-ink-soft shadow-[inset_0_0_0_1px_var(--color-line)]"
                    : "text-subtle",
                )}
              >
                <span className="font-semibold tabular-nums">{formatTimeRange(segment.start, segment.end)}</span>
                <span className="font-bold">{segment.status === "reserved" ? "Reserved" : "Not available"}</span>
              </li>
            ),
          )}
        </ol>
      </section>

      <section ref={formRef} aria-labelledby="request-heading" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-lg bg-surface p-5 shadow-[0_0_0_1px_var(--color-line),0_12px_32px_-24px_rgb(22_24_29/0.4)] sm:p-6">
          <h3 id="request-heading" className="text-lg font-extrabold">
            <span className="mr-2 font-serif text-base font-normal text-subtle">3</span>
            {reschedule ? "Your new time" : "Your request"}
          </h3>

          <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
            {reschedule && (
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">Current</dt>
                <dd className="text-right font-semibold text-ink-soft">{reschedule.currentLabel}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">Room</dt>
              <dd className="font-bold">{roomName}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">Date</dt>
              <dd className="font-bold">{dateLabel}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">Time</dt>
              <dd className="text-right font-bold">
                {start && end ? (
                  <>
                    {formatTimeRange(start, end)}
                    <span className="block text-xs font-semibold text-muted">{durationLabel(start, end)}</span>
                  </>
                ) : (
                  <span className="font-semibold text-subtle">Choose a time</span>
                )}
              </dd>
            </div>
          </dl>

          {blockedByGoogle ? (
            <div className="mt-5">
              <div className="flex gap-3">
                <CalendarCheck2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="font-extrabold">Connect Google Calendar to continue</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Approved bookings are added to your Google Calendar automatically. Connect it once, and we&apos;ll bring you right back here.
                  </p>
                </div>
              </div>
              <a href={`/api/google/connect?returnTo=${encodeURIComponent(returnTo)}`} className={buttonStyles({ className: "mt-5 w-full" })}>
                Connect Google Calendar
              </a>
            </div>
          ) : !start ? (
            <p className="mt-5 text-sm text-muted">{anyAvailable && !problem ? "Pick a start time to fill in the details." : "No times can be requested for this day."}</p>
          ) : (
            <form
              className="mt-5 space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                submit(new FormData(event.currentTarget));
              }}
            >
              {reschedule ? <input type="hidden" name="bookingId" value={reschedule.bookingId} /> : <input type="hidden" name="roomId" value={roomId} />}
              <input type="hidden" name="date" value={dateKey} />
              <input type="hidden" name="startTime" value={timeKeyInZone(start)} />

              {state && !state.ok && (
                <Notice
                  tone="error"
                  action={
                    state.code === "calendar_required" ? (
                      <a href={`/api/google/connect?returnTo=${encodeURIComponent(returnTo)}`} className="text-sm font-bold underline">
                        Connect
                      </a>
                    ) : undefined
                  }
                >
                  {state.error}
                </Notice>
              )}

              <Field id="endTime" label="Ends" error={errors.endTime}>
                <Select
                  id="endTime"
                  name="endTime"
                  value={end ? timeKeyInZone(end) : ""}
                  onChange={(event) => setSelectedEnd(endOptions.find((option) => timeKeyInZone(option) === event.target.value) ?? null)}
                >
                  {endOptions.map((option) => (
                    <option key={option} value={timeKeyInZone(option)}>
                      {formatTime(option)} · {durationLabel(start, option)}
                    </option>
                  ))}
                </Select>
              </Field>

              {!reschedule && (
                <>
                  <Field id="eventName" label="Event name" error={errors.eventName}>
                    <Input id="eventName" name="eventName" maxLength={120} required placeholder="e.g. Youth worship practice" aria-invalid={Boolean(errors.eventName)} aria-describedby={describedBy("eventName", errors.eventName)} />
                  </Field>

                  <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
                    <Field id="eventType" label="Type" error={errors.eventType}>
                      <Select id="eventType" name="eventType" defaultValue="" required aria-invalid={Boolean(errors.eventType)} aria-describedby={describedBy("eventType", errors.eventType)}>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {EVENT_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field id="attendeeCount" label="People" error={errors.attendeeCount}>
                      <Input
                        id="attendeeCount"
                        name="attendeeCount"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={capacity}
                        required
                        placeholder={`≤ ${capacity}`}
                        aria-invalid={Boolean(errors.attendeeCount)}
                        aria-describedby={describedBy("attendeeCount", errors.attendeeCount)}
                      />
                    </Field>
                  </div>

                  <Field id="purpose" label="Purpose" error={errors.purpose} hint={purposeHint}>
                    <Textarea id="purpose" name="purpose" maxLength={1000} rows={3} required aria-invalid={Boolean(errors.purpose)} aria-describedby={describedBy("purpose", errors.purpose, purposeHint)} />
                  </Field>
                </>
              )}

              <SubmitButton className="w-full" size="lg" pending={pending} pendingLabel="Sending request…">
                {reschedule ? "Request reschedule" : `Request ${end ? formatTimeRange(start, end) : "booking"}`}
              </SubmitButton>
              <p className="text-center text-xs leading-relaxed text-muted">
                {reschedule
                  ? "Your current booking stays confirmed until the church office approves the new time."
                  : "Pending until the church office approves it. You'll get an email either way."}
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
