import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  getToken: () => Promise<string | null>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Guard against redundant updates: Supabase fires onAuthStateChange for
    // token refreshes and even for getSession() calls made during API requests.
    // Replacing the session object on every fire changes the `user` reference,
    // which re-triggers every useEffect([user]) in the app, which makes another
    // API call, which fires onAuthStateChange again — an infinite loop. Only
    // update state when the access token actually changed.
    const apply = (next: Session | null) => {
      setSession((prev) => (prev?.access_token === next?.access_token ? prev : next));
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => apply(next));
    return () => subscription.unsubscribe();
  }, []);

  const user = useMemo(() => session?.user ?? null, [session]);

  const getToken = async () => session?.access_token ?? null;

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) throw error;
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const logout = () => supabase.auth.signOut();

  const value = useMemo(
    () => ({ user, loading, getToken, signInWithGoogle, signInWithEmail, signUpWithEmail, logout }),
    [user, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
