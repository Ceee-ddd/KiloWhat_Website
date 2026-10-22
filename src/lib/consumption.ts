import { rpc } from "./queries";
import { getTariff } from "./tariff";

/* ---------- Periods (Asia/Manila days, no DST) ---------- */
export type Period = "Week" | "Month" | "Year";
export type Bucket = "day" | "month";

const TZ = "Asia/Manila";
const ymdNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+08:00`).toISOString();

/** Range sent to the database. Called inside queryFn, so the query key stays a plain string. */
export function periodRange(p: Period): { from: string; to: string; bucket: Bucket; days: number } {
  const today = ymdNow();
  const to = startOf(addDays(today, 1));
  if (p === "Week") return { from: startOf(addDays(today, -6)), to, bucket: "day", days: 7 };
  if (p === "Month") return { from: startOf(addDays(today, -29)), to, bucket: "day", days: 30 };
  const [y, m] = today.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - 11;
  const first = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
  const from = startOf(first);
  return { from, to, bucket: "month", days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) };
}

/* ---------- Formatting ---------- */
export const fmtKwh = (v: number) => (v === 0 ? "0" : v < 1 ? v.toFixed(3) : v < 100 ? v.toFixed(2) : v.toFixed(1));
export const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPower = (w: number | null) => (w == null ? "—" : w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`);
export const fmtPct = (c: number | null) => (c == null ? "—" : `${c > 0 ? "+" : ""}${c.toFixed(1)}%`);
export const fmtStamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }) : "No readings yet");
export const fmtBucket = (iso: string, b: Bucket) =>
  new Date(iso).toLocaleDateString("en-US", b === "month" ? { month: "short", year: "numeric", timeZone: TZ } : { month: "short", day: "2-digit", timeZone: TZ });

/** Up to 4 evenly spaced, unique labels for a chart axis. */
export function axisLabels(series: SeriesPoint[], b: Bucket): string[] {
  const n = series.length;
  if (n === 0) return [];
  const idx = [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];
  return [...new Set(idx)].map((i) => fmtBucket(series[i]!.bucket, b));
}

/* ---------- Fallback rate (average of the rates units have set) ---------- */
export type FallbackRate = { rate: number; source: "average" | "default"; unitsWithRate: number };

export async function fetchFallbackRate(): Promise<FallbackRate> {
  const rows = await rpc<{ rate: number | string; source: string; units_with_rate: number }[]>("admin_fallback_rate", { p_default_rate: getTariff().rate });
  const r = rows?.[0];
  return r
    ? { rate: Number(r.rate), source: r.source === "average" ? "average" : "default", unitsWithRate: r.units_with_rate }
    : { rate: getTariff().rate, source: "default", unitsWithRate: 0 };
}
/** Shared query options: the rate changes rarely, so it is cached for 5 minutes. */
export const fallbackRateQuery = { queryKey: ["fallback-rate"], queryFn: fetchFallbackRate, staleTime: 5 * 60_000 };
export const fallbackShort = (f: FallbackRate | undefined) =>
  f ? (f.source === "average" ? `avg ₱${f.rate.toFixed(2)} for others` : `₱${f.rate.toFixed(2)} default for others`) : "…";
export const fallbackNote = (f: FallbackRate | undefined) =>
  f ? (f.source === "average" ? `₱${f.rate.toFixed(2)}/kWh (average of the rates set by units)` : `₱${f.rate.toFixed(2)}/kWh (default estimate, no unit has a rate yet)`) : "…";

/* ---------- Dashboard ---------- */
export type DashboardStats = {
  units: number; boxes: number; boxesOnline: number;
  kwhMonth: number; costMonth: number; kwhPrevMonth: number; lastReadingAt: string | null;
};

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const d = await rpc<{ units: number; boxes: number; boxes_online: number; kwh_month: number; cost_month: number; kwh_prev_month: number; last_reading_at: string | null }>("admin_dashboard_stats", { p_default_rate: getTariff().rate });
  return {
    units: Number(d.units ?? 0), boxes: Number(d.boxes ?? 0), boxesOnline: Number(d.boxes_online ?? 0),
    kwhMonth: Number(d.kwh_month ?? 0), costMonth: Number(d.cost_month ?? 0), kwhPrevMonth: Number(d.kwh_prev_month ?? 0),
    lastReadingAt: d.last_reading_at ?? null,
  };
}

/* ---------- Series (charts and daily table) ---------- */
export type SeriesPoint = { bucket: string; kwh: number };

export async function fetchSeries(period: Period, code: string | null): Promise<{ points: SeriesPoint[]; bucket: Bucket }> {
  const r = periodRange(period);
  const rows = await rpc<{ bucket: string; kwh: number }[]>("admin_energy_series", {
    p_from: r.from, p_to: r.to, p_code: code, p_bucket: r.bucket,
  });
  return { points: (rows ?? []).map((x) => ({ bucket: x.bucket, kwh: Number(x.kwh) })), bucket: r.bucket };
}

/* ---------- Units ---------- */
export type UnitSort = "code" | "kwh" | "cost" | "change";
export const UNIT_PAGE_SIZE = 15;

export type UnitEnergy = {
  code: string; name: string | null; rate: number | null; kwh: number; prevKwh: number; cost: number; changePct: number | null;
  peakW: number | null; lastReadingAt: string | null; boxCount: number; boxesOnline: number; linked: string;
};

type RawUnit = {
  unit_code: string; unit_name: string | null; rate_per_kwh: number | string | null; kwh: number; prev_kwh: number; cost: number;
  change_pct: number | null; peak_w: number | null; last_reading_at: string | null; box_count: number; boxes_online: number;
  linked: string | null; total_count: number;
};

export async function fetchUnitEnergy(period: Period, sort: UnitSort, desc: boolean, page: number, code: string | null = null): Promise<{ rows: UnitEnergy[]; total: number }> {
  const r = periodRange(period);
  const data = await rpc<RawUnit[]>("admin_unit_energy", {
    p_from: r.from, p_to: r.to, p_default_rate: getTariff().rate, p_code: code,
    p_sort: sort, p_desc: desc, p_limit: UNIT_PAGE_SIZE, p_offset: page * UNIT_PAGE_SIZE,
  });
  const rows = (data ?? []).map((u) => ({
    code: u.unit_code, name: u.unit_name, rate: u.rate_per_kwh == null ? null : Number(u.rate_per_kwh),
    kwh: Number(u.kwh), prevKwh: Number(u.prev_kwh), cost: Number(u.cost), changePct: u.change_pct == null ? null : Number(u.change_pct),
    peakW: u.peak_w == null ? null : Number(u.peak_w), lastReadingAt: u.last_reading_at,
    boxCount: u.box_count, boxesOnline: u.boxes_online, linked: u.linked ?? "",
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export type UnitInfo = {
  code: string; name: string | null; rate: number | null; createdAt: string; boxCount: number; boxesOnline: number;
  lastSeen: string | null; lastReadingAt: string | null; linked: { name: string; memberRole: string | null }[];
};

/** Returns null when the unit code does not exist. */
export async function fetchUnitInfo(code: string): Promise<UnitInfo | null> {
  const data = await rpc<{
    code: string; name: string | null; rate_per_kwh: number | string | null; created_at: string; box_count: number; boxes_online: number;
    last_seen: string | null; last_reading_at: string | null; linked: { name: string; member_role: string | null }[] | null;
  }[]>("admin_unit_info", { p_code: code });
  const u = data?.[0];
  if (!u) return null;
  return {
    code: u.code, name: u.name, rate: u.rate_per_kwh == null ? null : Number(u.rate_per_kwh), createdAt: u.created_at,
    boxCount: u.box_count, boxesOnline: u.boxes_online, lastSeen: u.last_seen, lastReadingAt: u.last_reading_at,
    linked: (u.linked ?? []).map((l) => ({ name: l.name, memberRole: l.member_role })),
  };
}