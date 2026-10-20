import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/kit";
import { activateInvite, checkInvite, InviteError } from "@/lib/admins";

export const Route = createFileRoute("/activate")({
  head: () => ({ meta: [{ title: "Activate account — KiloWhat Admin" }] }),
  component: ActivatePage,
});

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";

// Same rules as the mobile app (also enforced again on the server).
function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  if (p.length > 72) return "Use 72 characters or fewer.";
  if (!/[a-z]/.test(p)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(p)) return "Add an uppercase letter.";
  if (!/[0-9]/.test(p)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(p)) return "Add a special character.";
  return null;
}

function ActivatePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<"checking" | "valid" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Token lives in the URL fragment. Read it, then remove it from the address bar / history.
    const t = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) return setState("invalid");
    setToken(t);
    checkInvite(t)
      .then((r) => { setEmail(r.email); setState("valid"); })
      .catch(() => setState("invalid"));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    setError(null);
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await activateInvite(token, password);
      setState("done");
      setTimeout(() => router.history.replace("/login"), 2000);
    } catch (err) {
      if (err instanceof InviteError && err.code === "invalid_link") setState("invalid");
      else setError(err instanceof InviteError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand"><Zap className="h-6 w-6 text-primary-foreground" strokeWidth={2.5} /></div>
          <p className="text-2xl font-extrabold text-brand">KiloWhat</p>
          <p className="text-xs font-semibold uppercase text-subtle">Admin Panel</p>
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-bold text-ink">Activate your account</h1>
          {state === "checking" && <p className="mt-3 text-xs text-subtle">Checking your invitation…</p>}
          {state === "invalid" && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">This invitation link is invalid, already used, or has expired. Ask an administrator to send a new one.</p>}
          {state === "done" && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-ink">Account activated. Taking you to sign in…</p>}
          {state === "valid" && (
            <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
              <p className="text-xs text-subtle">Choose a password for <span className="font-semibold text-ink">{email}</span>.</p>
              <div>
                <label htmlFor="pw" className="text-xs font-semibold text-ink">New password</label>
                <input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
                <p className="mt-1 text-[11px] text-subtle">8+ characters with upper and lower case, a number and a special character.</p>
              </div>
              <div>
                <label htmlFor="pw2" className="text-xs font-semibold text-ink">Confirm password</label>
                <input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
              </div>
              {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>}
              <Button type="submit" disabled={busy} className="h-10">{busy ? "Activating…" : "Activate account"}</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}