import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, TrendChart, AxisLabels, Legend, changeTone } from "@/components/kit";
import { QueryState } from "@/components/QueryState";
import { UNIT_PAGE_SIZE, axisLabels, fallbackNote, fallbackRateQuery, fetchSeries, fetchUnitEnergy, fmtKwh, fmtPct, peso, type Period, type UnitSort } from "@/lib/consumption";

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

function Analytics() {
  const [period, setPeriod] = useState<Period>("Month");
  const [sort, setSort] = useState<{ k: UnitSort; desc: boolean }>({ k: "code", desc: false });
  const [page, setPage] = useState(0);

  const series = useQuery({ queryKey: ["energy-series", period, null], queryFn: () => fetchSeries(period, null), placeholderData: keepPreviousData });
  const units = useQuery({
    queryKey: ["unit-energy", period, sort.k, sort.desc, page],
    queryFn: () => fetchUnitEnergy(period, sort.k, sort.desc, page),
    placeholderData: keepPreviousData,
  });

  const fb = useQuery(fallbackRateQuery);
  const pts = series.data?.points ?? [];
  const bucket = series.data?.bucket ?? "day";
  const total = units.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / UNIT_PAGE_SIZE));
  const from = total === 0 ? 0 : page * UNIT_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * UNIT_PAGE_SIZE);
  const btn = "rounded-md border border-border bg-card px-3 py-1 text-sm text-subtle hover:bg-muted disabled:opacity-50 disabled:hover:bg-card";
  const sortBy = (k: UnitSort) => { setSort({ k, desc: sort.k === k ? !sort.desc : k !== "code" }); setPage(0); };
  const H = ({ k, label }: { k: UnitSort; label: string }) => (
    <th className="py-4">
      <button onClick={() => sortBy(k)} className="flex items-center gap-1 uppercase" aria-label={`Sort by ${label}`}>
        {label} <ArrowDownWideNarrow className="h-3 w-3" aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <AdminLayout title="Consumption Analytics">
      <Tabs<Period> value={period} onChange={(v) => { setPeriod(v); setPage(0); }} items={(["Week", "Month", "Year"] as Period[]).map((v) => ({ value: v, label: v }))} />

      <Card className="mt-6 p-6">
        <div className="flex min-w-0 flex-col items-start justify-between gap-3 xl:flex-row">
          <div>
            <p className="text-base font-semibold text-ink">System-Wide Consumption Trend</p>
            <p className="text-sm text-subtle">Total energy used by all units over the {period === "Week" ? "last 7 days" : period === "Month" ? "last 30 days" : "last 12 months"}</p>
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

      <div className="mt-6">
        <QueryState query={units} isEmpty={(d) => d.rows.length === 0} emptyText="No units are registered yet." rows={5}>
          {(d) => (
            <>
              <Card className="overflow-hidden">
                <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-surface">
                      <tr className="border-b border-border text-left text-xs font-semibold text-subtle">
                        <th className="w-6" /><H k="code" label="Unit" /><th className="py-4 uppercase">Linked to</th><H k="kwh" label="kWh Consumed" /><H k="cost" label="Est. Cost" /><H k="change" label="% vs Prev Period" />
                        <th className="px-6 py-4 text-right uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((u) => (
                        <tr key={u.code} className="border-b border-border last:border-0">
                          <td />
                          <td className="py-4 font-semibold text-ink">{u.name || u.code}<span className="block text-xs font-normal text-subtle">{u.code}</span></td>
                          <td className="max-w-[180px] truncate text-ink">{u.linked || "—"}</td>
                          <td className="font-semibold text-ink">{fmtKwh(u.kwh)} kWh</td>
                          <td className="text-ink">{peso(u.cost)}</td>
                          <td>{u.changePct == null ? <span className="text-subtle">—</span> : <Badge tone={changeTone(u.changePct)}>{fmtPct(u.changePct)}</Badge>}</td>
                          <td className="px-6 text-right">
                            <Link to="/consumption-analytics/$unit" params={{ unit: u.code }} className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-subtle hover:bg-brand-soft hover:text-brand">Inspect</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <p className="mt-3 text-xs text-subtle">Cost uses each unit's own rate when set. Units without one use {fallbackNote(fb.data)}.</p>
              <div className="mt-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-sm text-subtle">Showing {from}–{to} of {d.total.toLocaleString()} registered units</p>
                <div className="flex items-center gap-1.5">
                  <button className={btn} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                  <span className="px-2 text-sm text-subtle">Page {page + 1} of {pages}</span>
                  <button className={btn} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </QueryState>
      </div>
    </AdminLayout>
  );
}