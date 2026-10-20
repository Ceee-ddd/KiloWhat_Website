import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export class InviteError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const b = await error.context.json().catch(() => null);
      throw new InviteError(b?.message ?? "Something went wrong. Please try again.", b?.code);
    }
    throw new InviteError("Could not reach the server. Check your connection.");
  }
  return data as T;
}

/** Existing admin only. Sends an activation link to the new admin's email. */
export const inviteAdmin = (input: { name: string; email: string }) =>
  call<{ ok: true; email: string; expires_at: string; ttl_minutes: number }>("admin-invite", input);

/** Public. Returns the masked email if the link is still valid. */
export const checkInvite = (token: string) =>
  call<{ valid: true; email: string }>("admin-activate", { action: "check", token });

/** Public. Sets the invitee's own password and activates the account. */
export const activateInvite = (token: string, password: string) =>
  call<{ ok: true }>("admin-activate", { action: "activate", token, password });