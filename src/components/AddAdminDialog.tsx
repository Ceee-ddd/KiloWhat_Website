import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { adminSchema, fieldErrors, formatInviteCode, type FieldErrors } from "@/lib/validation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { inviteAdmin, InviteError, type InviteResult } from "@/lib/admins";

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";

function Form({ onClose, onSent }: { onClose: () => void; onSent: (r: InviteResult) => void }) {
  const [v, setV] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = adminSchema.safeParse(v);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setBusy(true);
    try {
      const res = await inviteAdmin({ name: parsed.data.name, email: parsed.data.email });
      toast.success(`Invitation sent to ${res.email}`);
      onSent(res);
    } catch (err) {
      const e2 = err as InviteError;
      if (e2.code === "email_exists") setErrors({ email: e2.message });
      else if (e2.code === "invalid_email") setErrors({ email: e2.message });
      else if (e2.code === "invalid_name") setErrors({ name: e2.message });
      else toast.error(e2.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const err = (k: keyof FieldErrors) => errors[k] && <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p>;
  return (
    <form onSubmit={submit} noValidate className="px-6 pb-5 pt-3">
      <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-subtle">The new administrator receives an email with a link to set their own password. You never see or share it. You will get a one-time invite code to give them separately.</p>
      <label htmlFor="adm-name" className="text-sm font-bold text-ink">Full name</label>
      <input id="adm-name" required maxLength={60} className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={!!errors.name} />
      {err("name")}
      <label htmlFor="adm-email" className="mt-3 block text-sm font-bold text-ink">Email</label>
      <input id="adm-email" type="email" required maxLength={254} className={field} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} aria-invalid={!!errors.email} />
      {err("email")}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</Button>
      </div>
    </form>
  );
}

function CodeView({ result, onDone }: { result: InviteResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const code = formatInviteCode(result.invite_code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the code and copy it manually.");
    }
  }

  return (
    <div className="px-6 pb-5 pt-3">
      <p className="text-xs text-subtle">
        An activation link was emailed to <span className="font-semibold text-ink">{result.email}</span> and expires in {result.ttl_minutes} minutes.
        They also need this invite code to activate.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
        <span className="select-all font-mono text-2xl font-bold tracking-[0.2em] text-ink" aria-label="Invite code">{code}</span>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p role="note" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[11px] font-medium text-danger">
        Give this code by phone or chat, never by email. It is shown only once.
      </p>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

export function AddAdminDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [issued, setIssued] = useState<InviteResult | null>(null);

  function finish() {
    setIssued(null); // drops the code from memory
    onOpenChange(false);
  }

  function handleOpenChange(o: boolean) {
    if (o) return onOpenChange(true);
    // Closing with the X / Esc / outside click while the code is on screen would lose it forever.
    if (issued && !window.confirm("This code will not be shown again. Close anyway?")) return;
    finish();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[481px] gap-0 p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-bold text-ink">{issued ? "Invitation sent" : "Add Administrator"}</DialogTitle>
          <DialogDescription className="text-xs font-light text-ink">
            {issued ? "Share the invite code with the new administrator." : "Send an invitation to create an Admin account."}
          </DialogDescription>
        </div>
        {issued ? <CodeView result={issued} onDone={finish} /> : <Form onClose={finish} onSent={setIssued} />}
      </DialogContent>
    </Dialog>
  );
}