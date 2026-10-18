import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { FieldErrors } from "@/lib/validation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { addUser } from "@/lib/store";

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";
const fields = [
  { key: "name", label: "Full name", type: "text", max: 100 },
  { key: "email", label: "Email", type: "email", max: 255 },
  { key: "phone", label: "Phone number", type: "tel", max: 20 },
  { key: "property", label: "Assigned property / unit", type: "text", max: 120 },
] as const;

function Form({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ name: "", email: "", phone: "", role: "Tenant", property: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const res = addUser(v);
    if (!res.ok) {
      setErrors(res.errors);
      toast.error(res.errors.form ?? "Please fix the highlighted fields.");
      return;
    }
    toast.success(`${res.data.name} was added as ${res.data.role}`);
    onClose();
  }
  return (
    <form onSubmit={submit} noValidate className="max-h-[70vh] overflow-y-auto px-6 pb-5 pt-3">
      {fields.map(({ key, label, type, max }) => (
        <div key={key} className="mb-3">
          <label htmlFor={`nu-${key}`} className="text-sm font-bold text-ink">{label}</label>
          <input id={`nu-${key}`} required maxLength={max} type={type} className={field} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `nu-${key}-error` : undefined} />
          {errors[key] && <p id={`nu-${key}-error`} role="alert" className="mt-1 text-xs text-danger">{errors[key]}</p>}
        </div>
      ))}
      <label htmlFor="nu-role" className="text-sm font-bold text-ink">Role</label>
      <select id="nu-role" required className={field} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} aria-invalid={!!errors.role}>
        {["Landlord", "Tenant", "Individual"].map((r) => <option key={r}>{r}</option>)}
      </select>
      {errors.role && <p role="alert" className="mt-1 text-xs text-danger">{errors.role}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">Add User</Button>
      </div>
    </form>
  );
}

export function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[481px] gap-0 p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-bold text-ink">Add New User</DialogTitle>
          <DialogDescription className="text-xs font-light text-ink">Demo record — stored in this browser session.</DialogDescription>
        </div>
        {open && <Form onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
