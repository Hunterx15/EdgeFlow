/**
 * EdgeFlow - Auth context
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../api/endpoints';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('edgeflow.accessToken'));

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.refresh();
      setAccessToken(data.accessToken);
      localStorage.setItem('edgeflow.accessToken', data.accessToken);
      setUser(data.user);
      return data;
    } catch {
      setAccessToken(null); setUser(null);
      localStorage.removeItem('edgeflow.accessToken');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (accessToken) {
        try {
          const me = await authApi.me();
          if (!cancelled) setUser(me.user);
        } catch { await refresh(); }
      } else { await refresh(); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    setAccessToken(data.accessToken);
    localStorage.setItem('edgeflow.accessToken', data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch {}
    setAccessToken(null); setUser(null);
    localStorage.removeItem('edgeflow.accessToken');
  }, []);

  const value = { user, accessToken, loading, login, logout, refresh, setUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
