import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, Tabs, roleTone, UserAvatar } from "@/components/kit";
import { QueryState } from "@/components/QueryState";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { USER_PAGE_SIZE, fetchUsers, fmtDate, type UserFilter } from "@/lib/users";

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

function UserManagement() {
  const [filter, setFilter] = useState<UserFilter>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const search = useDebouncedValue(q, 350);

  const query = useQuery({
    queryKey: ["users", filter, search.trim(), page],
    queryFn: () => fetchUsers(filter, search, page),
    placeholderData: keepPreviousData,
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const from = total === 0 ? 0 : page * USER_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * USER_PAGE_SIZE);
  const btn = "rounded-md border border-border bg-card px-3 py-1 text-sm text-subtle hover:bg-muted disabled:opacity-50 disabled:hover:bg-card";

  return (
    <AdminLayout title="User Management">
      <div className="flex min-w-0 flex-col items-stretch justify-between gap-4 2xl:flex-row 2xl:items-center">
        <Tabs<UserFilter>
          value={filter}
          onChange={(v) => { setFilter(v); setPage(0); }}
          items={[{ value: "All", label: "All" }, { value: "Landlord", label: "Landlords" }, { value: "Tenant", label: "Tenants" }, { value: "Individual", label: "Individual Users" }]}
        />
        <label className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 sm:w-[280px]">
          <Search className="h-4 w-4 text-subtle" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            maxLength={60}
            aria-label="Search users"
            placeholder="Search name, email, or phone..."
            className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <div className="mt-6">
        <QueryState query={query} isEmpty={(d) => d.rows.length === 0} emptyText="No users match your search." rows={6}>
          {(d) => (
            <>
              <Card className="overflow-hidden">
                <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-surface">
                      <tr className="border-b border-border text-left text-xs font-semibold uppercase text-subtle">
                        <th className="px-6 py-4">Name</th><th className="py-4 text-center">Role</th><th className="py-4 pl-4">Email / Contact</th>
                        <th className="py-4">Linked unit</th><th className="py-4 text-center">Status</th><th className="py-4">Date Joined</th><th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((u) => (
                        <tr key={u.id} className="border-b border-border last:border-0">
                          <td className="px-6 py-3">
                            <div className="flex min-w-0 flex-wrap items-center gap-3">
                              <UserAvatar className="h-9 w-9" />
                              <span className="font-semibold text-ink">{u.name}</span>
                            </div>
                          </td>
                          <td className="text-center"><Badge tone={roleTone(u.role)} className="rounded-md">{u.role}</Badge></td>
                          <td className="max-w-[200px] truncate pl-4 text-ink">
                            {u.email}
                            {u.phone && <span className="block text-xs text-subtle">{u.phone}</span>}
                          </td>
                          <td className="max-w-[170px] truncate text-subtle">{u.units || "—"}</td>
                          <td className="text-center"><Badge tone={u.status === "Active" ? "brand" : "danger"}>{u.status}</Badge></td>
                          <td className="text-subtle">{fmtDate(u.joined)}</td>
                          <td className="px-6">
                            <div className="flex justify-end">
                              <Link to="/users/$id" params={{ id: u.id }} className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-ink hover:bg-muted">View</Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="mt-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-sm text-subtle">Showing {from}–{to} of {d.total.toLocaleString()} users</p>
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