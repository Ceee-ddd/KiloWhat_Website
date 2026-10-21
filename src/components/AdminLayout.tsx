import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutPanelLeft, Users, Activity, TriangleAlert, Settings, Search, Menu, LogOut } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { authService, useSession } from "@/lib/auth";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutPanelLeft, match: (p: string) => p === "/" },
  { to: "/user-management", label: "User Management", icon: Users, match: (p: string) => p.startsWith("/user") },
  { to: "/consumption-analytics", label: "Consumption Analytics", icon: Activity, match: (p: string) => p.startsWith("/consumption") },
  { to: "/anomaly-flags", label: "Anomaly Flags", icon: TriangleAlert, match: (p: string) => p.startsWith("/anomaly") },
  { to: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
] as const;

export function AdminLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useSession();
  const router = useRouter();
  const location = useLocation();
  const queryClient = useQueryClient();
  const signingOut = useRef(false);

  // Gate: signed-out visitors are sent to /login and returned here afterwards.
  useEffect(() => {
    if (session === null && !signingOut.current && !location.pathname.startsWith("/login")) {
      router.navigate({ to: "/login", search: { redirect: location.href }, replace: true });
    }
  }, [session, location.href, location.pathname, router]);

  async function handleLogout() {
    signingOut.current = true;
    setMenuOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await authService.signOut();
    router.navigate({ to: "/login", search: {}, replace: true });
  }
  const navigation = (
    <>
      <div className="flex flex-col items-center gap-2 border-b border-border pb-6">
        <img src="/KiloWhatLogo.png" alt="KiloWhat" className="h-28 w-28 object-contain" />
      </div>
      <nav aria-label="Main navigation" className="mt-8 flex flex-col gap-1.5">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} onClick={() => setMenuOpen(false)} activeOptions={{ exact: n.to === "/" }} className="flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-subtle transition-colors hover:bg-muted" activeProps={{ className: "!bg-brand-soft !text-brand font-semibold" }}>
            <n.icon className="h-[18px] w-[18px] shrink-0" /><span className="min-w-0 flex-1">{n.label}</span>
          </Link>
        ))}
      </nav>
      <button type="button" onClick={handleLogout} className="mt-auto flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-subtle transition-colors hover:bg-muted">
        <LogOut className="h-[18px] w-[18px] shrink-0" /><span className="min-w-0 flex-1 text-left">Log out</span>
      </button>
    </>
  );
  if (!session) return <div className="min-h-screen bg-background" aria-busy="true" />;
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card px-4 py-6 lg:flex">{navigation}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open navigation" title="Open navigation" className="shrink-0 lg:hidden"><Menu /></Button></SheetTrigger>
              <SheetContent side="left" className="flex w-72 max-w-[85vw] flex-col gap-0 overflow-y-auto bg-card px-4 py-6" aria-describedby={undefined}>
                <SheetTitle className="sr-only">KiloWhat navigation</SheetTitle>{navigation}
              </SheetContent>
            </Sheet>
            <h1 className="min-w-0 text-base font-bold text-ink sm:text-xl">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 xl:gap-5">
            <label className="hidden w-[220px] items-center gap-2 rounded-lg border border-border px-3 py-1.5 xl:flex">
              <Search className="h-4 w-4 shrink-0 text-subtle" />
              <input aria-label="Search submeters and units" placeholder="Search submeters, units..." className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-subtle" />
            </label>
            <div className="text-right">
              <p className="text-xs font-semibold text-ink sm:text-sm">{session.name}</p>
              <p className="text-xs text-subtle">{session.role}</p>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-40 sm:p-6 sm:pb-32 xl:p-8 xl:pb-24">{children}</main>
        {footer}
      </div>
    </div>
  );
}
