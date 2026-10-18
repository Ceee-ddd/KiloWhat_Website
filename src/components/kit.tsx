import { useEffect, useState, type ReactNode } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Tone = "brand" | "danger" | "warn" | "info" | "violet" | "teal" | "gray";
const tones: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  violet: "bg-violet-soft text-violet",
  teal: "bg-teal-soft text-teal",
  gray: "bg-muted text-subtle border border-border",
};
export function Badge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}
export const roleTone = (r: string): Tone => (r === "Landlord" ? "violet" : r === "Tenant" ? "info" : "teal");

/** Blank placeholder shown wherever a user's picture would go. */
export function UserAvatar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("shrink-0 rounded-full bg-muted border border-border", className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-xl border border-border bg-card", className)}>{children}</div>;
}

export function Tabs<T extends string>({ items, value, onChange }: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap gap-2">
      {items.map((i) => (
        <Button
          variant="outline"
          key={i.value}
          onClick={() => onChange(i.value)}
          className={cn(
            "h-auto min-h-9 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:px-4",
            value === i.value ? "border-brand bg-brand-soft font-semibold text-brand" : "border-border bg-card text-subtle hover:bg-muted",
          )}
        >
          {i.label}
        </Button>
      ))}
    </div>
  );
}

export function Pagination({ label, last }: { label: string; last: number }) {
  const [p, setP] = useState(1);
  const btn = "rounded-md border border-border bg-card px-3 py-1 text-sm text-subtle hover:bg-muted";
  return (
    <div className="mt-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <p className="text-sm text-subtle">{label}</p>
      <div className="flex max-w-full flex-wrap items-center gap-1.5">
        <button className={btn} onClick={() => setP(Math.max(1, p - 1))}>Previous</button>
        {[1, 2, 3].map((n) => (
          <button key={n} onClick={() => setP(n)} className={cn(btn, "min-w-8", p === n && "border-brand bg-brand-soft font-semibold text-brand")}>{n}</button>
        ))}
        {last > 3 && (
          <>
            <span className="text-subtle">...</span>
            <button onClick={() => setP(last)} className={cn(btn, p === last && "border-brand bg-brand-soft text-brand")}>{last}</button>
          </>
        )}
        <button className={btn} onClick={() => setP(Math.min(last, p + 1))}>Next</button>
      </div>
    </div>
  );
}

export function Toggle({ defaultOn = true, small = false }: { defaultOn?: boolean; small?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => setOn(!on)}
      className={cn("relative shrink-0 rounded-full transition-colors", small ? "h-[18px] w-11" : "h-6 w-12", on ? "bg-brand" : "bg-toggle-off")}
    >
      <span className={cn("absolute top-1/2 -translate-y-1/2 rounded-full bg-card transition-all", small ? "h-4 w-4" : "h-5 w-5", on ? (small ? "left-[26px]" : "left-[26px]") : "left-0.5")} />
    </button>
  );
}

export function TrendChart({ data, color = "var(--brand)", height = 200, endDot, refLine }: { data: number[]; color?: string; height?: number; endDot?: boolean; refLine?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const rows = data.map((v, i) => ({ i, v }));
  if (!mounted) return <div style={{ height }} />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <YAxis hide domain={[0, refLine ? 100 : "auto"]} />
          <Tooltip formatter={(v) => [`${v} kWh`, "Usage"]} labelFormatter={() => ""} />
          <Line type="linear" dataKey="v" stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          {endDot && <ReferenceDot x={rows.length - 1} y={data[data.length - 1] ?? 0} r={4} fill={color} stroke="none" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AxisLabels({ labels }: { labels: string[] }) {
  return (
    <div className="mt-3 flex justify-between gap-2 text-[10px] text-subtle sm:text-xs">
      {labels.map((l) => <span key={l}>{l}</span>)}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; muted?: boolean; color?: string }[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
      {items.map((i) => (
        <span key={i.label} className={cn("flex items-center gap-1.5 text-xs sm:text-sm", i.muted ? "text-subtle" : "font-semibold text-ink")}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", i.muted ? "bg-subtle" : i.color ?? "bg-brand")} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function StatCard({ label, value, sub, extra }: { label: string; value: ReactNode; sub: string; extra?: ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-sm text-subtle">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 font-medium text-ink">{value}{extra}</div>
      <p className="mt-1 text-xs text-subtle">{sub}</p>
    </Card>
  );
}

export function DetailRows({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mt-1">
        {rows.map(([k, v], i) => (
          <div key={k} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 py-2 text-sm", i < rows.length - 1 && "border-b border-border")}>
            <span className="text-subtle">{k}</span>
            <span className="break-words text-right font-semibold text-ink">{v}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export const changeTone = (c: number): Tone => (c > 0 ? "danger" : "brand");
export const fmtChange = (c: number) => `${c > 0 ? "+" : ""}${c}%`;
