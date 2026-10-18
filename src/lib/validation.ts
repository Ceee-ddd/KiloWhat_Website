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
