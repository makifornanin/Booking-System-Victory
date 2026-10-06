import { z } from "zod";
import { dateKeySchema } from "@/lib/validation/booking";

export const roomSlugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const uuidParamSchema = z.uuid();

export const adminBookingTabSchema = z.enum(["pending", "approved", "denied"]).catch("pending");

export const adminUserTabSchema = z.enum(["pending", "active", "denied", "revoked"]).catch("pending");

export function parseRoomSlug(value: string): string | null {
  const result = roomSlugSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseUuid(value: unknown): string | null {
  const result = uuidParamSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseDateKey(value: unknown): string | null {
  const result = dateKeySchema.safeParse(value);
  return result.success ? result.data : null;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
