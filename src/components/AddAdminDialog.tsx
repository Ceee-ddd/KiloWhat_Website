import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { adminSchema, fieldErrors, type FieldErrors } from "@/lib/validation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { inviteAdmin, InviteError } from "@/lib/admins";

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";

function Form({ onClose }: { onClose: () => void }) {
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
      onClose();
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
      <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-subtle">The new administrator receives an email with a link to set their own password. You never see or share it.</p>
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

export function AddAdminDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[481px] gap-0 p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-bold text-ink">Add Administrator</DialogTitle>
          <DialogDescription className="text-xs font-light text-ink">Send an invitation to create an Admin account.</DialogDescription>
        </div>
        <Form onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}