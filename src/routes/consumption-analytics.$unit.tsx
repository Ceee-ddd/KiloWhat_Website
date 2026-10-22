import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, TrendChart, AxisLabels, Legend, StatCard, DetailRows, changeTone } from "@/components/kit";
import { QueryState } from "@/components/QueryState";
import { axisLabels, fetchSeries, fetchUnitEnergy, fetchUnitInfo, fmtBucket, fmtKwh, fmtPct, fmtPower, fmtStamp, periodRange, peso, type Period } from "@/lib/consumption";
import { getTariff } from "@/lib/tariff";
import { fmtDate } from "@/lib/users";

export const Route = createFileRoute("/consumption-analytics/$unit")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Unit Consumption Detail — KiloWhat Admin" },
      { name: "description", content: "Energy use, cost and peak demand for a single unit." },
      { property: "og:title", content: "Unit Consumption Detail — KiloWhat Admin" },
      { property: "og:description", content: "Energy use, cost and peak demand for a unit." },
    ],
  }),
  component: UnitDetail,
});

function UnitDetail() {
  const { unit: code } = Route.useParams();
  const [period, setPeriod] = useState<Period>("Month");

  const info = useQuery({ queryKey: ["unit-info", code], queryFn: () => fetchUnitInfo(code) });
  const energy = useQuery({ queryKey: ["unit-energy-one", code, period], queryFn: async () => (await fetchUnitEnergy(period, "code", false, 0, code)).rows[0] ?? null, placeholderData: keepPreviousData });
  const series = useQuery({ queryKey: ["energy-series", period, code], queryFn: () => fetchSeries(period, code), placeholderData: keepPreviousData });

  if (info.isSuccess && info.data === null) throw notFound();

  const u = info.data;
  const e = energy.data;
  const rate = u?.rate ?? getTariff().rate;
  const rateNote = u?.rate != null ? `At ₱${rate.toFixed(2)} per kWh (unit rate)` : `At ₱${rate.toFixed(2)} per kWh (default estimate)`;
  const days = periodRange(period).days;
  const label = period === "Week" ? "week" : period === "Month" ? "month" : "year";
  const bucket = series.data?.bucket ?? "day";
  const pts = series.data?.points ?? [];
  const rowsDesc = [...pts].map((p, i) => ({ ...p, prev: i > 0 ? pts[i - 1]!.kwh : null })).reverse();

  return (
    <AdminLayout title="Consumption Analytics">
      <Link to="/consumption-analytics" className="inline-flex items-center gap-3 rounded-md bg-card px-4 py-1.5 text-sm text-ink"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to all units</Link>
      <p className="mt-4 text-base font-semibold text-ink">{u ? (u.name || u.code) : "…"}{u?.name && <span className="ml-2 text-sm font-normal text-subtle">{u.code}</span>}</p>
      <div className="mt-3"><Tabs<Period> value={period} onChange={setPeriod} items={(["Week", "Month", "Year"] as Period[]).map((v) => ({ value: v, label: v }))} /></div>

      <div className="mt-6">
        <QueryState query={energy} rows={2}>
          {(x) => (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4 2xl:gap-5">
              <StatCard label="kWh consumed" value={<span>{fmtKwh(x?.kwh ?? 0)} <span className="text-[10px]">kWh</span></span>} extra={x?.changePct != null ? <Badge tone={changeTone(x.changePct)}>{fmtPct(x.changePct)}</Badge> : undefined} sub={`Compared with previous ${label}`} />
              <StatCard label="Est. cost" value={peso(x?.cost ?? 0)} sub={rateNote} />
              <StatCard label={period === "Year" ? "Monthly average" : "Daily average"} value={`${fmtKwh((x?.kwh ?? 0) / (period === "Year" ? 12 : days))} kWh`} sub={`Over the last ${period === "Year" ? "12 months" : `${days} days`}`} />
              <StatCard label="Peak demand" value={fmtPower(x?.peakW ?? null)} sub={x?.peakW == null ? "No readings in this period" : "Highest combined load in the period"} />
            </div>
          )}
        </QueryState>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="p-6">
          <div className="flex min-w-0 flex-col items-start justify-between gap-3 xl:flex-row">
            <div>
              <p className="text-base font-semibold text-ink">Unit Consumption Trend</p>
              <p className="text-sm text-subtle">Energy used by this unit over the {period === "Week" ? "last 7 days" : period === "Month" ? "last 30 days" : "last 12 months"}</p>
            </div>
            <Legend items={[{ label: bucket === "month" ? "Monthly Consumption (kWh)" : "Daily Consumption (kWh)" }]} />
          </div>
          <div className="mt-4">
            <QueryState query={series} rows={3}>
              {(d) => (
                <>
                  <TrendChart data={d.points.map((x) => Math.round(x.kwh * 1000) / 1000)} height={200} endDot />
                  {d.points.every((x) => x.kwh === 0)
                    ? <p className="mt-3 text-xs text-subtle">No consumption recorded in this period.</p>
                    : <AxisLabels labels={axisLabels(d.points, d.bucket)} />}
                </>
              )}
            </QueryState>
          </div>
        </Card>
        <QueryState query={info} rows={4}>
          {(i) => i && (
            <DetailRows
              title="Unit details"
              rows={[
                ["Unit", i.name || i.code],
                ["Code", i.code],
                ["Linked to", i.linked.length ? i.linked.map((l) => `${l.name}${l.memberRole ? ` (${l.memberRole})` : ""}`).join(", ") : "—"],
                ["Devices online", `${i.boxesOnline} of ${i.boxCount}`],
                ["Last reading", fmtStamp(i.lastReadingAt)],
                ["Tariff rate", i.rate != null ? `₱${i.rate.toFixed(2)} / kWh` : `₱${getTariff().rate.toFixed(2)} / kWh (default estimate)`],
                ["Registered", fmtDate(i.createdAt)],
              ]}
            />
          )}
        </QueryState>
      </div>

      <Card className="mt-6 max-w-[825px] overflow-hidden">
        <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface">
              <tr className="border-b border-border text-left text-xs font-semibold uppercase text-subtle">
                <th className="px-6 py-4">{bucket === "month" ? "Month" : "Date"}</th><th className="py-4">kWh Consumed</th><th className="py-4">Est. Cost</th><th className="py-4">% vs previous {bucket}</th>
              </tr>
            </thead>
            <tbody>
              {rowsDesc.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-6 text-center text-subtle">No data for this period.</td></tr>
              )}
              {rowsDesc.map((r) => {
                const chg = r.prev != null && r.prev > 0 ? ((r.kwh - r.prev) / r.prev) * 100 : null;
                return (
                  <tr key={r.bucket} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 font-semibold text-ink">{fmtBucket(r.bucket, bucket)}</td>
                    <td className="font-semibold text-ink">{fmtKwh(r.kwh)} kWh</td>
                    <td className="text-ink">{peso(r.kwh * rate)}</td>
                    <td>{chg == null ? <span className="text-subtle">—</span> : <Badge tone={changeTone(chg)}>{fmtPct(chg)}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminLayout>
  );
}