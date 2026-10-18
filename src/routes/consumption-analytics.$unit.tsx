import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ArrowDownWideNarrow } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, Pagination, TrendChart, AxisLabels, Legend, StatCard, DetailRows, changeTone, fmtChange } from "@/components/kit";
import { units, unitTrend, dailyReadings, peso } from "@/lib/data";

export const Route = createFileRoute("/consumption-analytics/$unit")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Unit Consumption Detail — KiloWhat Admin" },
      { name: "description", content: "Daily meter readings, cost and peak demand for a single unit." },
      { property: "og:title", content: "Unit Consumption Detail — KiloWhat Admin" },
      { property: "og:description", content: "Daily meter readings, cost and peak demand for a unit." },
    ],
  }),
  component: UnitDetail,
});

type P = "Week" | "Month" | "Year";

function UnitDetail() {
  const { unit } = Route.useParams();
  const u = units.find((x) => x.unit === `Unit ${unit}`) ?? units[0];
  const [period, setPeriod] = useState<P>("Month");
  if (!u) throw notFound();
  return (
    <AdminLayout title="Consumption Analytics">
      <Link to="/consumption-analytics" className="inline-flex items-center gap-3 rounded-md bg-card px-4 py-1.5 text-sm text-ink"><ChevronLeft className="h-4 w-4" />Back to all units</Link>
      <div className="mt-4"><Tabs<P> value={period} onChange={setPeriod} items={["Week", "Month", "Year"].map((v) => ({ value: v as P, label: v }))} /></div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:mt-14 2xl:grid-cols-4 2xl:gap-5">
        <StatCard label="kWh consumed" value={<span>76.2 <span className="text-[10px]">kWh</span></span>} extra={<Badge tone={changeTone(u.change)}>{fmtChange(u.change)}</Badge>} sub="Compared with previous month" />
        <StatCard label="Est. cost" value={peso(u.cost)} sub="At ₱8.50 per kWh" />
        <StatCard label="Daily average" value="10.7 kWh" sub="Average unit: 9.5 kWh" />
        <StatCard label="Peak demand" value="1.8 kW" sub="Sep 12, 7:30 PM" />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-4 2xl:mt-14 2xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="p-6">
          <div className="flex min-w-0 flex-col items-start justify-between gap-3 xl:flex-row">
            <div>
              <p className="text-base font-semibold text-ink">System-Wide Consumption Trend</p>
              <p className="text-sm text-subtle">Total power usage pattern monitored over the current month</p>
            </div>
            <Legend items={[{ label: "Daily Consumption (kWh)" }, { label: "Average Limit (150 kWh)", muted: true }]} />
          </div>
          <div className="mt-4"><TrendChart data={unitTrend} height={200} endDot refLine /></div>
          <AxisLabels labels={["30 days ago", "20 days ago", "10 days ago", "Today (280 kWh)"]} />
        </Card>
        <DetailRows title="Unit details" rows={[["Owner", u.owner], ["Contact", "0917 123 4567"], ["Submeter ID", `SM-${unit}-014`], ["Meter status", "Online"], ["Last reading", "Sep 10"], ["Tariff rate", "₱8.50 / kWh"], ["Billing cycle", "Sep 1 – Sep 30"]]} />
      </div>

      <Card className="mt-6 max-w-[825px] overflow-hidden">
        <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
<table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface">
            <tr className="border-b border-border text-left text-xs font-semibold text-subtle">
              <th className="px-6 py-4">Date</th><th className="py-4">Meter reading</th>
              {["kWh Consumed", "Est. Cost", "% vs Prev Period"].map((h) => <th key={h} className="py-4 uppercase"><span className="flex items-center gap-1">{h}<ArrowDownWideNarrow className="h-3 w-3" /></span></th>)}
            </tr>
          </thead>
          <tbody>
            {dailyReadings.map((r) => (
              <tr key={r.date} className="border-b border-border last:border-0">
                <td className="px-6 py-4 font-semibold text-ink">{r.date}</td><td className="text-ink">{r.reading}</td>
                <td className="font-semibold text-ink">{r.kwh} kWh</td><td className="text-ink">₱ {r.cost.toFixed(2)}</td>
                <td><Badge tone={changeTone(r.change)}>{fmtChange(r.change)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
      <div className="max-w-[825px]"><Pagination label="Showing 6 of 30 Daily readings" last={5} /></div>
    </AdminLayout>
  );
}
