import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { Card } from "@/components/kit";
import { activateInvite, checkInvite, InviteError } from "@/lib/admins";
import { adminPasswordProblem, ADMIN_PASSWORD_MIN, formatInviteCode, normalizeInviteCode } from "@/lib/validation";

export const Route = createFileRoute("/activate")({
  head: () => ({ meta: [{ title: "Activate account — KiloWhat Admin" }] }),
  component: ActivatePage,
});

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";
const alertBox = "rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger";

type State = "checking" | "valid" | "invalid" | "burned" | "limited" | "done";

function ActivatePage() {
  const router = useRouter();
  const tokenRef = useRef<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<State>("checking");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runCheck = useCallback((t: string) => {
    setState("checking");
    checkInvite(t)
      .then((r) => { setEmail(r.email); setState("valid"); })
      .catch((err) => setState(err instanceof InviteError && err.code === "rate_limited" ? "limited" : "invalid"));
  }, []);

  useEffect(() => {
    // Token lives in the URL fragment. Read it once, then remove it from the address bar / history.
    // The ref keeps it if this effect runs twice (dev StrictMode), since the hash is gone by then.
    if (tokenRef.current) return;
    const t = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) return setState("invalid");
    tokenRef.current = t;
    runCheck(t);
  }, [runCheck]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const token = tokenRef.current;
    if (!token || busy) return;
    setError(null);
    const cleanCode = normalizeInviteCode(code);
    if (!cleanCode) return setError("Enter the 8-character invite code from your inviter.");
    const problem = adminPasswordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await activateInvite(token, cleanCode, password);
      tokenRef.current = null;
      setState("done");
      setTimeout(() => router.history.replace("/login"), 2000);
    } catch (err) {
      const e2 = err instanceof InviteError ? err : null;
      if (e2?.code === "invalid_link") setState("invalid");
      else if (e2?.code === "invite_burned") setState("burned");
      else if (e2?.code === "invalid_code") {
        const left = e2.attemptsLeft;
        setError(left === undefined ? e2.message : `${e2.message} ${left} ${left === 1 ? "attempt" : "attempts"} left.`);
        setCode("");
      } else setError(e2?.message ?? "Something went wrong. Please try again.");
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
          {state === "invalid" && <p role="alert" className={`mt-3 ${alertBox}`}>This invitation link is invalid, already used, or has expired. Ask an administrator to send a new one.</p>}
          {state === "burned" && <p role="alert" className={`mt-3 ${alertBox}`}>Too many incorrect codes. This invitation has been cancelled. Ask an administrator to send a new one.</p>}
          {state === "limited" && (
            <div className="mt-3 flex flex-col gap-3">
              <p role="alert" className={alertBox}>Too many attempts. Please wait a minute and try again.</p>
              <Button type="button" variant="outline" className="h-10" onClick={() => tokenRef.current && runCheck(tokenRef.current)}>Try again</Button>
            </div>
          )}
          {state === "done" && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-ink">Account activated. Taking you to sign in…</p>}
          {state === "valid" && (
            <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
              <p className="text-xs text-subtle">Activating <span className="font-semibold text-ink">{email}</span>. You need the invite code your inviter gave you by phone or chat.</p>
              <div>
                <label htmlFor="code" className="text-xs font-semibold text-ink">Invite code</label>
                <input id="code" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={9} placeholder="XXXX-XXXX"
                  value={code} onChange={(e) => setCode(formatInviteCode(e.target.value))}
                  className={`${field} font-mono tracking-[0.2em]`} />
              </div>
              <div>
                <label htmlFor="pw" className="text-xs font-semibold text-ink">New password</label>
                <PasswordInput id="pw" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
                <p className="mt-1 text-[11px] text-subtle">{ADMIN_PASSWORD_MIN}+ characters with upper and lower case, a number and a special character.</p>
              </div>
              <div>
                <label htmlFor="pw2" className="text-xs font-semibold text-ink">Confirm password</label>
                <PasswordInput id="pw2" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
              </div>
              {error && <p role="alert" className={alertBox}>{error}</p>}
              <Button type="submit" disabled={busy} className="h-10">{busy ? "Activating…" : "Activate account"}</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}