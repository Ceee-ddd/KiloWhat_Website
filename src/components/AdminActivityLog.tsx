import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, Badge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ACTIONS, PAGE_SIZE, actionLabel, emptyFilters, exportAuditCsv, fetchAuditPage, fetchLastChange, type AuditFilters } from "@/lib/auditLog";

const ctl = "h-9 rounded-lg border border-border bg-card px-3 text-[11px] font-semibold text-ink outline-none focus:border-brand";
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AdminActivityLog() {
  const [draft, setDraft] = useState<AuditFilters>(emptyFilters);
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const list = useQuery({
    queryKey: ["audit-log", filters, page],
    queryFn: () => fetchAuditPage(filters, page),
    placeholderData: keepPreviousData,
  });
  const last = useQuery({ queryKey: ["audit-last-change"], queryFn: fetchLastChange });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function apply() {
    setFilters(draft);
    setPage(0);
  }
  function reset() {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setPage(0);
  }
  async function download() {
    setExporting(true);
    try {
      const csv = await exportAuditCsv(filters);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `admin-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-ink">Admin activity</p>
          <p className="text-[10px] text-subtle">Who signed in or out, and what each administrator changed. Entries cannot be edited or deleted.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { list.refetch(); last.refetch(); }} disabled={list.isFetching}>{list.isFetching ? "Refreshing…" : "Refresh"}</Button>
          <Button variant="outline" onClick={download} disabled={exporting}>{exporting ? "Exporting…" : "Export CSV"}</Button>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-muted px-3 py-2 text-[11px] text-ink">
        <span className="font-semibold">Last change: </span>
        {last.isLoading ? "Loading…" : last.data ? (
          <>{last.data.name ?? last.data.actor_email ?? "Unknown"} — {actionLabel(last.data.action)}{last.data.target ? ` (${last.data.target})` : ""} · <span className="text-subtle">{when(last.data.at)}</span></>
        ) : "No changes recorded yet."}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-[10px] font-semibold text-subtle">Admin email
          <input className={`${ctl} mt-1 block w-[180px]`} value={draft.admin} onChange={(e) => setDraft({ ...draft, admin: e.target.value })} placeholder="Search…" />
        </label>
        <label className="text-[10px] font-semibold text-subtle">Action
          <select className={`${ctl} mt-1 block w-[200px]`} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            <option value="">All actions</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-subtle">From
          <input type="date" className={`${ctl} mt-1 block`} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="text-[10px] font-semibold text-subtle">To
          <input type="date" className={`${ctl} mt-1 block`} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <Button type="submit">Apply</Button>
        <Button type="button" variant="outline" onClick={reset}>Reset</Button>
      </form>

      {list.isError ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">Could not load the activity log. Press Refresh to try again.</p>
      ) : (
        <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase text-subtle">
                <th className="py-3 pr-4">Time</th><th className="py-3 pr-4">Admin</th><th className="py-3 pr-4">Action</th><th className="py-3 pr-4">Target</th><th className="py-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && <tr><td colSpan={5} className="py-6 text-center text-xs text-subtle">Loading…</td></tr>}
              {!list.isLoading && list.data?.rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-xs text-subtle">No activity matches these filters.</td></tr>}
              {list.data?.rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap py-3 pr-4 text-subtle">{when(r.at)}</td>
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-ink">{r.name ?? r.actor_email ?? "—"}</p>
                    {r.name && r.actor_email && <p className="text-[10px] text-subtle">{r.actor_email}</p>}
                  </td>
                  <td className="py-3 pr-4"><Badge tone={ACTIONS[r.action]?.tone ?? "gray"}>{actionLabel(r.action)}</Badge></td>
                  <td className="py-3 pr-4 text-ink">{r.target ?? "—"}</td>
                  <td className="py-3 text-subtle">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-subtle">
        <span>{total} {total === 1 ? "entry" : "entries"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages}>Next</Button>
        </div>
      </div>
    </Card>
  );
}