import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Activity, TriangleAlert, Home } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, TrendChart, AxisLabels, Legend, type Tone } from "@/components/kit";
import { systemTrend, activityLog } from "@/lib/data";
import { useStore } from "@/lib/store";
import { fetchUserCounts } from "@/lib/users";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Dashboard Overview — KiloWhat Admin" },
      { name: "description", content: "System-wide submeter consumption, users and anomaly overview for KiloWhat administrators." },
      { property: "og:title", content: "Dashboard Overview — KiloWhat Admin" },
      { property: "og:description", content: "System-wide submeter consumption, users and anomaly overview." },
    ],
  }),
  component: Dashboard,
});

const toneOf: Record<string, Tone> = { danger: "danger", warn: "warn", info: "info" };

function Stat({ label, icon: Icon, value, sub, extra }: { label: string; icon: typeof Users; value: string; sub: string; extra?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
        <p className="pt-1.5 text-sm font-medium uppercase tracking-wide text-subtle">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted"><Icon className="h-4 w-4 text-brand" /></span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="text-2xl font-bold 2xl:text-3xl text-ink">{value}</p>
        {extra}
      </div>
      <p className="mt-4 text-sm text-subtle">{sub}</p>
    </Card>
  );
}

function Dashboard() {
  const anomalies = useStore((s) => s.anomalies);
  const counts = useQuery({ queryKey: ["user-counts"], queryFn: fetchUserCounts });
  const c = counts.data;
  return (
    <AdminLayout title="Dashboard Overview">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4 2xl:gap-6">
        <Stat label="Total Users" icon={Users} value={c ? c.total.toLocaleString() : "—"} sub={c ? `${c.landlord} Landlords · ${c.tenant} Tenants · ${c.individual} Indiv.` : counts.isError ? "Could not load" : "Loading…"} />
        <Stat label="Consumption this month" icon={Activity} value="42,850 kWh" sub="Approx. ₱364,225 total cost" />
        <Stat label="Active Anomalies" icon={TriangleAlert} value={String(anomalies.filter((a) => a.status === "Open").length)} extra={<Badge tone="danger">Critical</Badge>} sub="Overload & leak patterns flagged" />
        <Stat label="Registered Units" icon={Home} value="912" sub="98.5% reporting data online" />
      </div>

      <Card className="mt-6 p-6">
        <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
          <div>
            <p className="text-base font-semibold text-ink">System-Wide Consumption Trend</p>
            <p className="text-sm text-subtle">System-wide kWh usage monitoring for the last 30 days</p>
          </div>
          <Legend items={[{ label: "Usage (kWh)" }]} />
        </div>
        <div className="mt-4"><TrendChart data={systemTrend} height={210} /></div>
        <AxisLabels labels={["30 days ago", "20 days ago", "10 days ago", "Today"]} />
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
        <Card className="p-6">
          <p className="mb-4 text-base font-semibold text-ink">Recent Anomalies flagged</p>
          <div className="flex flex-col gap-3">
            {anomalies.map((a) => (
              <Link key={a.id} to="/anomaly-flags/$id" params={{ id: a.id }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted">
                <div>
                  <p className="text-sm font-semibold text-ink">{a.unit}{a.unit.startsWith("Unit") ? ` (${a.owner.includes("Individual") ? "Individual" : "Tenant"})` : ""}</p>
                  <p className="text-xs text-subtle">{a.detected}</p>
                </div>
                <Badge tone={toneOf[a.badge] ?? "info"}>{a.short}</Badge>
              </Link>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <p className="mb-4 text-base font-semibold text-ink">System Activity Log</p>
          <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
<table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-subtle">
                <th className="px-3 py-2 font-medium">Event Description</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 text-right font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {activityLog.map((r) => (
                <tr key={r.event} className="border-b border-border last:border-0">
                  <td className="max-w-[190px] truncate px-3 py-2.5 text-ink">{r.event}</td>
                  <td className="px-3 py-2.5 text-ink">{r.actor}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-subtle">{r.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Card>
      </div>
    </AdminLayout>
  );
}