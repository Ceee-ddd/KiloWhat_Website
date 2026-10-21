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

export type AdminRow = {
  id: string;
  name: string;
  email: string;
  status: "Active" | "Pending" | "Disabled";
  added: string;
  expires_at: string | null;
  invited_by: string | null;
  last_sign_in_at: string | null;
  devices: number;
};

/** Every administrator account (admin-only RPC; the database refuses anyone else). */
export async function listAdmins(): Promise<AdminRow[]> {
  const { data, error } = await supabase.rpc("admin_list");
  if (error) throw new Error("Could not load administrators.");
  return (data ?? []) as AdminRow[];
}

/** Disable or re-enable ANOTHER admin. The caller's own password is re-checked server-side (never stored or logged). */
export const setAdminStatus = (targetId: string, disable: boolean, password: string) =>
  call<{ ok: true; status: "Active" | "Disabled" }>("admin-set-status", { target_id: targetId, disable, password });

/** An admin may change only their own name. */
export async function updateOwnName(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_update_own_name", { p_name: name });
  if (error) throw new InviteError(error.message.includes("invalid_name") ? "Name must be 2 to 60 characters." : "Could not save your name. Please try again.", "invalid_name");
  return data as string;
}

/** Change MY OWN password. Needs the current one (checked server-side, never stored or logged). */
export const changeOwnPassword = (currentPassword: string, newPassword: string) =>
  call<{ ok: true }>("admin-change-password", { current_password: currentPassword, new_password: newPassword });