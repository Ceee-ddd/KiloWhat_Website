/**
 * DEMO-ONLY mock authentication. Not secure: credentials are checked in the browser
 * against in-memory demo records and the "session" is a plain localStorage entry.
 *
 * Everything the UI needs goes through `authService` (AuthService). To move to Lovable
 * Cloud / Supabase Auth later, implement the same interface with the provider's calls
 * and swap the export — the login page, route gate and logout button stay unchanged.
 */
import { useSyncExternalStore } from "react";
import type { AdminRole } from "./data";
import { findAdminByEmail } from "./store";

export type Session = { adminId: string; name: string; email: string; role: AdminRole };

export interface AuthService {
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Session | null;
  subscribe(listener: () => void): () => void;
}

export const DEMO_ADMIN = { email: "admin@kilowhat.ph", password: "demo1234" } as const;
const KEY = "kilowhat.demo.session";

export class AuthError extends Error {}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

let cachedRaw: string | null | undefined;
let cached: Session | null = null;

function read(): Session | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = null;
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p.adminId === "string" && typeof p.email === "string" && typeof p.name === "string" && typeof p.role === "string") cached = { adminId: p.adminId, email: p.email, name: p.name, role: "Admin" };
    } catch {
      /* ignore corrupt session */
    }
  }
  return cached;
}

export const mockAuthService: AuthService = {
  async signIn(email, password) {
    await new Promise((r) => setTimeout(r, 350));
    const admin = findAdminByEmail(email);
    if (!admin || password !== DEMO_ADMIN.password) throw new AuthError("Invalid email or password.");
    if (admin.status !== "Active") throw new AuthError("This administrator account is disabled.");
    const session: Session = { adminId: admin.id, name: admin.name, email: admin.email, role: admin.role };
    window.localStorage.setItem(KEY, JSON.stringify(session));
    notify();
    return session;
  },
  async signOut() {
    window.localStorage.removeItem(KEY);
    notify();
  },
  getSession: read,
  subscribe(listener) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => e.key === KEY && listener();
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  },
};

export const authService: AuthService = mockAuthService;

/** `undefined` while the browser session has not been read yet (server render / hydration), `null` when signed out. */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(authService.subscribe, authService.getSession, () => undefined);
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  if (value === "/login" || value.startsWith("/login?")) return undefined;
  return value;
}
