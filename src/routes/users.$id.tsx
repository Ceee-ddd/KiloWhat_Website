import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, Badge, TrendChart, AxisLabels, Legend, DetailRows, roleTone, UserAvatar, type Tone } from "@/components/kit";
import { userTrend, landlordUnits, accountActivity } from "@/lib/data";
import { useStore, toggleUserStatus } from "@/lib/store";
import { EditUserDialog } from "@/components/EditUserDialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/users/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "User Profile — KiloWhat Admin" },
      { name: "description", content: "User profile with units, consumption and account activity." },
      { property: "og:title", content: "User Profile — KiloWhat Admin" },
      { property: "og:description", content: "User profile with units, consumption and account activity." },
    ],
  }),
  component: Profile,
});

type Tab = "overview" | "units" | "consumption" | "activity";
const statusTone: Record<string, Tone> = { Active: "brand", Flagged: "warn", Vacant: "gray" };

function Profile() {
  const { id } = Route.useParams();
  const user = useStore((s) => s.users.find((u) => u.id === id));
  const [tab, setTab] = useState<Tab>("overview");
  const [msgOpen, setMsgOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const outline = "rounded-md border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-muted";

  if (!user) throw notFound();

  const trend = (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        <div>
          <p className="text-sm font-semibold text-ink">Consumption Trend</p>
          <p className="text-xs text-subtle">Aggregated kWh across all assigned units · last 30 days</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-subtle"><span className="h-2 w-2 rounded-full bg-brand" />Usage (kWh)</span>
      </div>
      <div className="mt-2"><TrendChart data={userTrend} color="var(--brand-bright)" height={130} /></div>
      <AxisLabels labels={["30 days ago", "20 days ago", "10 days ago", "Today"]} />
    </Card>
  );
  const details = (
    <DetailRows title="Account Details" rows={[["User ID", user.id], ["Role", user.role], ["Property", user.property], ["Billing cycle", "01 – 30 monthly"], ["Threshold limit", "150 kWh / day"], ["Last login", "Oct 24, 2024 · 09:42 AM"], ["Verified by", "Admin (Mike)"]]} />
  );
  const unitsCard = (
    <Card className="p-5">
      <div className="flex min-w-0 flex-col items-start justify-between gap-4 xl:flex-row">
        <div>
          <p className="text-sm font-semibold text-ink">Units & Tenants</p>
          <p className="text-xs text-subtle">15 registered units under this landlord account</p>
        </div>
        <button className={outline} onClick={() => toast.success("CSV export started")}>Export CSV</button>
      </div>
      <div className="max-w-full overflow-x-auto" role="region" aria-label="Scrollable data table" tabIndex={0}>
<table className="mt-4 w-full text-sm min-w-[640px]">
        <thead><tr className="text-left text-[11px] font-medium uppercase text-subtle"><th className="bg-surface px-1 py-1.5">Unit</th><th className="bg-surface py-1.5">Occupant</th><th className="bg-surface py-1.5">Submeter</th><th className="bg-surface py-1.5">kWh (MTD)</th><th className="bg-surface py-1.5">Est. cost</th><th className="bg-surface py-1.5">Status</th></tr></thead>
        <tbody>
          {landlordUnits.map((u) => (
            <tr key={u.unit} className="border-b border-border">
              <td className="px-1 py-4 font-semibold text-ink">{u.unit}</td>
              <td className={u.occupant === "Vacant" ? "text-subtle" : "text-ink"}>{u.occupant}</td>
              <td className="text-subtle">{u.meter}</td><td className="text-ink">{u.kwh}</td><td className="text-ink">{u.cost}</td>
              <td><Badge tone={statusTone[u.status] ?? "gray"} className="text-[11px]">{u.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
        </div>
    </Card>
  );
  const activityCard = (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink">Account Activity</p>
      <div className="mt-3">
        {accountActivity.map((a) => (
          <div key={a.title} className="flex flex-col justify-between gap-2 border-b border-border py-3 sm:flex-row last:border-0">
            <div className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-border" />
              <div><p className="text-sm font-semibold text-link">{a.title}</p><p className="text-xs text-subtle">{a.actor}</p></div>
            </div>
            <span className="text-xs text-subtle">{a.time}</span>
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <AdminLayout title="User Profile">
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-subtle">
        <Link to="/user-management" className="flex items-center gap-1.5 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />User Management</Link>
        / <span className="text-ink">{user.name}</span>
      </p>
      <Card className="mt-4 p-6">
        <div className="flex min-w-0 flex-col items-start justify-between gap-4 xl:flex-row">
          <div className="flex min-w-0 items-start gap-4">
            <UserAvatar className="h-[52px] w-[52px]" />
            <div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="text-base font-bold text-ink">{user.name}</p>
                <Badge tone={roleTone(user.role)} className="text-[11px] font-medium">{user.role}</Badge>
                <Badge tone={user.status === "Active" ? "brand" : "danger"} className="text-[11px] font-medium">{user.status}</Badge>
              </div>
              <p className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 break-all text-xs text-subtle"><span>{user.email}</span><span>{user.phone}</span><span>Joined {user.joined}</span><span>ID {user.id}</span></p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={outline} onClick={() => setMsgOpen(true)}>Send Message</button>
            <button className={outline} onClick={() => setEditOpen(true)}>Edit Profile</button>
            <button className="rounded-md border border-danger bg-card px-3.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger-soft" onClick={() => user.status === "Active" ? setSuspendOpen(true) : (toggleUserStatus(user.id), toast.success("User activated"))}>
              {user.status === "Active" ? "Suspend User" : "Activate User"}
            </button>
          </div>
        </div>
        <div className="mt-6 flex gap-5 overflow-x-auto border-b border-border">
          {([["overview", "Overview"], ["units", "Units & Tenants"], ["consumption", "Consumption"], ["activity", "Activity"]] as [Tab, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} className={cn("-mb-px shrink-0 whitespace-nowrap border-b-2 py-2 text-xs font-medium", tab === v ? "border-brand text-brand font-semibold" : "border-transparent text-subtle")}>{l}</button>
          ))}
        </div>

        {tab === "overview" && (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              {[["Units owned", "15", "12 occupied · 3 vacant"], ["Active tenants", "12", "Across 2 properties"], ["Consumption (MTD)", "4,280 kWh", "Approx. ₱36,380 total cost"], ["Open anomalies", "2", "1 overload · 1 voltage sag"]].map(([l, v, s]) => (
                <Card key={l} className="px-4 py-4">
                  <p className="text-[10px] font-medium uppercase text-ink">{l}</p>
                  <p className="mt-2 text-xl font-bold text-ink">{v}</p>
                  <p className="mt-2 text-[11px] text-subtle">{s}</p>
                </Card>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_372px] items-start gap-4">{trend}{details}</div>
          </>
        )}
        {tab === "consumption" && <div className="mt-5 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_372px] items-start gap-4">{trend}{details}</div>}
      </Card>

      {(tab === "overview" || tab === "units") && <div className="mt-4">{unitsCard}</div>}
      {(tab === "overview" || tab === "activity") && <div className="mt-4">{activityCard}</div>}

      <EditUserDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="max-w-[481px] gap-0 p-0">
          <div className="border-b border-border px-6 py-4">
            <DialogTitle className="text-base font-bold text-ink">Send Message</DialogTitle>
            <DialogDescription className="text-xs font-light text-ink">To {user.name} · {user.email}</DialogDescription>
          </div>
          <form className="px-6 pb-4 pt-3" onSubmit={(e) => { e.preventDefault(); setMsgOpen(false); toast.success(`Message sent to ${user.name}`); }}>
            <label className="text-sm font-bold text-ink">Subject</label>
            <input required className="mb-3 mt-1 h-10 w-full rounded-[10px] border border-border px-3 text-sm outline-none focus:border-brand" />
            <label className="text-sm font-bold text-ink">Message</label>
            <textarea required className="mt-1 h-[185px] w-full resize-none rounded-[10px] border border-border p-3 text-sm outline-none focus:border-brand" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={outline} onClick={() => setMsgOpen(false)}>Cancel</button>
              <button type="submit" className="rounded-md bg-brand-soft px-3.5 py-1.5 text-xs font-semibold text-brand">Send</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent className="max-w-[488px] gap-2 px-6 py-5">
          <DialogTitle className="text-base font-bold text-ink">Suspend {user.name}?</DialogTitle>
          <DialogDescription className="text-xs font-light text-ink">The account loses dashboard access immediately. Submeter readings keep recording and billing history is preserved.</DialogDescription>
          <div className="mt-2 flex justify-end gap-2">
            <button className={outline} onClick={() => setSuspendOpen(false)}>Cancel</button>
            <button className="rounded-md bg-danger px-3.5 py-1.5 text-xs font-semibold text-destructive-foreground" onClick={() => { toggleUserStatus(user.id); setSuspendOpen(false); toast.success(`${user.name} suspended`); }}>Suspend User</button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
