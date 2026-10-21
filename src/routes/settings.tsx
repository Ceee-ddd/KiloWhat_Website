import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, Toggle, type Tone } from "@/components/kit";
import { AddAdminDialog } from "@/components/AddAdminDialog";
import { AdminActivityLog } from "@/components/AdminActivityLog";
import { useSession } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { listAdmins } from "@/lib/admins";
import { AdminDetailsDialog } from "@/components/AdminDetailsDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Settings — KiloWhat Admin" },
      { name: "description", content: "Platform, anomaly detection, submeter and alert settings for KiloWhat." },
      { property: "og:title", content: "Settings — KiloWhat Admin" },
      { property: "og:description", content: "Platform, anomaly detection, submeter and alert settings." },
    ],
  }),
  component: SettingsPage,
});

type T = "platform" | "anomaly" | "submeters" | "alerts" | "admins" | "activity";

const Label = ({ children, hint }: { children: ReactNode; hint?: string }) => (
  <p className="mb-2 text-xs font-semibold text-ink">{children} {hint && <span className="font-medium text-subtle opacity-70">{hint}</span>}</p>
);
const input = "h-9 w-full rounded-lg border border-border bg-card px-3 text-[11px] font-semibold text-ink outline-none focus:border-brand";
const Num = ({ v, unit }: { v: number; unit?: string }) => (
  <div className="flex min-w-0 rounded-lg border border-border bg-card">
    <input type="number" defaultValue={v} className="h-9 min-w-0 w-full flex-1 bg-transparent px-3 text-[11px] font-semibold text-ink outline-none" />
    {unit && <span className="flex w-[90px] shrink-0 items-center justify-center border-l border-border text-[10px] font-medium text-subtle">{unit}</span>}
  </div>
);
const Select = ({ options, w = "w-[155px]" }: { options: string[]; w?: string }) => (
  <select className={cn(input, w)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
);
const Row = ({ title, desc, small = false }: { title: string; desc: string; small?: boolean }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-3">
    <div><p className="text-xs font-semibold text-ink">{title}</p><p className="text-[10px] text-subtle">{desc}</p></div>
    <Toggle small={small} />
  </div>
);
const Section = ({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) => (
  <Card className="p-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-base font-semibold text-ink">{title}</p>{extra}</div>
    {children}
  </Card>
);

function SettingsPage() {
  const [tab, setTab] = useState<T>("platform");
  const [interval, setInterval] = useState("5 min");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const session = useSession();
  const admins = useQuery({ queryKey: ["admins"], queryFn: listAdmins, enabled: tab === "admins" });
  return (
    <AdminLayout title="Settings">
      <Tabs<T> value={tab} onChange={setTab} items={[{ value: "platform", label: "Platform" }, { value: "anomaly", label: "Anomaly detection" }, { value: "submeters", label: "Submeters" }, { value: "alerts", label: "Alerts & logs" }, { value: "admins", label: "Administrators" }, { value: "activity", label: "Admin activity" }]} />
      <div className="mt-6 sm:mt-12">
        {tab === "platform" && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-7">
            <Section title="Platform identity">
              <div className="flex flex-col gap-3">
                <div><Label>System name</Label><input className={input} defaultValue="KiloWhat" /></div>
                <div><Label>Support email</Label><input className={input} defaultValue="support@kilowhat.ph" /></div>
                <div><Label>Currency</Label><Select options={["Php -- Philippine peso", "USD -- US dollar"]} /></div>
                <div><Label>Time zone</Label><Select options={["(GMT+ 8) Asia/Manila", "(GMT+ 9) Asia/Tokyo"]} /></div>
              </div>
            </Section>
            <Section title="Registration">
              <Row title="Open sign-up" desc="Anyone can create an account and choose landlord, tenant, or individual." />
              <Row title="Require email verification" desc="A 6-digit code must be entered before the account activates." />
              <div className="mt-20"><Label hint="minutes">Verification code expires after</Label><Num v={10} /></div>
            </Section>
          </div>
        )}
        {tab === "anomaly" && (
          <div className="flex flex-col gap-12">
            <Section title="Default detection thresholds" extra={<span className="rounded-full bg-brand-soft px-3.5 py-1 text-[10px] font-semibold text-brand-bright">live on 91 meters</span>}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:gap-x-14">
                <div><Label>Threshold limit</Label><Num v={150} unit="kWh / day" /></div>
                <div><Label>Unusual surge</Label><Num v={60} unit="% above avg" /></div>
                <div><Label>Voltage sag floor</Label><Num v={200} unit="V" /></div>
              </div>
              <div className="mt-3">
                <Row small title="Flag reverse energy" desc="Current flowing back into the grid — usually a wiring fault or a tampered meter." />
                <Row small title="Flag zero usage on an occupied unit" desc="No consumption for 48 hours on a unit with an active tenant." />
              </div>
            </Section>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Section title="Severity">
                {([["Critical", "danger", ["Overload, Cutoff", "Overload only"]], ["Warning", "warn", ["Voltage sag, Surge", "Surge only"]], ["Resolved", "brand", ["Auto after 7 days normal", "Manual only"]]] as [string, Tone, string[]][]).map(([l, t, o]) => (
                  <div key={l} className="flex items-center justify-between border-t border-border py-3">
                    <Badge tone={t}>{l}</Badge><Select options={o} />
                  </div>
                ))}
              </Section>
              <Section title="Handling">
                <Row title="Notify the landlord" desc="The property owner see the flag in their app, not just the admin queue." />
                <Row title="Group repeat flags" desc="The same anomaly on the same unit stays one entry instead of filling the queue." />
                <div className="mt-10"><Label hint="hours">Escalate if unacknowledged after</Label><Num v={24} /></div>
              </Section>
            </div>
          </div>
        )}
        {tab === "submeters" && (
          <div className="flex flex-col gap-12">
            <Section title="Reporting">
              <Label>Reading interval</Label>
              <div className="mb-4 flex w-full max-w-[294px] overflow-hidden rounded-md border border-ink">
                {["1 min", "5 min", "15 min"].map((v) => (
                  <button key={v} onClick={() => setInterval(v)} className={cn("min-w-0 flex-1 py-2 text-xs", v !== "1 min" && "border-l border-ink", interval === v ? "bg-brand-bright text-primary-foreground" : "bg-card text-ink")}>{v}</button>
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <div><Label hint="minutes with no reading">Mark offline after</Label><Num v={150} /></div>
                <div><Label hint="minutes">Gateway heartbeat</Label><Num v={200} /></div>
              </div>
            </Section>
            <Section title="Balance & Cutoff">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:gap-14">
                <div><Label>Low Balance Alert</Label><Num v={100} unit="₱" /></div>
                <div><Label>Cutoff at</Label><Num v={0} unit="₱" /></div>
              </div>
              <Row small title="Automatic relay cutoff" desc="The submeter cuts power when a unit hits cutoff balance" />
              <div className="mt-6"><Label hint="hours">Grace period before cutoff</Label><Num v={12} /></div>
            </Section>
          </div>
        )}
        {tab === "alerts" && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-7">
            <Section title="Activity log">
              <p className="-mt-5 mb-3 max-w-[370px] text-[10px] text-subtle">Every threshold change, suspension, and firmware deploy is recorded with the admin who did it.</p>
              <div className="flex flex-col gap-3">
                <div><Label>Keep log entries for</Label><Select w="w-full" options={["12 months", "6 months", "24 months"]} /></div>
                <div><Label>Keep meter readings for</Label><Select w="w-full" options={["12 months", "6 months", "24 months"]} /></div>
                <p className="text-[10px] text-subtle">Readings older than this are deleted permanently. Billing totals are kept either way.</p>
              </div>
              <div className="mt-7 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border pt-3">
                <div><p className="text-xs font-semibold text-ink">Export data</p><p className="text-[10px] text-subtle">Readings, users, and the activity log as CSV.</p></div>
                <button onClick={() => toast.success("CSV export started")} className="rounded-md border border-border px-3 py-2 text-[10px] text-subtle hover:bg-muted">Export CSV</button>
              </div>
            </Section>
            <Section title="Admin Alerts">
              <Row title="Critical anomalies" desc="Overload, cutoff, or reverse energy on any meter." />
              <Row title="Gateway offline" desc="A whole building stops reporting." />
              <Row title="Weekly system digest" desc="Total consumption, open flags, and new accounts, sent Monday morning." />
              <div className="mt-6"><Label>Send to</Label><input className={input} defaultValue="KiloWhat@gmail.com" /></div>
            </Section>
          </div>
        )}
        {tab === "admins" && (
          <Section
            title="Administrators"
            extra={<Button onClick={() => setAddOpen(true)}>Add Admin</Button>}
          >
            {admins.isError ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                Could not load administrators. <button type="button" className="underline" onClick={() => admins.refetch()}>Try again</button>
              </p>
            ) : (
              <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-border text-left text-xs font-semibold uppercase text-subtle"><th className="py-3 pr-4">Name</th><th className="py-3 pr-4">Email</th><th className="py-3 pr-4">Role</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Invited by</th><th className="py-3">Added</th></tr></thead>
                  <tbody>
                    {admins.isLoading && <tr><td colSpan={6} className="py-6 text-center text-xs text-subtle">Loading…</td></tr>}
                    {admins.data?.map((a) => (
                      <tr key={a.id} onClick={() => setSelectedId(a.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                        <td className="py-3 pr-4 font-semibold text-ink"><button type="button" onClick={() => setSelectedId(a.id)} className="text-left font-semibold hover:underline">{a.name}</button>{session?.adminId === a.id && <span className="ml-2 text-[10px] font-medium text-subtle">(you)</span>}</td>
                        <td className="py-3 pr-4 text-ink">{a.email}</td>
                        <td className="py-3 pr-4"><Badge tone="info">Admin</Badge></td>
                        <td className="py-3 pr-4"><Badge tone={a.status === "Active" ? "brand" : a.status === "Pending" ? "warn" : "danger"}>{a.status}</Badge></td>
                        <td className="py-3 pr-4 text-subtle">{a.invited_by ?? "—"}</td>
                        <td className="py-3 text-subtle">{new Date(a.added).toLocaleDateString(undefined, { dateStyle: "medium" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}
        {tab === "activity" && <AdminActivityLog />}
      </div>
      <AddAdminDialog open={addOpen} onOpenChange={setAddOpen} />
      <AdminDetailsDialog
        key={selectedId ?? "none"}
        admin={admins.data?.find((a) => a.id === selectedId) ?? null}
        isSelf={!!selectedId && session?.adminId === selectedId}
        onClose={() => setSelectedId(null)}
      />
    </AdminLayout>
  );
}