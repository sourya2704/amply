import type { ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { LogOut, Zap } from "lucide-react";
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

function Nav() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const has = (r: Role) => user.roles.includes(r);
  const links: [string, string][] = [
    ...(has("driver") ? ([["/", "Find chargers"], ["/bookings", "My bookings"]] as [string, string][]) : []),
    ...(has("owner") ? ([["/owner", "Owner"]] as [string, string][]) : []),
    ...(has("admin") ? ([["/admin", "Trust & safety"]] as [string, string][]) : []),
  ];
  return (
    <header className="sticky top-0 z-[1100] flex h-16 items-center justify-between gap-4 bg-navy px-4 text-white sm:px-6">
      <div className="flex min-w-0 items-center gap-6">
        <NavLink to={homeFor(user)} className="flex items-center gap-2 text-lg font-extrabold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-volt text-navy">
            <Zap size={18} fill="currentColor" />
          </span>
          <span className="hidden sm:inline">Amply</span>
        </NavLink>
        <nav className="flex gap-1 overflow-x-auto">
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap ${isActive ? "bg-white/15 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-slate-300 md:inline">{user.name}</span>
        <button onClick={logout} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Log out" title="Log out">
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
          <Route path="/" element={<Guard role="driver"><Search /></Guard>} />
          <Route path="/chargers/:id" element={<Guard><ChargerDetail /></Guard>} />
          <Route path="/vehicles" element={<Guard role="driver"><Vehicles /></Guard>} />
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
