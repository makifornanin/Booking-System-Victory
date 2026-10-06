import { z } from "zod";
import { parseLocalDateTimeInput } from "@/lib/domain/time";

const localDateTime = (label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parsed = parseLocalDateTimeInput(value);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: `Enter a valid ${label}.` });
        return z.NEVER;
      }
      return parsed;
    });

export const announcementFieldsSchema = z
  .object({
    internalTitle: z
      .string()
      .trim()
      .min(1, { error: "Enter an internal title." })
      .max(120, { error: "Keep the title under 120 characters." }),
    publishAt: localDateTime("publish date"),
    expiresAt: z
      .string()
      .trim()
      .optional()
      .transform((value, ctx) => {
        if (!value) return null;
        const parsed = parseLocalDateTimeInput(value);
        if (!parsed) {
          ctx.addIssue({ code: "custom", message: "Enter a valid expiry date." });
          return z.NEVER;
        }
        return parsed;
      }),
    publish: z
      .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
      .optional()
      .transform((value) => value === "on" || value === "true"),
  })
  .refine((data) => !data.expiresAt || data.expiresAt.getTime() > data.publishAt.getTime(), {
    error: "Expiry must be after the publish date.",
    path: ["expiresAt"],
  });

export type AnnouncementFields = z.infer<typeof announcementFieldsSchema>;

export const announcementIdSchema = z.object({ id: z.uuid({ error: "Unknown announcement." }) });

export const announcementPublishSchema = z.object({
  id: z.uuid({ error: "Unknown announcement." }),
  publish: z.enum(["true", "false"]).transform((value) => value === "true"),
});
