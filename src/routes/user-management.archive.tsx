import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, Pagination, roleTone } from "@/components/kit";
import { useStore, restoreUser } from "@/lib/store";

export const Route = createFileRoute("/user-management/archive")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "User Archive — KiloWhat Admin" },
      { name: "description", content: "Archived KiloWhat user accounts that can be restored." },
      { property: "og:title", content: "User Archive — KiloWhat Admin" },
      { property: "og:description", content: "Archived user accounts that can be restored." },
    ],
  }),
  component: Archive,
});

type F = "All" | "Landlord" | "Tenant" | "Individual";

function Archive() {
  const archive = useStore((s) => s.archive);
  const [filter, setFilter] = useState<F>("All");
  const [q, setQ] = useState("");
  const rows = archive.filter((u) => (filter === "All" || u.role === filter) && `${u.name} ${u.email} ${u.property}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <AdminLayout title="User Archive">
      <Link to="/user-management" className="inline-flex items-center gap-2 rounded-md bg-card px-4 py-1.5 text-sm text-ink"><ChevronLeft className="h-4 w-4" /> back to user management</Link>
      <div className="mt-6 flex min-w-0 flex-col items-stretch justify-between gap-4 xl:flex-row xl:items-center">
        <Tabs<F> value={filter} onChange={setFilter} items={[{ value: "All", label: "All" }, { value: "Landlord", label: "Landlords" }, { value: "Tenant", label: "Tenants" }, { value: "Individual", label: "Individual Users" }]} />
        <label className="flex w-full min-w-0 items-center sm:w-[280px] gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, or unit..." className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-subtle" />
        </label>
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
<table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface">
            <tr className="border-b border-border text-left text-xs font-semibold text-subtle">
              <th className="px-6 py-4 uppercase">Name</th><th className="py-4 text-center uppercase">Role</th><th className="py-4 pl-4 uppercase">Email / Contact</th>
              <th className="py-4">Last property / unit</th><th className="py-4">Archived on</th><th className="px-6 py-4 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-6 py-3.5 font-semibold text-ink">{u.name}</td>
                <td className="text-center"><Badge tone={roleTone(u.role)} className="rounded-md">{u.role}</Badge></td>
                <td className="pl-4 text-ink">{u.email}</td>
                <td className="max-w-[170px] truncate text-subtle">{u.property}</td>
                <td className="text-subtle">{u.archived}</td>
                <td className="px-6">
                  {u.restorable && (
                    <button onClick={() => { restoreUser(u.id); toast.success(`${u.name} restored`); }} className="rounded-md border border-brand px-3 py-1 text-xs font-semibold text-ink hover:bg-brand-soft">Restore</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
      <Pagination label={`Showing ${rows.length} of 18 users`} last={3} />
    </AdminLayout>
  );
}
