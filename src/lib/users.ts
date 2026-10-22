import { rpc } from "./queries";

export type UserRole = "Landlord" | "Tenant" | "Individual";
export type UserFilter = "All" | UserRole;
export const USER_PAGE_SIZE = 15;

export type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  joined: string; // ISO
  lastSignIn: string | null;
  status: "Active" | "Suspended";
  units: string; // linked unit names, "" when none
};

export type UserUnit = { code: string; name: string | null; memberRole: string | null; linkedAt: string };
export type UserDetail = Omit<UserRow, "role" | "units"> & { roles: UserRole[]; units: UserUnit[] };
export type UserCounts = { landlord: number; tenant: number; individual: number; total: number };

const label = (r: string): UserRole => (r === "landlord" ? "Landlord" : r === "tenant" ? "Tenant" : "Individual");

type RawRow = {
  id: string; name: string; email: string; phone: string | null; role: string; joined: string;
  last_sign_in_at: string | null; suspended: boolean; units: string | null; total_count: number;
};

export async function fetchUsers(filter: UserFilter, search: string, page: number): Promise<{ rows: UserRow[]; total: number }> {
  const data = await rpc<RawRow[]>("admin_users_list", {
    p_role: filter === "All" ? null : filter.toLowerCase(),
    p_search: search.trim() || null,
    p_limit: USER_PAGE_SIZE,
    p_offset: page * USER_PAGE_SIZE,
  });
  const rows = (data ?? []).map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, role: label(r.role), joined: r.joined,
    lastSignIn: r.last_sign_in_at, status: r.suspended ? ("Suspended" as const) : ("Active" as const), units: r.units ?? "",
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export async function fetchUserCounts(): Promise<UserCounts> {
  const d = await rpc<UserCounts>("admin_user_counts");
  return { landlord: d.landlord ?? 0, tenant: d.tenant ?? 0, individual: d.individual ?? 0, total: d.total ?? 0 };
}

type RawDetail = Omit<RawRow, "role" | "units" | "total_count"> & {
  roles: string[] | null;
  units: { code: string; name: string | null; member_role: string | null; linked_at: string }[] | null;
};

/** Returns null when the user does not exist (or is an administrator). */
export async function fetchUserDetail(id: string): Promise<UserDetail | null> {
  const data = await rpc<RawDetail[]>("admin_user_detail", { p_id: id });
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, joined: r.joined, lastSignIn: r.last_sign_in_at,
    status: r.suspended ? "Suspended" : "Active", roles: (r.roles ?? []).map(label),
    units: (r.units ?? []).map((u) => ({ code: u.code, name: u.name, memberRole: u.member_role, linkedAt: u.linked_at })),
  };
}

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—";
export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Never";