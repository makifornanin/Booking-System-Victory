import { z } from "zod";
import { normalizePhone } from "@/lib/domain/phone";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }));

const password = z
  .string()
  .min(8, { error: "Use at least 8 characters." })
  .max(72, { error: "Use at most 72 characters." });

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }).max(72),
});

const phone = z
  .string()
  .trim()
  .min(1, { error: "Enter your mobile number." })
  .max(32, { error: "That phone number is too long." })
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid mobile number, e.g. 0917 123 4567 or +63 917 123 4567." });
      return z.NEVER;
    }
    return normalized;
  });

export const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { error: "Enter your full name." })
    .max(120, { error: "Keep your name under 120 characters." }),
  email,
  phone,
  password,
});

export const passwordResetRequestSchema = z.object({ email });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Enter your current password." }).max(72),
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const passwordResetSchema = z
  .object({
    token: z.string().min(10, { error: "This reset link is invalid. Request a new one." }).max(512),
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });
