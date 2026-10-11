// src/utils/userContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

type AppUser = {
  user_id: number;
  auth_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string | null;
  profile_photo?: string | null;
  is_active?: boolean;
  [key: string]: any;
};

type UserContextValue = {
  user: AppUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: AppUser | null) => void;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  setUser: () => {},
});

export const useUser = () => useContext(UserContext);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setUser(null);
        return;
      }
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', authUser.id)
        .maybeSingle();
      setUser((data as AppUser) || null);
    } catch (e) {
      console.warn('[UserProvider] refresh failed:', e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }
      refresh();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, refresh, setUser }}>
      {children}
    </UserContext.Provider>
  );
}