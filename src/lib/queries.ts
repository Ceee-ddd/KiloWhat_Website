import { supabase } from "./supabase";

/** Dashboard device status refreshes this often (only while the tab is visible). */
export const POLL_MS = 30_000;

/**
 * Calls a Supabase RPC and returns its data.
 * Database messages are never shown to the user or logged; only a plain message is thrown.
 */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === "42501") throw new Error("You do not have access to this data.");
    throw new Error("Could not load the data. Please try again.");
  }
  return data as T;
}