import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [securityPolicy, setSecurityPolicy] = useState({
    smsProviderReady: false,
    customerSmsMfaRequired: false,
    brandedEmailReady: false,
  });
  const [aal, setAal] = useState("aal1");
  const [phoneMfaVerified, setPhoneMfaVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSecurityPolicy = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [
        "sms_provider_ready",
        "customer_sms_mfa_required",
        "branded_email_ready",
      ]);
    const values = Object.fromEntries(
      (data || []).map((row) => [row.key, Boolean(row.value)]),
    );
    setSecurityPolicy({
      smsProviderReady: Boolean(values.sms_provider_ready),
      customerSmsMfaRequired: Boolean(values.customer_sms_mfa_required),
      brandedEmailReady: Boolean(values.branded_email_ready),
    });
  };

  useEffect(() => {
    loadSecurityPolicy();
  }, []);

  useEffect(() => {
    let active = true;
    let hydrateVersion = 0;

    const hydrate = async (nextSession) => {
      const version = ++hydrateVersion;
      if (!active) return;
      setSession(nextSession);
      if (!nextSession?.user) {
        setProfile(null);
        setIsAdmin(false);
        setAal("aal1");
        setPhoneMfaVerified(false);
        setLoading(false);
        return;
      }

      const [
        { data: profileData },
        { data: adminData },
        assuranceResult,
        factorsResult,
      ] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", nextSession.user.id).maybeSingle(),
        supabase.from("admin_users").select("user_id").eq("user_id", nextSession.user.id).maybeSingle(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

      if (!active || version !== hydrateVersion) return;
      setProfile(profileData || null);
      setIsAdmin(Boolean(adminData));
      setAal(assuranceResult.data?.currentLevel || "aal1");
      setPhoneMfaVerified(
        Boolean(
          factorsResult.data?.phone?.some(
            (factor) => factor.status === "verified",
          ),
        ),
      );
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
      aal,
      phoneMfaVerified,
      securityPolicy,
      requiresCustomerMfa:
        securityPolicy.smsProviderReady &&
        securityPolicy.customerSmsMfaRequired,
      loading,
      signOut: () => supabase.auth.signOut(),
      refreshProfile: async () => {
        if (!session?.user) return;
        const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
        setProfile(data);
      },
      refreshSecurity: async () => {
        await loadSecurityPolicy();
        const [{ data: assurance }, { data: factors }] = await Promise.all([
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
          supabase.auth.mfa.listFactors(),
        ]);
        setAal(assurance?.currentLevel || "aal1");
        setPhoneMfaVerified(
          Boolean(
            factors?.phone?.some((factor) => factor.status === "verified"),
          ),
        );
      },
    }),
    [
      session,
      profile,
      isAdmin,
      aal,
      phoneMfaVerified,
      securityPolicy,
      loading,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
