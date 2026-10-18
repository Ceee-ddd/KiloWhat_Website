import { useSyncExternalStore } from "react";
import { users as seedUsers, archivedUsers as seedArchive, anomalies as seedAnomalies, admins as seedAdmins } from "./data";
import type { User, ArchivedUser, Anomaly, Admin } from "./data";
import { adminSchema, userProfileSchema, newUserSchema, fieldErrors, type Result } from "./validation";

type State = { users: User[]; archive: ArchivedUser[]; anomalies: Anomaly[]; admins: Admin[] };
let state: State = { users: seedUsers, archive: seedArchive, anomalies: seedAnomalies, admins: seedAdmins };

/** Test helper: restore the seed data. */
export function resetStore() {
  state = { users: seedUsers, archive: seedArchive, anomalies: seedAnomalies, admins: seedAdmins };
  listeners.forEach((l) => l());
}

export const findAdminByEmail = (email: string) =>
  state.admins.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
const listeners = new Set<() => void>();

export function setState(fn: (s: State) => State) {
  state = fn(state);
  listeners.forEach((l) => l());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
    () => sel(state),
  );
}

export const toggleUserStatus = (id: string) =>
  setState((s) => ({
    ...s,
    users: s.users.map((u) =>
      u.id === id ? { ...u, status: u.status === "Active" ? "Suspended" : "Active" } : u,
    ),
  }));

export const restoreUser = (id: string) =>
  setState((s) => ({ ...s, archive: s.archive.filter((a) => a.id !== id) }));

export const resolveAnomaly = (id: string) =>
  setState((s) => ({
    ...s,
    anomalies: s.anomalies.map((a) => (a.id === id ? { ...a, status: "Resolved" } : a)),
  }));

const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });

/**
 * Demo-only: adds an administrator record to the in-memory store.
 * With real auth, replace this with the provider's secure invitation / account-creation flow.
 */
export function addAdmin(input: unknown): Result<Admin> {
  const parsed = adminSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { name, email, role } = parsed.data;
  if (findAdminByEmail(email)) return { ok: false, errors: { email: "An administrator with this email already exists." } };
  const n = state.admins.reduce((m, a) => Math.max(m, Number(a.id.replace("ADM-", "")) || 0), 0) + 1;
  const admin: Admin = { id: `ADM-${String(n).padStart(3, "0")}`, name, email, role, status: "Active", added: today() };
  setState((s) => ({ ...s, admins: [...s.admins, admin] }));
  return { ok: true, data: admin };
}

/** Adds a validated user to the demo store; replace with a database mutation later. */
export function addUser(input: unknown): Result<User> {
  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (state.users.some((u) => u.email.toLowerCase() === parsed.data.email)) {
    return { ok: false, errors: { email: "A user with this email already exists." } };
  }
  const n = state.users.reduce((max, u) => Math.max(max, Number(u.id.replace("USR-", "")) || 0), 0) + 1;
  const user: User = { ...parsed.data, id: `USR-${String(n).padStart(3, "0")}`, status: "Active", joined: today() };
  setState((s) => ({ ...s, users: [...s.users, user] }));
  return { ok: true, data: user };
}

/** Updates a user's editable profile fields in the mock store. */
export function updateUser(id: string, input: unknown): Result<User> {
  const existing = state.users.find((u) => u.id === id);
  if (!existing) return { ok: false, errors: { form: "This user no longer exists." } };
  const parsed = userProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const clash = state.users.some((u) => u.id !== id && u.email.toLowerCase() === parsed.data.email);
  if (clash) return { ok: false, errors: { email: "Another user already uses this email." } };
  const updated: User = { ...existing, ...parsed.data };
  setState((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? updated : u)) }));
  return { ok: true, data: updated };
}
