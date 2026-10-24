import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Car, Coffee, Home, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import type { User } from "../lib/types";
import { ErrorNote, Spinner } from "../components/ui";

export function homeFor(u: User) {
  if (u.roles.includes("admin")) return "/admin";
  if (u.roles.includes("owner")) return "/owner";
  return "/";
}

function describe(u: User) {
  if (u.roles.includes("admin")) return { Icon: ShieldCheck, label: "Admin · verifies listings & risk" };
  if (u.email.startsWith("cafe")) return { Icon: Coffee, label: "Business owner" };
  if (u.roles.includes("owner")) return { Icon: Home, label: u.roles.includes("driver") ? "Home charger owner + driver" : "Home charger owner" };
  return { Icon: Car, label: "EV driver" };
}

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { data: users, error } = useFetch(() => api.get<User[]>("/api/auth/demo-users"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (email: string) => {
    setBusy(email);
    try {
      nav(homeFor(await login(email)));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative flex flex-col justify-between overflow-hidden bg-navy p-8 text-white sm:p-12">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand/40 blur-3xl" />
        <div className="absolute bottom-0 -left-20 h-72 w-72 rounded-full bg-cyan/30 blur-3xl" />
        <div className="relative flex items-center gap-2 text-xl font-extrabold">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-volt text-navy">
            <Zap size={20} fill="currentColor" />
          </span>
          Amply
        </div>
        <div className="relative my-12">
          <h1 className="text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
            Charge Anywhere.
            <br />
            <span className="text-volt">Power Together.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-slate-300">
            Find and book compatible EV chargers from homes, cafés and public stations, with an AI assistant that never guesses.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-200">
            {[
              "Only chargers that fit your EV, with honest availability labels",
              "Book a home charger in a few taps; the owner approves",
              "AI finds, explains and books, but only after you confirm",
            ].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <Sparkles size={16} className="shrink-0 text-volt" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">Prototype · Bengaluru pilot · demo data</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold">Log in to the demo</h2>
          <p className="mt-1 text-sm text-slate-500">Pick an account. Open a second browser window to play another role.</p>
          <div className="mt-6 space-y-3">
            <ErrorNote message={error ?? err} />
            {!users && !error && <Spinner />}
            {users?.map((u) => {
              const { Icon, label } = describe(u);
              return (
                <button
                  key={u.id}
                  onClick={() => pick(u.email)}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand/50 disabled:opacity-60"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-brand">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{u.name}</span>
                    <span className="block text-xs text-slate-500">{label}</span>
                  </span>
                  <span className="text-sm font-semibold text-brand">{busy === u.email ? "…" : "→"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
