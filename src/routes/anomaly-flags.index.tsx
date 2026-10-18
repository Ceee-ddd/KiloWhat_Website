import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Tabs, Pagination } from "@/components/kit";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/anomaly-flags/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Anomaly Flags — KiloWhat Admin" },
      { name: "description", content: "Overloads, voltage sags, reverse energy and offline meters flagged across units." },
      { property: "og:title", content: "Anomaly Flags — KiloWhat Admin" },
      { property: "og:description", content: "Flagged anomalies across all submetered units." },
    ],
  }),
  component: Flags,
});

type F = "All" | "Critical" | "Warning" | "Resolved";

function Flags() {
  const all = useStore((s) => s.anomalies);
  const [f, setF] = useState<F>("All");
  const rows = all.filter((a) => f === "All" || (f === "Resolved" ? a.status === "Resolved" : a.severity === f && a.status === "Open"));
  const count = (x: F) => all.filter((a) => (x === "Resolved" ? a.status === "Resolved" : a.severity === x && a.status === "Open")).length;
  return (
    <AdminLayout title="Anomaly Flags">
      <Tabs<F> value={f} onChange={setF} items={[{ value: "All", label: `All (${all.length})` }, { value: "Critical", label: `Critical(${count("Critical")})` }, { value: "Warning", label: `Warning (${count("Warning")})` }, { value: "Resolved", label: `Resolved (${count("Resolved")})` }]} />
      <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable anomaly list" tabIndex={0}>
      <div className="mt-6 min-w-[760px] grid grid-cols-[159px_143px_118px_101px_75px_1fr] items-center border-b border-border bg-surface px-6 py-3.5 text-xs font-semibold text-subtle">
        <span>Unit/Household</span><span>Anomaly type</span><span>Detected</span><span>Severity</span><span>Status</span><span>Actions</span>
      </div>
      <div className="mt-6 flex flex-col gap-6">
        {rows.map((a) => (
          <div key={a.id} className="min-w-[760px] grid grid-cols-[159px_143px_118px_101px_75px_1fr] items-center border-b border-border bg-card px-6 py-4">
            <div><p className="text-sm font-semibold text-ink">{a.unit}</p><p className="text-[11px] text-subtle">{a.owner}</p></div>
            <span className="text-xs text-subtle">{a.type}</span>
            <span className="pr-4 text-xs text-subtle">{a.detected}</span>
            <span><Badge tone={a.severity === "Critical" ? "danger" : "warn"} className="text-[11px]">{a.severity}</Badge></span>
            <span><Badge tone={a.status === "Open" ? "danger" : "brand"} className="text-[11px]">{a.status}</Badge></span>
            <span><Link to="/anomaly-flags/$id" params={{ id: a.id }} className="rounded border border-border px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-muted">Investigate</Link></span>
          </div>
        ))}
      </div>
      </div>
      <Pagination label="Showing 8 of 912 Anomaly Flags" last={14} />
    </AdminLayout>
  );
}
