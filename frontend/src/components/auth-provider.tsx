"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiRequestError, authApi, type AuthUser } from "@/lib/auth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const current = await authApi.me();
        if (active) setUserState(current.user);
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 401) return;
        try {
          const refreshed = await authApi.refresh();
          if (active) setUserState(refreshed.user);
        } catch {
          if (active) setUserState(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void bootstrap();
    return () => { active = false; };
  }, []);

  const setUser = useCallback((next: AuthUser) => {
    setUserState(next);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUserState(null);
      setLoading(false);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, setUser, logout }), [user, loading, setUser, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth phải được dùng bên trong AuthProvider");
  return value;
}
