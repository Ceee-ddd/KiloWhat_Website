import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Zap, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/kit";
import { authService, AuthError, DEMO_ADMIN, safeRedirect, useSession } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string | undefined } => ({ redirect: safeRedirect(s["redirect"]) }),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Admin Login — KiloWhat Admin" },
      { name: "description", content: "Sign in to the KiloWhat admin panel (demo access)." },
      { property: "og:title", content: "Admin Login — KiloWhat Admin" },
      { property: "og:description", content: "Sign in to the KiloWhat admin panel (demo access)." },
    ],
  }),
  component: LoginPage,
});

const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none focus:border-brand";

function LoginPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just signed in): go back to the page originally requested.
  useEffect(() => {
    if (session) router.history.replace(redirect ?? "/");
  }, [session, redirect, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    try {
      await authService.signIn(email, password);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
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
          <h1 className="text-lg font-bold text-ink">Administrator sign in</h1>
          <p className="mt-1 text-xs text-subtle">Sign in to manage users, meters and anomaly flags.</p>
          <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="text-xs font-semibold text-ink">Email</label>
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@kilowhat.ph" />
            </div>
            <div>
              <label htmlFor="password" className="text-xs font-semibold text-ink">Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
            </div>
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="h-10">{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        </Card>
        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-xs text-subtle">
          <p className="flex items-center gap-1.5 font-semibold text-ink"><Info className="h-3.5 w-3.5 text-brand" />Demo access only</p>
          <p className="mt-1">This prototype uses a mock account and browser-only sign-in — it is not secure authentication. Real sign-in will replace it before launch.</p>
          <p className="mt-2">Email: <span className="font-semibold text-ink">{DEMO_ADMIN.email}</span><br />Password: <span className="font-semibold text-ink">{DEMO_ADMIN.password}</span></p>
          <button type="button" onClick={() => { setEmail(DEMO_ADMIN.email); setPassword(DEMO_ADMIN.password); setError(null); }} className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-muted">Fill demo credentials</button>
        </div>
      </div>
    </div>
  );
}
