import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export class InviteError extends Error {
  constructor(
    message: string,
    public code?: string,
    public attemptsLeft?: number,
  ) {
    super(message);
  }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const b = await error.context.json().catch(() => null);
      throw new InviteError(
        b?.message ?? "Something went wrong. Please try again.",
        b?.code,
        typeof b?.attempts_left === "number" ? b.attempts_left : undefined,
      );
    }
    throw new InviteError("Could not reach the server. Check your connection.");
  }
  return data as T;
}

export type InviteResult = {
  ok: true;
  email: string;
  expires_at: string;
  ttl_minutes: number;
  /** 8 characters, returned ONCE. Never store, log or email it. */
  invite_code: string;
};

/** Existing admin only. Emails the activation link; returns the invite code once, for the inviter to hand over. */
export const inviteAdmin = (input: { name: string; email: string }) =>
  call<InviteResult>("admin-invite", input);

/** Public. Link check only (no code needed yet). Returns the masked email if the link is still valid. */
export const checkInvite = (token: string) =>
  call<{ valid: true; email: string }>("admin-activate", { action: "check", token });

/** Public. Needs link + invite code. Sets the invitee's own password and activates the account. */
export const activateInvite = (token: string, code: string, password: string) =>
  call<{ ok: true }>("admin-activate", { action: "activate", token, code, password });