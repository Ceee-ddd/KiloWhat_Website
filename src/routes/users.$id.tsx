import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, DetailRows, roleTone, UserAvatar } from "@/components/kit";
import { QueryState } from "@/components/QueryState";
import { fetchUserDetail, fmtDate, fmtDateTime } from "@/lib/users";

export const Route = createFileRoute("/users/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "User Profile — KiloWhat Admin" },
      { name: "description", content: "User profile with linked units and account details." },
      { property: "og:title", content: "User Profile — KiloWhat Admin" },
      { property: "og:description", content: "User profile with linked units and account details." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { id } = Route.useParams();
  const query = useQuery({ queryKey: ["user", id], queryFn: () => fetchUserDetail(id) });

  // Loaded and not found (or not a valid id): show the standard not-found page.
  if (query.isSuccess && query.data === null) throw notFound();

  return (
    <AdminLayout title="User Profile">
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-subtle">
        <Link to="/user-management" className="flex items-center gap-1.5 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />User Management</Link>
        / <span className="text-ink">{query.data?.name ?? "…"}</span>
      </p>
      <div className="mt-4">
        <QueryState query={query} rows={5}>
          {(u) => u && (
            <>
              <Card className="p-6">
                <div className="flex min-w-0 items-start gap-4">
                  <UserAvatar className="h-[52px] w-[52px]" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-ink">{u.name}</p>
                      {u.roles.map((r) => <Badge key={r} tone={roleTone(r)} className="text-[11px] font-medium">{r}</Badge>)}
                      <Badge tone={u.status === "Active" ? "brand" : "danger"} className="text-[11px] font-medium">{u.status}</Badge>
                    </div>
                    <p className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 break-all text-xs text-subtle">
                      <span>{u.email}</span>{u.phone && <span>{u.phone}</span>}<span>Joined {fmtDate(u.joined)}</span>
                    </p>
                  </div>
                </div>
              </Card>

              <div className="mt-4 grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_372px]">
                <Card className="p-5">
                  <p className="text-sm font-semibold text-ink">Linked units</p>
                  <p className="text-xs text-subtle">Units this account is linked to. Consumption totals per unit are on Consumption Analytics.</p>
                  {u.units.length === 0 ? (
                    <p className="mt-4 text-sm text-subtle">This account is not linked to any unit yet.</p>
                  ) : (
                    <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
                      <table className="mt-4 w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-medium uppercase text-subtle">
                            <th className="bg-surface px-1 py-1.5">Unit</th><th className="bg-surface py-1.5">Code</th><th className="bg-surface py-1.5">Role in unit</th><th className="bg-surface py-1.5">Linked</th>
                          </tr>
                        </thead>
                        <tbody>
                          {u.units.map((x) => (
                            <tr key={x.code} className="border-b border-border last:border-0">
                              <td className="px-1 py-3 font-semibold text-ink">{x.name || x.code}</td>
                              <td className="text-subtle">{x.code}</td>
                              <td className="text-ink">{x.memberRole ?? "—"}</td>
                              <td className="text-subtle">{fmtDate(x.linkedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <DetailRows
                  title="Account Details"
                  rows={[
                    ["User ID", u.id],
                    ["Role", u.roles.join(", ") || "—"],
                    ["Status", u.status],
                    ["Joined", fmtDate(u.joined)],
                    ["Last sign-in", fmtDateTime(u.lastSignIn)],
                  ]}
                />
              </div>
            </>
          )}
        </QueryState>
      </div>
    </AdminLayout>
  );
}