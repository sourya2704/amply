import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CalendarCheck, Car, ChevronDown, LayoutDashboard, LogOut, Map, Route as RouteIcon, ShieldCheck, type LucideIcon } from "lucide-react";
import { AuthProvider, useAuth } from "./lib/auth";
import type { Role, User } from "./lib/types";
import { Button, Skeleton, usePageTitle } from "./components/ui";
import { Wordmark } from "./components/Logo";
import { NotificationBell } from "./components/NotificationBell";
import Login, { homeFor } from "./pages/Login";
import Search from "./pages/Search";
import ChargerDetail from "./pages/ChargerDetail";
import { BookingDetail, BookingList } from "./pages/Bookings";
import Owner, { NewCharger } from "./pages/Owner";
import Admin from "./pages/Admin";
import Vehicles from "./pages/Vehicles";
import Trip from "./pages/Trip";
import Info from "./pages/Info";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

function navFor(user: User): NavItem[] {
  const has = (r: Role) => user.roles.includes(r);
  return [
    ...(has("driver")
      ? [
          { to: "/", label: "Find chargers", icon: Map },
          { to: "/trip", label: "Plan a trip", icon: RouteIcon },
          { to: "/bookings", label: "Bookings", icon: CalendarCheck },
        ]
      : []),
    ...(has("owner") ? [{ to: "/owner", label: "Owner", icon: LayoutDashboard }] : []),
    ...(has("admin") ? [{ to: "/admin", label: "Trust & safety", icon: ShieldCheck }] : []),
  ];
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function AccountMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const role = user.roles.includes("admin") ? "Admin" : user.roles.includes("owner") ? (user.roles.includes("driver") ? "Owner · Driver" : "Owner") : "Driver";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition hover:bg-surface-3" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-extrabold">{initials(user.name)}</span>
        <span className="hidden text-sm font-bold lg:inline">{user.name}</span>
        <ChevronDown size={15} className="hidden text-muted lg:block" />
      </button>
      {open && (
        <div role="menu" className="animate-pop absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-line">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate text-sm font-extrabold">{user.name}</div>
            <div className="truncate text-xs text-muted">
              {user.email} · {role}
            </div>
          </div>
          {user.roles.includes("driver") && (
            <Link to="/vehicles" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold hover:bg-surface-2">
              <Car size={16} /> My EVs
            </Link>
          )}
          <button role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50">
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const items = navFor(user);
  return (
    <header className="sticky top-0 z-[1100] border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <NavLink to={homeFor(user)} aria-label="Amply home">
            <Wordmark size={34} />
          </NavLink>
          <nav className="hidden gap-1 md:flex" aria-label="Main">
            {items.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition ${isActive ? "bg-primary text-ink" : "text-muted-2 hover:bg-surface-3 hover:text-ink"}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <NotificationBell />
          <AccountMenu user={user} onLogout={logout} />
        </div>
      </div>
    </header>
  );
}

/** Cab-app style bottom tabs on phones. */
function BottomTabs() {
  const { user } = useAuth();
  if (!user) return null;
  const items = navFor(user).slice(0, 5);
  if (items.length < 2) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[1100] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold">
            {({ isActive }) => (
              <>
                <span className={`grid h-8 w-14 place-items-center rounded-full transition ${isActive ? "bg-primary text-ink" : "text-muted"}`}>
                  <Icon size={19} />
                </span>
                <span className={isActive ? "text-ink" : "text-muted"}>{label === "Find chargers" ? "Find" : label === "Plan a trip" ? "Trips" : label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function FullPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 pt-8 sm:px-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <div className="grid gap-4 pt-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

function Guard({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && !user.roles.includes(role)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSkeleton />;
  return user ? <Navigate to={homeFor(user)} replace /> : <Login />;
}

function NotFound() {
  usePageTitle("Page not found");
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="text-7xl font-black tracking-tighter">
        4<span className="text-primary-dark">0</span>4
      </div>
      <h1 className="mt-4 text-2xl">This page took a wrong turn</h1>
      <p className="mt-2 text-muted">The link may be old, or the page has moved.</p>
      <Link to="/" className="mt-6">
        <Button>Back to Amply</Button>
      </Link>
    </main>
  );
}

/** Keeps a crash in one screen from blanking the whole app. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Amply UI error", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <h1 className="text-2xl">Something went wrong</h1>
        <p className="mt-2 text-muted">Sorry about that. Reloading usually fixes it; your bookings are safe.</p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload Amply
        </Button>
      </main>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <TopBar />
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/info/:topic" element={<Info />} />
            <Route path="/" element={<Guard role="driver"><Search /></Guard>} />
            <Route path="/chargers/:id" element={<Guard><ChargerDetail /></Guard>} />
            <Route path="/vehicles" element={<Guard role="driver"><Vehicles /></Guard>} />
            <Route path="/trip" element={<Guard role="driver"><Trip /></Guard>} />
            <Route path="/bookings" element={<Guard role="driver"><BookingList /></Guard>} />
            <Route path="/bookings/:id" element={<Guard><BookingDetail /></Guard>} />
            <Route path="/owner" element={<Guard role="owner"><Owner /></Guard>} />
            <Route path="/owner/new" element={<Guard role="owner"><NewCharger /></Guard>} />
            <Route path="/admin" element={<Guard role="admin"><Admin /></Guard>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BottomTabs />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
