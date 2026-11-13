import type { MeResponse } from "@firstfive/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, ApiError, post } from "./api";
import { FullPageSpinner } from "../components/ui";

interface AuthValue {
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setMe: (me: MeResponse | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<MeResponse>("/api/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const value: AuthValue = {
    me: q.data ?? null,
    loading: q.isLoading,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    setMe: (me) => qc.setQueryData(["me"], me),
    logout: async () => {
      await post("/api/auth/logout");
      // Keep the "me" query (its observer must see null); drop every other cached private result.
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

export function RequireAuth({ children, superadmin = false }: { children: ReactNode; superadmin?: boolean }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (superadmin && me.user.role !== "superadmin") return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** Workspace gate: accounts without a paid or complimentary entitlement go to the access options. Server enforces the same rule. */
export function RequireAccess({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const location = useLocation();
  if (me && me.entitlement.status === "none" && me.user.role !== "superadmin") {
    return <Navigate to="/access" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
