import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Car, Coffee, Home, MapPin, ShieldCheck, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import type { User } from "../lib/types";
import { Button, ErrorNote } from "../components/ui";
import PhoneDemo from "../components/PhoneDemo";
import { SiteFooter } from "../components/SiteFooter";
import { Sticker } from "../components/Sticker";
import { AMark, Wordmark } from "../components/Logo";

/** "Amply" in a cursive script, set vertically beside the login card: the brand's signature wordmark. */
function CursiveLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`items-center justify-center gap-5 self-stretch ${className}`} aria-label="Amply">
      <span className="font-script rotate-180 text-8xl leading-none text-ink [writing-mode:vertical-rl] xl:text-9xl">Amply</span>
      <div className="flex flex-col items-center gap-3 self-stretch py-6">
        <AMark size={42} className="rotate-6" />
        <span className="w-2.5 flex-1 rounded-full bg-primary" />
        <span className="rotate-180 text-[11px] font-bold tracking-[0.3em] text-muted uppercase [writing-mode:vertical-rl]">Charge anywhere</span>
      </div>
    </div>
  );
}

export function homeFor(u: User) {
  if (u.roles.includes("admin")) return "/admin";
  if (u.roles.includes("owner")) return "/owner";
  return "/";
}

function describe(u: User) {
  if (u.roles.includes("admin")) return { Icon: ShieldCheck, label: "Admin" };
  if (u.email.startsWith("cafe")) return { Icon: Coffee, label: "Café owner" };
  if (u.roles.includes("owner")) return { Icon: Home, label: u.roles.includes("driver") ? "Owner + driver" : "Home owner" };
  return { Icon: Car, label: "EV driver" };
}

// Password of the seeded demo accounts (backend/seed/users.json).
const DEMO_PASSWORD = "demo1234";

const ROLES = [
  { role: "driver", label: "Charge my EV", Icon: Car },
  { role: "owner", label: "Share my charger", Icon: Zap },
];

const input =
  "w-full rounded-2xl bg-surface-2 px-4 py-3.5 text-sm font-medium text-ink outline-none ring-2 ring-transparent transition placeholder:text-muted focus:bg-surface focus:ring-primary";

export default function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const { data: demo } = useFetch(() => api.get<User[]>("/api/auth/demo-users"), []);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [roles, setRoles] = useState<string[]>(["driver"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async (fn: () => Promise<User>) => {
    setBusy(true);
    setErr(null);
    try {
      nav(homeFor(await fn()));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(() => (mode === "login" ? login(f.email, f.password) : register(f.name, f.email, f.password, roles)));
  };

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex items-center justify-between px-5 py-4 sm:px-10">
        <Wordmark size={42} />
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-3.5 py-1.5 text-xs font-bold">
          <MapPin size={13} /> Currently in Bengaluru
        </span>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-5 pt-4 pb-16 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14 lg:pt-10">
        <section>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary-ink">
            <Zap size={12} fill="currentColor" /> EV charging, the cab-app way
          </span>
          <div className="mt-4 flex items-start gap-6">
            <h1 className="text-5xl leading-[1.02] sm:text-6xl lg:text-5xl">
              Charge anywhere.
              <br />
              <span className="highlight">Power together.</span>
            </h1>
            {/* bookmark ribbon */}
            <div
              className="-mt-8 hidden w-28 shrink-0 rotate-2 bg-[#fff1a6] px-3 pt-8 pb-7 text-center shadow-[0_8px_18px_-8px_#0005] sm:block"
              style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%)" }}
            >
              <span className="block text-[10px] font-bold tracking-[0.18em] text-ink/60 uppercase">Solving</span>
              <span className="mt-1 block text-sm leading-tight font-extrabold">EV charging for India</span>
            </div>
          </div>
          <p className="mt-4 max-w-md text-lg text-muted-2">
            Find a charger that fits your EV, book a neighbour's or a café's in two taps, and let the AI sort the rest.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 pl-1">
            <Sticker tone="black" rotate={4}>
              no cap
            </Sticker>
            <Sticker tone="yellow" rotate={-5}>
              range anxiety? who
            </Sticker>
            <Sticker tone="green" rotate={3}>
              your charger = side hustle
            </Sticker>
            <Sticker tone="soft" rotate={-2}>
              neighbour-powered
            </Sticker>
          </div>

          <div className="mt-7 flex items-stretch gap-10">
            {/* auth card, styled like a cab app's "Where to?" box */}
            <div className="w-full max-w-md shrink-0 rounded-3xl bg-surface p-5 shadow-[0_2px_4px_#0000000a,0_20px_50px_-20px_#00000040] ring-1 ring-line">
              <div className="mb-4 flex rounded-full bg-surface-3 p-1 text-sm font-bold">
                {(["login", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setErr(null);
                    }}
                    className={`flex-1 rounded-full py-2 transition ${mode === m ? "bg-surface text-ink shadow" : "text-muted hover:text-ink"}`}
                  >
                    {m === "login" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-2.5">
                {mode === "signup" && (
                  <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} autoComplete="name" placeholder="Your name" aria-label="Name" />
                )}
                <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={input} autoComplete="email" placeholder="Email" aria-label="Email" />
                <input
                  required
                  type="password"
                  minLength={mode === "signup" ? 8 : undefined}
                  value={f.password}
                  onChange={(e) => setF({ ...f, password: e.target.value })}
                  className={input}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
                  aria-label="Password"
                />
                {mode === "signup" && (
                  <div className="grid grid-cols-2 gap-2 pt-1 text-sm">
                    {ROLES.map(({ role, label, Icon }) => (
                      <label
                        key={role}
                        className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-2xl px-3 py-3 font-bold transition ${roles.includes(role) ? "bg-primary-soft text-ink ring-2 ring-primary" : "bg-surface-2 text-muted-2 hover:bg-surface-3"}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={roles.includes(role)}
                          onChange={() => setRoles(roles.includes(role) ? roles.filter((x) => x !== role) : [...roles, role])}
                        />
                        <Icon size={15} /> {label}
                      </label>
                    ))}
                  </div>
                )}
                <ErrorNote message={err} />
                <Button type="submit" variant="primary" className="w-full py-3.5 text-base" disabled={busy || (mode === "signup" && roles.length === 0)}>
                  {busy ? "One sec…" : mode === "login" ? "Let's go" : "Create my account"}
                </Button>
              </form>

              {demo && demo.length > 0 && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-xs font-bold tracking-wide text-muted uppercase">Or try a demo account</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {demo.map((u) => {
                      const { Icon, label } = describe(u);
                      return (
                        <button
                          key={u.id}
                          onClick={() => go(() => login(u.email, DEMO_PASSWORD))}
                          disabled={busy}
                          className="group flex items-center gap-2 rounded-2xl bg-surface-2 p-2.5 text-left transition hover:bg-primary-soft disabled:opacity-60"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm transition group-hover:bg-primary">
                            <Icon size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{u.name}</span>
                            <span className="block text-[11px] text-muted">{label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* vertical cursive wordmark fills the space beside the card (stacked layouts only) */}
            <CursiveLogo className="hidden flex-1 sm:flex lg:hidden" />
          </div>
        </section>

        {/* live mini-demo of the app on a pink panel */}
        <section className="relative flex items-center justify-center overflow-hidden rounded-[2rem] bg-primary px-6 py-10 sm:py-12 lg:min-h-[640px]">
          <div className="pointer-events-none absolute -top-20 -right-16 h-72 w-72 rounded-full bg-white/30" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-80 w-80 rounded-full bg-primary-dark/40" />
          <div className="relative">
            <PhoneDemo />
            <div className="absolute top-20 -left-28 hidden flex-col items-start gap-24 sm:flex">
              <Sticker tone="white" rotate={-7} className="animate-float">
                fits your Nexon
              </Sticker>
              <Sticker tone="black" rotate={4} className="animate-float [animation-delay:2s]">
                0.4 km away
              </Sticker>
            </div>
            <div className="absolute top-10 -right-28 hidden flex-col items-end gap-40 sm:flex">
              <Sticker tone="white" rotate={6} className="animate-float [animation-delay:1s]">
                plug & chill
              </Sticker>
              <Sticker tone="white" rotate={-4} className="animate-float [animation-delay:3s]">
                address after payment
              </Sticker>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
