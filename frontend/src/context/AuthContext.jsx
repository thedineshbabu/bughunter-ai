import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, try to restore session from localStorage
  useEffect(() => {
    const token = localStorage.getItem('bughunter_token');
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      api.get('/auth/me')
        .then(res => setUser(res.data.user))
        .catch(() => {
          localStorage.removeItem('bughunter_token');
          delete api.defaults.headers.common['Authorization'];
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token, user: userData } = res.data;
    localStorage.setItem('bughunter_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(userData);
    return userData;
  }, []);

  const register = useCallback(async (email, password, name) => {
    const res = await api.post('/auth/register', { email, password, name });
    const { token, user: userData } = res.data;
    localStorage.setItem('bughunter_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('bughunter_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const res = await api.patch('/auth/profile', payload);
    setUser(res.data.user);
    return res.data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
