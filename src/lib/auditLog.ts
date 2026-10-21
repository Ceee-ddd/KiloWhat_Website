import { supabase } from "./supabase";

export type AuditRow = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  name?: string | null; // from profiles, when readable
  action: string;
  target: string | null;
  ip: string | null;
};

export type AuditFilters = {
  admin: string; // substring of actor email
  action: string; // "" = all
  from: string; // yyyy-mm-dd or ""
  to: string; // yyyy-mm-dd or ""
};

export const emptyFilters: AuditFilters = { admin: "", action: "", from: "", to: "" };
export const PAGE_SIZE = 15;
const EXPORT_CAP = 5000;
const COLS = "id, at, actor_id, actor_email, action, target, ip";
const HIDDEN = ["invite_code_failed"]; // still recorded in the database, just not listed here

/** Known actions -> readable label and badge tone. Unknown ones are shown as-is. */
export const ACTIONS: Record<string, { label: string; tone: "brand" | "danger" | "warn" | "info" | "gray" }> = {
  login: { label: "Signed in", tone: "brand" },
  logout: { label: "Signed out", tone: "gray" },
  invite_sent: { label: "Sent invitation", tone: "info" },
  invite_activated: { label: "Activated account", tone: "brand" },
  invite_expired: { label: "Invitation expired", tone: "gray" },
  invite_failed: { label: "Invitation failed", tone: "danger" },
  invite_burned: { label: "Invitation cancelled (too many wrong codes)", tone: "danger" },
  invite_rate_limited: { label: "Invitation blocked (rate limit)", tone: "warn" },
  admin_disabled: { label: "Disabled an account", tone: "danger" },
  admin_enabled: { label: "Enabled an account", tone: "brand" },
  password_changed: { label: "Changed own password", tone: "info" },
  profile_updated: { label: "Changed own name", tone: "info" },
  password_confirm_failed: { label: "Wrong password on confirmation", tone: "warn" },
  rate_limited: { label: "Request blocked (rate limit)", tone: "warn" },
};
export const actionLabel = (a: string) => ACTIONS[a]?.label ?? a;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apply(q: any, f: AuditFilters) {
  q = q.not("action", "in", `(${HIDDEN.join(",")})`);
  if (f.admin.trim()) q = q.ilike("actor_email", `%${f.admin.trim().replace(/[%_\\]/g, "\\$&")}%`);
  if (f.action) q = q.eq("action", f.action);
  if (f.from) q = q.gte("at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    q = q.lt("at", end.toISOString());
  }
  return q;
}

/** Adds each admin's full name (profiles.full_name). If profiles are not readable, the email is shown instead. */
async function withNames(rows: AuditRow[]): Promise<AuditRow[]> {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  if (!ids.length) return rows;
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  const names = new Map<string, string | null>((data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));
  return rows.map((r) => ({ ...r, name: (r.actor_id && names.get(r.actor_id)) || null }));
}

export async function fetchAuditPage(f: AuditFilters, page: number): Promise<{ rows: AuditRow[]; total: number }> {
  const from = page * PAGE_SIZE;
  const q = apply(supabase.from("admin_audit_log").select(COLS, { count: "exact" }), f)
    .order("at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const { data, error, count } = await q;
  if (error) throw new Error("Could not load the activity log.");
  return { rows: await withNames((data ?? []) as AuditRow[]), total: count ?? 0 };
}

/** Most recent change made by an admin (anything that is not a login or logout). */
export async function fetchLastChange(): Promise<AuditRow | null> {
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select(COLS)
    .not("action", "in", `(login,logout,${HIDDEN.join(",")})`)
    .order("at", { ascending: false })
    .limit(1);
  if (error) throw new Error("Could not load the last change.");
  return (await withNames((data ?? []) as AuditRow[]))[0] ?? null;
}

/** Everything matching the filters, up to EXPORT_CAP rows, as CSV text. */
export async function exportAuditCsv(f: AuditFilters): Promise<string> {
  const rows: AuditRow[] = [];
  for (let from = 0; from < EXPORT_CAP; from += 1000) {
    const { data, error } = await apply(supabase.from("admin_audit_log").select(COLS), f)
      .order("at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error("Could not export the activity log.");
    rows.push(...(await withNames((data ?? []) as AuditRow[])));
    if (!data || data.length < 1000) break;
  }
  // Prefix risky leading characters so spreadsheets do not run a cell as a formula.
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ["Time", "Admin", "Email", "Action", "Target", "IP"];
  const lines = rows.map((r) => [new Date(r.at).toISOString(), r.name, r.actor_email, actionLabel(r.action), r.target, r.ip].map(cell).join(","));
  return [head.map(cell).join(","), ...lines].join("\r\n");
}