import { createHmac } from "node:crypto";
import type { BookingDetails } from "@/lib/data/types";
import { dateKeyInZone, timeKeyInZone } from "@/lib/domain/time";
import type { BookingStatusChange, BookingStatusNotifier } from "@/lib/services/status-notifier";

export interface StatusWebhookPayload {
  event: `booking.${BookingStatusChange}`;
  eventId: string;
  occurredAt: string;
  bookingId: string;
  phone: string | null;
  room: string;
  eventName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: BookingStatusChange;
  denialReason?: string | null;
}

/** Minimal, secret-free payload: who to message (the requester's phone) and what changed. */
export function buildStatusPayload(booking: BookingDetails, status: BookingStatusChange, now = new Date()): StatusWebhookPayload {
  return {
    event: `booking.${status}`,
    eventId: `${booking.id}.${status}`,
    occurredAt: now.toISOString(),
    bookingId: booking.id,
    phone: booking.requester.phone,
    room: booking.room.name,
    eventName: booking.eventName,
    date: dateKeyInZone(booking.startTime),
    startTime: timeKeyInZone(booking.startTime),
    endTime: timeKeyInZone(booking.endTime),
    status,
    ...(status === "denied" ? { denialReason: booking.denialReason } : {}),
  };
}

/** Hex HMAC-SHA256 of `${timestamp}.${body}` — n8n recomputes it to verify the request. */
export function signStatusWebhook(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export interface DeliveryOptions {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
  /** Delays between attempts; the default retries twice (0.5 s, then 2 s). */
  retryDelaysMs?: number[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POSTs the signed payload. Retries only network errors, 429 and 5xx; the event
 * id stays the same on every attempt so n8n can ignore repeats. Returns null on
 * success or a short error description.
 */
export async function deliverStatusWebhook(payload: StatusWebhookPayload, options: DeliveryOptions): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = JSON.stringify(payload);
  const delays = options.retryDelaysMs ?? [500, 2000];
  let lastError = "not sent";

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const response = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "VictoryBookingSystem/1.0",
          "X-Victory-Event": payload.event,
          "X-Victory-Event-Id": payload.eventId,
          "X-Victory-Timestamp": String(timestamp),
          "X-Victory-Signature": `sha256=${signStatusWebhook(body, options.secret, timestamp)}`,
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return null;
      lastError = `n8n responded HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) return lastError;
    } catch (error) {
      lastError = error instanceof Error && error.name === "TimeoutError" ? "n8n did not respond in time" : "n8n could not be reached";
    }
  }
  return lastError;
}

export interface NotifierOptions extends DeliveryOptions {
  /** Runs work after the response is sent (next/server `after` in production). */
  schedule: (task: () => Promise<void>) => void;
  /** Stores the delivery result on the booking. */
  record: (bookingId: string, status: BookingStatusChange, error: string | null) => Promise<void>;
}

/** Sends a notification for WhatsApp bookings only, after the response, never throwing. */
export function createStatusNotifier(options: NotifierOptions): BookingStatusNotifier {
  return {
    bookingStatusChanged(booking, status) {
      if (booking.source !== "whatsapp") return;
      const payload = buildStatusPayload(booking, status);
      options.schedule(async () => {
        const error = await deliverStatusWebhook(payload, options).catch(() => "delivery failed");
        if (error) console.error(`[notify] ${payload.event} for booking ${booking.id}: ${error}`);
        await options.record(booking.id, status, error).catch((e) => console.error("[notify] could not record result:", e instanceof Error ? e.message : e));
      });
    },
  };
}
