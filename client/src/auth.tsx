import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiRequestError } from "./api.ts";
import type { User } from "@shared/types.ts";

type AuthState = {
  user: User | null;
  /** True until the initial /auth/me check resolves, so guards don't flash the login page. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; password: string; name: string; householdName: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((error: unknown) => {
        // A 401 here just means "not signed in"; anything else is worth surfacing.
        if (!(error instanceof ApiRequestError && error.status === 401)) console.error(error);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.login({ email, password }));
  }, []);

  const signup = useCallback(async (input: Parameters<typeof api.signup>[0]) => {
    setUser(await api.signup(input));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
