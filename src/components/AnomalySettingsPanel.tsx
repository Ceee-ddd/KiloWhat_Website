import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, Badge, type Tone } from "@/components/kit";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ANOMALY_RANGES,
  anomalySettingsKey,
  getAnomalySettings,
  saveAnomalySettings,
  type AnomalyPatch,
  type AnomalySettings,
} from "@/lib/anomalySettings";

type Editable = Omit<AnomalySettings, "updated_at" | "updated_by">;
type Draft = { [K in keyof Editable]: Editable[K] extends number ? number | "" : Editable[K] };
type RangeKey = keyof typeof ANOMALY_RANGES;

const pick = (s: AnomalySettings): Draft => ({
  surge_pct: s.surge_pct,
  surge_min_watts: s.surge_min_watts,
  sag_floor_v: s.sag_floor_v,
  overvoltage_v: s.overvoltage_v,
  offline_after_min: s.offline_after_min,
  flag_zero_usage: s.flag_zero_usage,
  zero_usage_hours: s.zero_usage_hours,
  flag_reverse_energy: s.flag_reverse_energy,
  critical_rule: s.critical_rule,
  warning_rule: s.warning_rule,
  resolve_rule: s.resolve_rule,
  notify_landlord: s.notify_landlord,
  group_repeat_flags: s.group_repeat_flags,
  escalate_after_hours: s.escalate_after_hours,
});

const inRange = (k: RangeKey, v: number | "") => {
  const [lo, hi] = ANOMALY_RANGES[k];
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
};

const input = "h-9 w-full rounded-lg border border-border bg-card px-3 text-[11px] font-semibold text-ink outline-none focus:border-brand";

const Label = ({ children, hint }: { children: ReactNode; hint?: string }) => (
  <p className="mb-2 text-xs font-semibold text-ink">{children} {hint && <span className="font-medium text-subtle opacity-70">{hint}</span>}</p>
);

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-base font-semibold text-ink">{title}</p>{extra}</div>
      {children}
    </Card>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-[18px] w-11 shrink-0 rounded-full transition-colors", on ? "bg-brand" : "bg-toggle-off")}
    >
      <span className={cn("absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-card transition-all", on ? "left-[26px]" : "left-0.5")} />
    </button>
  );
}

function ToggleRow({ title, desc, on, onChange }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-3">
      <div><p className="text-xs font-semibold text-ink">{title}</p><p className="text-[10px] text-subtle">{desc}</p></div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  );
}

function NumField({ k, value, unit, onChange }: { k: RangeKey; value: number | ""; unit?: string; onChange: (v: number | "") => void }) {
  const ok = inRange(k, value);
  const [lo, hi] = ANOMALY_RANGES[k];
  return (
    <div>
      <div className={cn("flex min-w-0 rounded-lg border bg-card", ok ? "border-border" : "border-danger")}>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          aria-invalid={!ok}
          className="h-9 min-w-0 w-full flex-1 bg-transparent px-3 text-[11px] font-semibold text-ink outline-none"
        />
        {unit && <span className="flex w-[90px] shrink-0 items-center justify-center border-l border-border text-[10px] font-medium text-subtle">{unit}</span>}
      </div>
      {!ok && <p className="mt-1 text-[10px] text-danger">Enter a whole number from {lo} to {hi}.</p>}
    </div>
  );
}

function SelectField({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(input, "w-[155px]")}>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

function Form({ saved }: { saved: AnomalySettings }) {
  const qc = useQueryClient();
  const base = pick(saved);
  const [d, setD] = useState<Draft>(base);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const changed = (Object.keys(base) as (keyof Draft)[]).filter((k) => d[k] !== base[k]);
  const invalid = (Object.keys(ANOMALY_RANGES) as RangeKey[]).some((k) => !inRange(k, d[k]));
  const sagVsOver = typeof d.sag_floor_v === "number" && typeof d.overvoltage_v === "number" && d.sag_floor_v >= d.overvoltage_v;

  const save = useMutation({
    mutationFn: () => saveAnomalySettings(Object.fromEntries(changed.map((k) => [k, d[k]])) as AnomalyPatch),
    onSuccess: (row) => {
      qc.setQueryData(anomalySettingsKey, row);
      toast.success("Anomaly settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sevRows: [string, Tone, keyof Draft, string[]][] = [
    ["Critical", "danger", "critical_rule", ["Overload, Cutoff", "Overload only"]],
    ["Warning", "warn", "warning_rule", ["Voltage sag, Surge", "Surge only"]],
    ["Resolved", "brand", "resolve_rule", ["Auto after 7 days normal", "Manual only"]],
  ];

  return (
    <div className="flex flex-col gap-12">
      <Section
        title="Default detection thresholds"
        extra={<span className="rounded-full bg-brand-soft px-3.5 py-1 text-[10px] font-semibold text-brand-bright">Updated {new Date(saved.updated_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}</span>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:gap-x-14">
          <div><Label hint="% above the previous reading">Unusual surge</Label><NumField k="surge_pct" value={d.surge_pct} unit="%" onChange={(v) => set("surge_pct", v)} /></div>
          <div><Label hint="ignore smaller jumps">Minimum jump</Label><NumField k="surge_min_watts" value={d.surge_min_watts} unit="W" onChange={(v) => set("surge_min_watts", v)} /></div>
          <div><Label hint="brownout below this">Voltage sag floor</Label><NumField k="sag_floor_v" value={d.sag_floor_v} unit="V" onChange={(v) => set("sag_floor_v", v)} /></div>
          <div><Label hint="flag above this">Overvoltage ceiling</Label><NumField k="overvoltage_v" value={d.overvoltage_v} unit="V" onChange={(v) => set("overvoltage_v", v)} /></div>
          <div><Label hint="box silent this long">Mark offline after</Label><NumField k="offline_after_min" value={d.offline_after_min} unit="minutes" onChange={(v) => set("offline_after_min", v)} /></div>
          <div><Label hint="on an occupied unit">Zero-usage window</Label><NumField k="zero_usage_hours" value={d.zero_usage_hours} unit="hours" onChange={(v) => set("zero_usage_hours", v)} /></div>
        </div>
        {sagVsOver && <p className="mt-3 text-[10px] text-danger">The sag floor must be lower than the overvoltage ceiling.</p>}
        <div className="mt-3">
          <ToggleRow title="Flag reverse energy" desc="Current flowing back into the grid — usually a wiring fault or a tampered meter." on={d.flag_reverse_energy} onChange={(v) => set("flag_reverse_energy", v)} />
          <ToggleRow title="Flag zero usage on an occupied unit" desc="No consumption for the zero-usage window on a unit with an active tenant." on={d.flag_zero_usage} onChange={(v) => set("flag_zero_usage", v)} />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Severity">
          {sevRows.map(([l, t, k, o]) => (
            <div key={l} className="flex items-center justify-between border-t border-border py-3">
              <Badge tone={t}>{l}</Badge>
              <SelectField value={d[k] as string} options={o} onChange={(v) => set(k, v as never)} />
            </div>
          ))}
        </Section>
        <Section title="Handling">
          <ToggleRow title="Notify the landlord" desc="The property owner sees the flag in their app, not just the admin queue." on={d.notify_landlord} onChange={(v) => set("notify_landlord", v)} />
          <ToggleRow title="Group repeat flags" desc="The same anomaly on the same unit stays one entry instead of filling the queue." on={d.group_repeat_flags} onChange={(v) => set("group_repeat_flags", v)} />
          <div className="mt-10"><Label hint="hours">Escalate if unacknowledged after</Label><NumField k="escalate_after_hours" value={d.escalate_after_hours} onChange={(v) => set("escalate_after_hours", v)} /></div>
        </Section>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="mr-auto text-[11px] text-subtle">{changed.length ? `${changed.length} unsaved change${changed.length > 1 ? "s" : ""}` : "All changes saved"}</span>
        <Button type="button" variant="outline" disabled={!changed.length || save.isPending} onClick={() => setD(base)}>Discard</Button>
        <Button type="button" disabled={!changed.length || invalid || sagVsOver || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export function AnomalySettingsPanel() {
  const q = useQuery({ queryKey: anomalySettingsKey, queryFn: getAnomalySettings });
  return (
    <QueryState query={q}>
      {/* key: after a save the form re-initialises from the row the database returned */}
      {(row) => <Form key={row.updated_at} saved={row} />}
    </QueryState>
  );
}