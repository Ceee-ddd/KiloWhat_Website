import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { FieldErrors } from "@/lib/validation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Role, User } from "@/lib/data";
import { updateUser } from "@/lib/store";

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";
const ROLES: Role[] = ["Landlord", "Tenant", "Individual"];

function Form({ user, onClose }: { user: User; onClose: () => void }) {
  const [v, setV] = useState({ name: user.name, email: user.email, phone: user.phone, role: user.role, property: user.property });
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const res = updateUser(user.id, v);
    if (!res.ok) {
      setErrors(res.errors);
      if (res.errors.form) toast.error(res.errors.form);
      return;
    }
    toast.success(`${res.data.name}'s profile was updated`);
    onClose();
  }

  const err = (k: keyof FieldErrors) => errors[k] && <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p>;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={submit} noValidate className="max-h-[70vh] overflow-y-auto px-6 pb-5 pt-3">
      {errors.form && <p role="alert" className="mb-3 text-xs text-danger">{errors.form}</p>}
      <label htmlFor="eu-name" className="text-sm font-bold text-ink">Full name</label>
      <input id="eu-name" className={field} value={v.name} onChange={set("name")} aria-invalid={!!errors.name} />
      {err("name")}
      <label htmlFor="eu-email" className="mt-3 block text-sm font-bold text-ink">Email</label>
      <input id="eu-email" type="email" className={field} value={v.email} onChange={set("email")} aria-invalid={!!errors.email} />
      {err("email")}
      <label htmlFor="eu-phone" className="mt-3 block text-sm font-bold text-ink">Phone number</label>
      <input id="eu-phone" type="tel" className={field} value={v.phone} onChange={set("phone")} aria-invalid={!!errors.phone} />
      {err("phone")}
      <label htmlFor="eu-role" className="mt-3 block text-sm font-bold text-ink">Role</label>
      <select id="eu-role" className={field} value={v.role} onChange={set("role")}>
        {ROLES.map((r) => <option key={r}>{r}</option>)}
      </select>
      {err("role")}
      <label htmlFor="eu-property" className="mt-3 block text-sm font-bold text-ink">Assigned property / unit</label>
      <input id="eu-property" className={field} value={v.property} onChange={set("property")} aria-invalid={!!errors.property} />
      {err("property")}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  );
}

export function EditUserDialog({ user, open, onOpenChange }: { user: User; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[481px] gap-0 p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-bold text-ink">Edit Profile</DialogTitle>
          <DialogDescription className="text-xs font-light text-ink">{user.id} · changes apply immediately in this demo.</DialogDescription>
        </div>
        <Form user={user} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
