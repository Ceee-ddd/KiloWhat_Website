import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { authService } from "@/lib/auth";
import { setAdminStatus, updateOwnName, changeOwnPassword, InviteError, type AdminRow } from "@/lib/admins";
import { adminPasswordProblem } from "@/lib/validation";
import { actionLabel, emptyFilters, fetchAuditPage } from "@/lib/auditLog";

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");
const tone = (s: AdminRow["status"]) => (s === "Active" ? "brand" : s === "Pending" ? "warn" : "danger");

const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
    <dt className="text-subtle">{label}</dt>
    <dd className="text-right font-medium text-ink">{children}</dd>
  </div>
);

export function AdminDetailsDialog({ admin, isSelf, onClose }: { admin: AdminRow | null; isSelf: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(admin?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nxt, setNxt] = useState("");
  const [conf, setConf] = useState("");
  const [cpError, setCpError] = useState<string | null>(null);
  const [cpBusy, setCpBusy] = useState(false);

  const recent = useQuery({
    queryKey: ["admin-recent", admin?.email],
    queryFn: async () => (await fetchAuditPage({ ...emptyFilters, admin: admin!.email }, 0)).rows.filter((r) => r.actor_email === admin!.email).slice(0, 5),
    enabled: !!admin,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admins"] });
    qc.invalidateQueries({ queryKey: ["audit-log"] });
    qc.invalidateQueries({ queryKey: ["audit-last-change"] });
    qc.invalidateQueries({ queryKey: ["admin-recent"] });
  };

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!admin || savingName) return;
    setNameError(null);
    setSavingName(true);
    try {
      const saved = await updateOwnName(name);
      authService.updateSessionName(saved);
      toast.success("Name updated");
      refresh();
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  function closePw() {
    setPwOpen(false); setCur(""); setNxt(""); setConf(""); setCpError(null);
  }

  async function changePw(e: FormEvent) {
    e.preventDefault();
    if (cpBusy) return;
    if (!cur) return setCpError("Enter your current password.");
    const problem = adminPasswordProblem(nxt);
    if (problem) return setCpError(problem);
    if (nxt !== conf) return setCpError("New passwords do not match.");
    setCpBusy(true);
    setCpError(null);
    try {
      await changeOwnPassword(cur, nxt);
      toast.success("Password changed. Your other sessions were signed out.");
      closePw();
      refresh();
    } catch (err) {
      setCpError((err as InviteError).message || "Something went wrong. Please try again.");
      if ((err as InviteError).code === "invalid_password") setCur("");
    } finally {
      setCpBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!admin || busy) return;
    if (!password) return setPwError("Enter your password to confirm.");
    setBusy(true);
    setPwError(null);
    const disable = admin.status === "Active";
    try {
      await setAdminStatus(admin.id, disable, password);
      toast.success(disable ? `${admin.name} was disabled` : `${admin.name} was enabled`);
      setPassword("");
      setConfirming(false);
      refresh();
    } catch (err) {
      setPwError((err as InviteError).message || "Something went wrong. Please try again.");
      if ((err as InviteError).code === "invalid_password") setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const canToggle = !!admin && !isSelf && admin.status !== "Pending";
  const disabling = admin?.status === "Active";

  return (
    <Dialog open={!!admin} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[481px] gap-0 p-0">
        {admin && (
          <>
            <div className="border-b border-border px-6 py-4">
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-ink">{admin.name}{isSelf && <span className="text-[10px] font-medium text-subtle">(you)</span>} <Badge tone={tone(admin.status)}>{admin.status}</Badge></DialogTitle>
              <DialogDescription className="text-xs font-light text-ink">Administrator details</DialogDescription>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 pb-5 pt-3">
              {isSelf && (
                <form onSubmit={saveName} noValidate className="mb-3">
                  <label htmlFor="own-name" className="text-sm font-bold text-ink">Your name</label>
                  <div className="flex gap-2">
                    <input id="own-name" maxLength={60} className={field} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
                    <Button type="submit" className="mt-1 h-10" disabled={savingName || name.trim() === admin.name}>{savingName ? "Saving…" : "Save"}</Button>
                  </div>
                  {nameError && <p role="alert" className="mt-1 text-xs text-danger">{nameError}</p>}
                  <p className="mt-1 text-[11px] text-subtle">You can edit your own details only. Email changes are not available here.</p>
                </form>
              )}
              {isSelf && !pwOpen && (
                <div className="mb-3 flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="text-sm font-bold text-ink">Password</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPwOpen(true)}>Change password</Button>
                </div>
              )}
              {isSelf && pwOpen && (
                <form onSubmit={changePw} noValidate className="mb-3 rounded-lg border border-border p-3">
                  <p className="text-sm font-bold text-ink">Change password</p>
                  <label htmlFor="cp-cur" className="mt-2 block text-xs font-semibold text-ink">Current password</label>
                  <PasswordInput id="cp-cur" autoComplete="current-password" className={field} value={cur} onChange={(e) => setCur(e.target.value)} />
                  <label htmlFor="cp-new" className="mt-2 block text-xs font-semibold text-ink">New password</label>
                  <PasswordInput id="cp-new" autoComplete="new-password" className={field} value={nxt} onChange={(e) => setNxt(e.target.value)} />
                  <p className="mt-1 text-[11px] text-subtle">12+ characters with upper and lower case, a number and a special character.</p>
                  <label htmlFor="cp-conf" className="mt-2 block text-xs font-semibold text-ink">Confirm new password</label>
                  <PasswordInput id="cp-conf" autoComplete="new-password" className={field} value={conf} onChange={(e) => setConf(e.target.value)} />
                  {cpError && <p role="alert" className="mt-2 text-xs text-danger">{cpError}</p>}
                  <p className="mt-2 text-[11px] text-subtle">Your other sessions will be signed out. This one stays open.</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={cpBusy} onClick={closePw}>Cancel</Button>
                    <Button type="submit" disabled={cpBusy}>{cpBusy ? "Saving…" : "Save password"}</Button>
                  </div>
                </form>
              )}
              <dl>
                <Item label="Email">{admin.email}</Item>
                <Item label="Role">Admin</Item>
                <Item label="Added">{when(admin.added)}</Item>
                <Item label="Invited by">{admin.invited_by ?? "—"}</Item>
                <Item label="Last sign-in">{when(admin.last_sign_in_at)}</Item>
                <Item label="Trusted devices">{admin.devices}</Item>
                {admin.status === "Pending" && admin.expires_at && <Item label="Invitation expires">{when(admin.expires_at)}</Item>}
              </dl>

              <p className="mb-1 mt-4 text-xs font-semibold uppercase text-subtle">Recent activity</p>
              {recent.isLoading ? <p className="text-xs text-subtle">Loading…</p> : recent.data?.length ? (
                <ul className="text-xs text-ink">
                  {recent.data.map((r) => <li key={r.id} className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0"><span>{actionLabel(r.action)}{r.target && r.action !== "login" && r.action !== "logout" ? ` · ${r.target}` : ""}</span><span className="shrink-0 text-subtle">{when(r.at)}</span></li>)}
                </ul>
              ) : <p className="text-xs text-subtle">No activity recorded.</p>}

              {isSelf && <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[11px] text-subtle">You cannot disable your own account.</p>}
              {!isSelf && admin.status === "Pending" && <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[11px] text-subtle">This person has not activated their account yet, so it cannot be disabled or enabled.</p>}
              {!isSelf && <p className="mt-4 text-[11px] text-subtle">Other administrators' details are read-only.</p>}

              {canToggle && !confirming && (
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant={disabling ? "destructive" : "default"} onClick={() => { setConfirming(true); setPwError(null); }}>{disabling ? "Disable account" : "Enable account"}</Button>
                </div>
              )}
              {canToggle && confirming && (
                <form onSubmit={confirm} noValidate className="mt-4 rounded-lg border border-border p-3">
                  <p className="text-xs text-ink">{disabling ? "This signs them out everywhere and blocks sign-in until you enable the account again." : "They will need to verify their device again when they sign in."} Enter <b>your</b> password to confirm.</p>
                  <label htmlFor="confirm-pw" className="mt-3 block text-sm font-bold text-ink">Your password</label>
                  <PasswordInput id="confirm-pw" autoComplete="current-password" autoFocus className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
                  {pwError && <p role="alert" className="mt-1 text-xs text-danger">{pwError}</p>}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => { setConfirming(false); setPassword(""); setPwError(null); }}>Cancel</Button>
                    <Button type="submit" variant={disabling ? "destructive" : "default"} disabled={busy}>{busy ? "Working…" : disabling ? "Confirm disable" : "Confirm enable"}</Button>
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}