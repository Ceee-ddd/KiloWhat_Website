import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, Pagination, roleTone, UserAvatar } from "@/components/kit";
import { useStore, toggleUserStatus } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { AddUserDialog } from "@/components/AddUserDialog";

export const Route = createFileRoute("/user-management/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "User Management — KiloWhat Admin" },
      { name: "description", content: "Manage landlords, tenants and individual users on KiloWhat." },
      { property: "og:title", content: "User Management — KiloWhat Admin" },
      { property: "og:description", content: "Manage landlords, tenants and individual users." },
    ],
  }),
  component: UserManagement,
});

type F = "All" | "Landlord" | "Tenant" | "Individual";

function UserManagement() {
  const users = useStore((s) => s.users);
  const [filter, setFilter] = useState<F>("All");
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const rows = users.filter(
    (u) => (filter === "All" || u.role === filter) && `${u.name} ${u.email} ${u.property}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <AdminLayout title="User Management">
      <div className="flex min-w-0 flex-col items-stretch justify-between gap-4 2xl:flex-row 2xl:items-center">
        <Tabs<F> value={filter} onChange={setFilter} items={[{ value: "All", label: "All" }, { value: "Landlord", label: "Landlords" }, { value: "Tenant", label: "Tenants" }, { value: "Individual", label: "Individual Users" }]} />
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <label className="flex w-full min-w-0 items-center sm:w-[280px] gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Search className="h-4 w-4 text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, or unit..." className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-subtle" />
          </label>
          <Button asChild className="h-9 sm:w-[140px]"><Link to="/user-management/archive">Archive</Link></Button>
          <Button className="h-9" onClick={() => setAddOpen(true)}><Plus /> Add New User</Button>
        </div>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
<table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface">
            <tr className="border-b border-border text-left text-xs font-semibold uppercase text-subtle">
              <th className="px-6 py-4">Name</th><th className="py-4 text-center">Role</th><th className="py-4 pl-4">Email / Contact</th>
              <th className="py-4">Property or Unit</th><th className="py-4 text-center">Status</th><th className="py-4">Date Joined</th><th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-6 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <UserAvatar className="h-9 w-9" />
                    <span className="font-semibold text-ink">{u.name}</span>
                  </div>
                </td>
                <td className="text-center"><Badge tone={roleTone(u.role)} className="rounded-md">{u.role}</Badge></td>
                <td className="max-w-[170px] truncate pl-4 text-ink">{u.email}</td>
                <td className="max-w-[170px] truncate text-subtle">{u.property}</td>
                <td className="text-center"><Badge tone={u.status === "Active" ? "brand" : "danger"}>{u.status}</Badge></td>
                <td className="text-subtle">{u.joined}</td>
                <td className="px-6">
                  <div className="flex justify-end gap-2">
                    <Link to="/users/$id" params={{ id: u.id }} className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-ink hover:bg-muted">View</Link>
                    <button
                      onClick={() => { toggleUserStatus(u.id); toast.success(`${u.name} ${u.status === "Active" ? "suspended" : "activated"}`); }}
                      className={u.status === "Active" ? "w-[76px] rounded-md border border-danger px-3 py-1 text-xs font-semibold text-danger hover:bg-danger-soft" : "w-[76px] rounded-md border border-brand px-3 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"}
                    >
                      {u.status === "Active" ? "Suspend" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-subtle">No users match your search.</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>
      <Pagination label={`Showing ${rows.length} of 1,247 users`} last={156} />
      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
    </AdminLayout>
  );
}
