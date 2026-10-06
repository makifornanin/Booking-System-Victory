import { z } from "zod";
import { EVENT_TYPES, type EventType } from "@/lib/config";
import { isValidDateKey, isValidTimeKey } from "@/lib/domain/time";

const eventTypeValues = EVENT_TYPES.map((type) => type.value) as [EventType, ...EventType[]];

export const dateKeySchema = z
  .string()
  .refine(isValidDateKey, { error: "Choose a valid date." });

export const timeKeySchema = z
  .string()
  .refine(isValidTimeKey, { error: "Choose a valid time." });

export const bookingRequestSchema = z.object({
  roomId: z.uuid({ error: "Unknown room." }),
  date: dateKeySchema,
  startTime: timeKeySchema,
  endTime: timeKeySchema,
  eventName: z
    .string()
    .trim()
    .min(2, { error: "Give your event a name (at least 2 characters)." })
    .max(120, { error: "Keep the event name under 120 characters." }),
  eventType: z.enum(eventTypeValues, { error: "Choose an event type." }),
  attendeeCount: z.coerce
    .number({ error: "Enter the expected number of attendees." })
    .int({ error: "Attendees must be a whole number." })
    .min(1, { error: "At least 1 attendee is required." })
    .max(1000, { error: "That attendee count is too high." }),
  purpose: z
    .string()
    .trim()
    .min(3, { error: "Briefly describe the purpose of the booking." })
    .max(1000, { error: "Keep the purpose under 1000 characters." }),
});

export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;

export const bookingIdSchema = z.object({
  bookingId: z.uuid({ error: "Unknown booking." }),
});

export const denialSchema = z.object({
  bookingId: z.uuid({ error: "Unknown booking." }),
  reason: z
    .string()
    .trim()
    .min(3, { error: "Enter a reason so the requester knows why." })
    .max(500, { error: "Keep the reason under 500 characters." }),
});

export type DenialInput = z.infer<typeof denialSchema>;
