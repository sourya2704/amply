import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { User, Vehicle } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  vehicles: Vehicle[];
  vehicle: Vehicle | null;
  setVehicleId: (id: string) => void;
  reloadVehicles: () => Promise<void>;
  login: (email: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const VEHICLE_KEY = "amply_vehicle";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(VEHICLE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const reloadVehicles = useCallback(async () => {
    const vs = await api.get<Vehicle[]>("/api/vehicles");
    setVehicles(vs);
    setVehicleIdState((cur) => (vs.some((v) => v.id === cur) ? cur : vs[0]?.id ?? ""));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/api/me")
      .then(async (u) => {
        setUser(u);
        await reloadVehicles();
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [reloadVehicles]);

  const setVehicleId = (id: string) => {
    setVehicleIdState(id);
    try {
      localStorage.setItem(VEHICLE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const login = async (email: string) => {
    const res = await api.post<{ access_token: string; user: User }>("/api/auth/login", { email });
    setToken(res.access_token);
    setUser(res.user);
    await reloadVehicles();
    return res.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setVehicles([]);
  };

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  return (
    <AuthContext.Provider value={{ user, loading, vehicles, vehicle, setVehicleId, reloadVehicles, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** Fetch on mount + whenever deps change; optionally poll. */
export function useFetch<T>(load: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = (first: boolean) => {
      if (first) setLoading(true);
      load()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && first && setLoading(false));
    };
    run(true);
    const id = pollMs ? setInterval(() => run(false), pollMs) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs]);

  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
