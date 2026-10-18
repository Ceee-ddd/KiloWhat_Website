import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDownWideNarrow } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, Pagination, TrendChart, AxisLabels, Legend, changeTone, fmtChange } from "@/components/kit";
import { units, analyticsTrend, peso } from "@/lib/data";

export const Route = createFileRoute("/consumption-analytics/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Consumption Analytics — KiloWhat Admin" },
      { name: "description", content: "Per-unit kWh consumption, cost and period-over-period change." },
      { property: "og:title", content: "Consumption Analytics — KiloWhat Admin" },
      { property: "og:description", content: "Per-unit kWh consumption, cost and change." },
    ],
  }),
  component: Analytics,
});

type P = "Week" | "Month" | "Year";
type K = "unit" | "owner" | "kwh" | "cost" | "change";

function Analytics() {
  const [period, setPeriod] = useState<P>("Month");
  const [sort, setSort] = useState<{ k: K; desc: boolean } | null>(null);
  const data = period === "Week" ? analyticsTrend.slice(-7) : period === "Year" ? analyticsTrend.filter((_, i) => i % 2 === 0) : analyticsTrend;
  const rows = [...units].sort((a, b) => {
    if (!sort) return 0;
    const r = a[sort.k] > b[sort.k] ? 1 : -1;
    return sort.desc ? -r : r;
  });
  const H = ({ k, label }: { k: K; label: string }) => (
    <th className="py-4">
      <button onClick={() => setSort({ k, desc: sort?.k === k ? !sort.desc : true })} className="flex items-center gap-1 uppercase">
        {label} <ArrowDownWideNarrow className="h-3 w-3" />
      </button>
    </th>
  );
  return (
    <AdminLayout title="Consumption Analytics">
      <Tabs<P> value={period} onChange={setPeriod} items={["Week", "Month", "Year"].map((v) => ({ value: v as P, label: v }))} />
      <Card className="mt-6 p-6">
        <div className="flex min-w-0 flex-col items-start justify-between gap-3 xl:flex-row">
          <div>
            <p className="text-base font-semibold text-ink">System-Wide Consumption Trend</p>
            <p className="text-sm text-subtle">Total power usage pattern monitored over the current {period.toLowerCase()}</p>
          </div>
          <Legend items={[{ label: "Daily Consumption (kWh)" }, { label: "Average Limit (150 kWh)", muted: true }]} />
        </div>
        <div className="mt-4"><TrendChart data={data} height={200} endDot refLine /></div>
        <AxisLabels labels={["30 days ago", "20 days ago", "10 days ago", "Today (280 kWh)"]} />
      </Card>
      <Card className="mt-6 overflow-hidden">
        <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
<table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface">
            <tr className="border-b border-border text-left text-xs font-semibold text-subtle">
              <th className="w-6" /><H k="unit" label="Unit / Household" /><H k="owner" label="Owner" /><H k="kwh" label="kWh Consumed" /><H k="cost" label="Est. Cost" /><H k="change" label="% vs Prev Period" />
              <th className="px-6 py-4 text-right uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.unit} className="border-b border-border last:border-0">
                <td /><td className="py-4 font-semibold text-ink">{u.unit}</td><td className="text-ink">{u.owner}</td>
                <td className="font-semibold text-ink">{u.kwh.toFixed(1)} kWh</td><td className="text-ink">{peso(u.cost).replace("₱", "₱ ")}</td>
                <td><Badge tone={changeTone(u.change)}>{fmtChange(u.change)}</Badge></td>
                <td className="px-6 text-right">
                  <Link to="/consumption-analytics/$unit" params={{ unit: u.unit.replace("Unit ", "") }} className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-subtle hover:bg-brand-soft hover:text-brand">Inspect</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
      <Pagination label="Showing 8 of 912 registered units" last={114} />
    </AdminLayout>
  );
}
