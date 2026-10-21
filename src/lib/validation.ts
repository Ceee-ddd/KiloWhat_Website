import { z, type ZodError } from "zod";
import { ADMIN_ROLES } from "./data";

export type FieldErrors = { name?: string; email?: string; phone?: string; role?: string; property?: string; form?: string };
export type Result<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

export const adminSchema = z.object({
  name: z.string().trim().min(2, "Enter the administrator's full name").max(100, "Name must be under 100 characters"),
  email: z.string().trim().toLowerCase().min(1, "Enter an email address").email("Enter a valid email address").max(255, "Email must be under 255 characters"),
  role: z.enum(ADMIN_ROLES, { errorMap: () => ({ message: "Administrator role must be Admin" }) }).default("Admin"),
});

export const userProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the user's full name").max(100, "Name must be under 100 characters"),
  email: z.string().trim().toLowerCase().min(1, "Enter an email address").email("Enter a valid email address").max(255, "Email must be under 255 characters"),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,19}$/, "Enter a valid phone number, e.g. +63 917 552 8841"),
  role: z.enum(["Landlord", "Tenant", "Individual"], { errorMap: () => ({ message: "Choose a role" }) }),
  property: z.string().trim().min(2, "Enter the assigned property or unit").max(120, "Must be under 120 characters"),
});

export const newUserSchema = userProfileSchema;

export function fieldErrors(err: ZodError): FieldErrors {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out as FieldErrors;
}

// ---- Admin invite activation (must match supabase/functions/admin-activate) ----
export const ADMIN_PASSWORD_MIN = 12;
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Admin password rules: 12+ chars, upper, lower, digit, special, max 72. Server enforces them again. */
export function adminPasswordProblem(p: string): string | null {
  if (p.length < ADMIN_PASSWORD_MIN) return `Use at least ${ADMIN_PASSWORD_MIN} characters.`;
  if (p.length > 72) return "Use 72 characters or fewer.";
  if (!/[a-z]/.test(p)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(p)) return "Add an uppercase letter.";
  if (!/[0-9]/.test(p)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(p)) return "Add a special character.";
  return null;
}

/** "abcd-efgh" / " ABCD EFGH " -> "ABCDEFGH", or null if it is not a valid 8-character code. */
export function normalizeInviteCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]+/g, "");
  return new RegExp(`^[${INVITE_CODE_ALPHABET}]{8}$`).test(c) ? c : null;
}

/** "ABCDEFGH" -> "ABCD-EFGH" (display and typing only). */
export function formatInviteCode(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}