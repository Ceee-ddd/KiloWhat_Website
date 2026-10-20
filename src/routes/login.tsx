import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/kit";
import { authService, AuthError, safeRedirect, usePhase, useSession } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string | undefined } => ({ redirect: safeRedirect(s["redirect"]) }),
  head: () => ({
    meta: [
      { title: "Admin Login — KiloWhat Admin" },
      { name: "description", content: "Sign in to the KiloWhat admin panel." },
    ],
  }),
  component: LoginPage,
});

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";

function LoginPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const session = useSession();
  const phase = usePhase();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRequested = useRef(false);

  // Read the stored session once (e.g. page refresh in the middle of the code step).
  useEffect(() => { void authService.init(); }, []);

  // Fully signed in: go back to the page originally requested.
  useEffect(() => {
    if (session) router.history.replace(redirect ?? "/");
  }, [session, redirect, router]);

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Entering the code step: ask the server to email a code (it rate-limits repeats).
  useEffect(() => {
    if (phase !== "otp") { codeRequested.current = false; return; }
    if (codeRequested.current) return;
    codeRequested.current = true;
    void requestCode();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestCode() {
    setError(null);
    try {
      const r = await authService.sendOtp();
      setCooldown(r.already_sent ? r.resend_in ?? 60 : 60);
      setInfo("We emailed a 6-digit code to your account email. It expires in 10 minutes.");
    } catch (err) {
      setInfo(null);
      setError(err instanceof AuthError ? err.message : "Could not send the code. Please try again.");
    }
  }

  async function onCredentials(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    try {
      await authService.signIn(email, password);
      setPassword("");
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code.");
    setBusy(true);
    try {
      await authService.verifyOtp(code);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    await authService.signOut();
    setCode(""); setError(null); setInfo(null);
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
          {phase === "loading" && <p className="text-xs text-subtle">Loading…</p>}

          {(phase === "signedOut" || phase === "signedIn") && (
            <>
              <h1 className="text-lg font-bold text-ink">Administrator sign in</h1>
              <p className="mt-1 text-xs text-subtle">Sign in to manage users, meters and anomaly flags.</p>
              <form onSubmit={onCredentials} noValidate className="mt-5 flex flex-col gap-4">
                <div>
                  <label htmlFor="email" className="text-xs font-semibold text-ink">Email</label>
                  <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@example.com" />
                </div>
                <div>
                  <label htmlFor="password" className="text-xs font-semibold text-ink">Password</label>
                  <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
                </div>
                {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>}
                <Button type="submit" disabled={busy} className="h-10">{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
            </>
          )}

          {phase === "otp" && (
            <>
              <h1 className="text-lg font-bold text-ink">Verify this device</h1>
              <p className="mt-1 text-xs text-subtle">This browser hasn't been used with your account before, so we need to confirm it's you.</p>
              <form onSubmit={onVerify} noValidate className="mt-5 flex flex-col gap-4">
                <div>
                  <label htmlFor="code" className="text-xs font-semibold text-ink">6-digit code</label>
                  <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${field} text-center text-lg tracking-[0.5em]`} placeholder="••••••" />
                </div>
                {info && !error && <p className="rounded-lg bg-muted px-3 py-2 text-xs font-medium text-ink">{info}</p>}
                {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>}
                <Button type="submit" disabled={busy} className="h-10">{busy ? "Verifying…" : "Verify and continue"}</Button>
                <div className="flex items-center justify-between text-xs">
                  <button type="button" disabled={cooldown > 0} onClick={() => void requestCode()} className="font-semibold text-brand disabled:text-subtle">
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                  <button type="button" onClick={() => void startOver()} className="font-semibold text-subtle hover:text-ink">Use a different account</button>
                </div>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}