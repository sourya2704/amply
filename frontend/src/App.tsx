import type { ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { LogOut } from "lucide-react";
import { AuthProvider, useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import { Spinner } from "./components/ui";
import Login, { homeFor } from "./pages/Login";
import Search from "./pages/Search";
import ChargerDetail from "./pages/ChargerDetail";
import { BookingDetail, BookingList } from "./pages/Bookings";
import Owner, { NewCharger } from "./pages/Owner";
import Admin from "./pages/Admin";
import Vehicles from "./pages/Vehicles";
import Trip from "./pages/Trip";
import { NotificationBell } from "./components/NotificationBell";
import Info from "./pages/Info";
import { Wordmark } from "./components/Logo";

function Nav() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const has = (r: Role) => user.roles.includes(r);
  const links: [string, string][] = [
    ...(has("driver") ? ([["/", "Find chargers"], ["/trip", "Plan a trip"], ["/bookings", "My bookings"]] as [string, string][]) : []),
    ...(has("owner") ? ([["/owner", "Owner"]] as [string, string][]) : []),
    ...(has("admin") ? ([["/admin", "Trust & safety"]] as [string, string][]) : []),
  ];
  return (
    <header className="sticky top-0 z-[1100] flex h-16 items-center justify-between gap-4 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-6">
        <NavLink to={homeFor(user)} aria-label="Amply home">
          <Wordmark size={36} compact />
        </NavLink>
        <nav className="flex gap-1 overflow-x-auto">
          {links.map(([to, label]) => (
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
      <div className="flex items-center gap-3">
        <NotificationBell />
        <span className="hidden items-center gap-2 text-sm font-semibold md:flex"><span className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-xs font-extrabold text-primary-ink">{user.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>{user.name}</span>
        <button onClick={logout} className="rounded-full p-2 text-muted-2 hover:bg-surface-3 hover:text-ink" aria-label="Log out" title="Log out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function Guard({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && !user.roles.includes(role)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? <Navigate to={homeFor(user)} replace /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
