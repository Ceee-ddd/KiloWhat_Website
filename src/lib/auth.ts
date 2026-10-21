/**
 * Real authentication (Supabase Auth + new-device email check).
 *
 * Sign-in is two gates, same as the mobile app:
 *   1. email + password  (supabase.auth.signInWithPassword)
 *   2. device check      (register_session RPC; a browser the account has never used
 *                         must pass a 6-digit email code from the `device-otp` function)
 * Only a session that passed BOTH gates and belongs to an admin is exposed as `Session`.
 * Until then the UI sees `null`, and the database refuses to return any data
 * (is_admin() needs a verified session).
 *
 * Public surface used by the rest of the app: authService, useSession, usePhase,
 * safeRedirect, AuthError, Session.
 */
import { useSyncExternalStore } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { AdminRole } from "./data";
import { supabase } from "./supabase";

export type Session = { adminId: string; name: string; email: string; role: AdminRole };
export type Phase = "loading" | "signedOut" | "otp" | "signedIn";
export type SignInResult = "verified" | "otp_required";

export class AuthError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ device identity
const DEVICE_KEY = "kilowhat_device_id";
let memoryDeviceId: string | null = null;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 64-hex random secret per browser. Only its SHA-256 is stored on the server. */
function deviceId(): string {
  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved && saved.length >= 32 && saved.length <= 128) return saved;
    const fresh = randomHex(32);
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked: fall back to this tab only (an OTP will be asked each visit).
    return (memoryDeviceId ??= randomHex(32));
  }
}

function deviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os} (web admin)`;
}

const deviceBody = () => ({ device_id: deviceId(), device_name: deviceName(), platform: "web" });

// ------------------------------------------------------------------ state store
type State = { phase: Phase; session: Session | null };
let state: State = { phase: "loading", session: null };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  listeners.forEach((l) => l());
}
const signedOut = (): State => ({ phase: "signedOut", session: null });

/** Writes a login/logout row to the admin audit log. Never blocks or breaks sign-in/out. */
async function logSession(action: "login" | "logout"): Promise<void> {
  try {
    await supabase.rpc("log_session_event", { p_action: action });
  } catch {
    /* auditing is best-effort here */
  }
}

// ------------------------------------------------------------------ core flow
/** Looks at the stored Supabase session and works out what the UI may show. */
async function establish(): Promise<SignInResult | "none"> {
  const { data: sessionData } = await supabase.auth.getSession();
  const authSession = sessionData.session;
  if (!authSession) {
    setState(signedOut());
    return "none";
  }

  const { data: reg, error: regError } = await supabase.rpc("register_session", {
    p_device_id: deviceId(),
    p_device_name: deviceName(),
    p_platform: "web",
  });
  if (regError) {
    await supabase.auth.signOut();
    setState(signedOut());
    throw new AuthError("Could not verify this device. Please sign in again.");
  }

  if ((reg as { status?: string } | null)?.status === "otp_required") {
    setState({ phase: "otp", session: null });
    return "otp_required";
  }

  // Verified device -> must also be an administrator.
  const uid = authSession.user.id;
  const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  if (!roleRow) {
    await supabase.auth.signOut();
    setState(signedOut());
    throw new AuthError("This account does not have administrator access.", "not_admin");
  }
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle();

  setState({
    phase: "signedIn",
    session: {
      adminId: uid,
      name: profile?.full_name ?? authSession.user.email ?? "Administrator",
      email: authSession.user.email ?? "",
      role: "Admin",
    },
  });
  return "verified";
}

async function callDeviceOtp<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("device-otp", { body: { ...deviceBody(), ...body } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const b = await error.context.json().catch(() => null);
      throw new AuthError(b?.message ?? "Something went wrong. Please try again.", b?.code);
    }
    throw new AuthError("Could not reach the server. Check your connection.");
  }
  return data as T;
}

let initPromise: Promise<void> | null = null;

export const authService = {
  /** Reads the stored session once (call before trusting getSession). Safe to call many times. */
  init(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    initPromise ??= (async () => {
      supabase.auth.onAuthStateChange((event) => {
        // Only react to sign-out here (expiry, other tab). Sign-in is handled by signIn()/establish().
        if (event === "SIGNED_OUT") setState(signedOut());
      });
      try {
        await establish();
      } catch {
        /* establish already moved the state to signedOut */
      }
    })();
    return initPromise;
  },

  /** Step 1. Returns "verified" (signed in) or "otp_required" (code must be entered). */
  async signIn(email: string, password: string): Promise<SignInResult> {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      if (error.status === 429) throw new AuthError("Too many attempts. Please wait a few minutes and try again.", "rate_limited");
      throw new AuthError("Invalid email or password.", "invalid_credentials");
    }
    const result = await establish();
    if (result === "none") throw new AuthError("Could not sign in. Please try again.");
    if (result === "verified") await logSession("login");
    return result;
  },

  /** Step 2a. Emails a 6-digit code (the server limits how often). */
  sendOtp(): Promise<{ ok: true; already_sent?: boolean; resend_in?: number }> {
    return callDeviceOtp({ action: "send" });
  },

  /** Step 2b. Checks the code; on success this browser becomes trusted and we finish signing in. */
  async verifyOtp(code: string): Promise<void> {
    await callDeviceOtp({ action: "verify", code });
    const result = await establish();
    if (result !== "verified") throw new AuthError("Could not finish signing in. Please sign in again.");
    await logSession("login");
  },

  async signOut(): Promise<void> {
    if (state.phase === "signedIn") await logSession("logout"); // needs the session, so before signOut
    await supabase.auth.signOut();
    setState(signedOut());
  },

  /** After the admin renames themselves, keep the header in sync without a reload. */
  updateSessionName(name: string): void {
    if (state.session) setState({ ...state, session: { ...state.session, name } });
  },

  getSession(): Session | null {
    return state.session;
  },
  getPhase(): Phase {
    return state.phase;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** `undefined` until the stored session has been read (and on the server), `null` when signed out. */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(
    authService.subscribe,
    () => (state.phase === "loading" ? undefined : state.session),
    () => undefined,
  );
}

export function usePhase(): Phase {
  return useSyncExternalStore(authService.subscribe, authService.getPhase, () => "loading" as Phase);
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  if (value === "/login" || value.startsWith("/login?")) return undefined;
  return value;
}