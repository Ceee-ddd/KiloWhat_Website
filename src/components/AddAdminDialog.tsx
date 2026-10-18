import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { FieldErrors } from "@/lib/validation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { addAdmin } from "@/lib/store";

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";

function Form({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const res = addAdmin(v);
    if (!res.ok) {
      setErrors(res.errors);
      if (res.errors.form) toast.error(res.errors.form);
      return;
    }
    toast.success(`${res.data.name} added as ${res.data.role} (demo record)`);
    onClose();
  }

  const err = (k: keyof FieldErrors) => errors[k] && <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p>;
  return (
    <form onSubmit={submit} noValidate className="px-6 pb-5 pt-3">
      <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-[11px] text-warn">Demo record only — stored in this browser session. Real accounts will be created through the secure invitation flow once authentication is connected.</p>
      {errors.form && <p role="alert" className="mb-3 text-xs text-danger">{errors.form}</p>}
      <label htmlFor="adm-name" className="text-sm font-bold text-ink">Full name</label>
      <input id="adm-name" required maxLength={100} className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={!!errors.name} />
      {err("name")}
      <label htmlFor="adm-email" className="mt-3 block text-sm font-bold text-ink">Email</label>
      <input id="adm-email" type="email" required maxLength={255} className={field} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} aria-invalid={!!errors.email} />
      {err("email")}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">Add Admin</Button>
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
          <DialogDescription className="text-xs font-light text-ink">Create an Admin record with a name and email.</DialogDescription>
        </div>
        <Form onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
