import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const hydrate = async (nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession?.user) {
        setProfile(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const [{ data: profileData }, { data: adminData }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", nextSession.user.id).maybeSingle(),
        supabase.from("admin_users").select("user_id").eq("user_id", nextSession.user.id).maybeSingle(),
      ]);

      if (!active) return;
      setProfile(profileData || null);
      setIsAdmin(Boolean(adminData));
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => hydrate(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      queueMicrotask(() => hydrate(nextSession));
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      profile,
      isAdmin,
      loading,
      signOut: () => supabase.auth.signOut(),
      refreshProfile: async () => {
        if (!session?.user) return;
        const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
        setProfile(data);
      },
    }),
    [session, profile, isAdmin, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
