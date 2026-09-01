import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { getMonProfil } from "../services/db";
import type { Profile, UserRole } from "../types";

interface AuthContextType {
  session: Session | null;
  profil: Profile | null;
  loading: boolean;
  /** Erreur de chargement du profil (compte sans profil, ou désactivé). */
  erreurProfil: string | null;
  connexion: (email: string, motDePasse: string) => Promise<void>;
  deconnexion: () => Promise<void>;
  rafraichirProfil: () => Promise<void>;
  /** Raccourci d'autorisation, miroir des gardes de rôle de l'API. */
  peut: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

/**
 * §5.14 « Déconnexion automatique après inactivité ». Le délai est volontairement
 * codé ici plutôt que lu depuis les paramètres serveur : la déconnexion doit
 * fonctionner même si l'API est injoignable.
 */
const INACTIVITE_MINUTES = 30;
const EVENEMENTS_ACTIVITE = ["mousedown", "keydown", "touchstart", "scroll"] as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profil, setProfil] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreurProfil, setErreurProfil] = useState<string | null>(null);

  // --- Session Supabase ----------------------------------------------------
  useEffect(() => {
    // Supabase émet onAuthStateChange aussi pour les rafraîchissements de
    // jeton. Ne remplacer l'objet session que si le jeton a réellement changé
    // évite de faire repartir tous les useEffect([session]) de l'app en boucle.
    const appliquer = (suivante: Session | null) => {
      setSession((precedente) =>
        precedente?.access_token === suivante?.access_token ? precedente : suivante
      );
    };

    supabase.auth.getSession().then(({ data }) => {
      appliquer(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evenement, suivante) => {
      appliquer(suivante);
      if (!suivante) {
        setProfil(null);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // --- Profil applicatif ---------------------------------------------------
  const chargerProfil = useCallback(async () => {
    if (!session) {
      setProfil(null);
      setLoading(false);
      return;
    }
    try {
      setProfil(await getMonProfil());
      setErreurProfil(null);
    } catch (e) {
      // Compte authentifié mais sans profil actif : on le déconnecte pour ne
      // pas le laisser dans une application vide et sans explication.
      setProfil(null);
      setErreurProfil(e instanceof Error ? e.message : "Profil inaccessible.");
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void chargerProfil(); }, [chargerProfil]);

  // --- Déconnexion sur inactivité (§5.14) ----------------------------------
  const minuteur = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!session) return;

    const armer = () => {
      window.clearTimeout(minuteur.current);
      minuteur.current = window.setTimeout(() => {
        void supabase.auth.signOut();
      }, INACTIVITE_MINUTES * 60_000);
    };

    armer();
    EVENEMENTS_ACTIVITE.forEach((e) => window.addEventListener(e, armer, { passive: true }));
    return () => {
      window.clearTimeout(minuteur.current);
      EVENEMENTS_ACTIVITE.forEach((e) => window.removeEventListener(e, armer));
    };
  }, [session]);

  const connexion = async (email: string, motDePasse: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
    if (error) {
      // Message Supabase peu parlant pour un agent de caisse.
      throw new Error(
        error.message === "Invalid login credentials"
          ? "Identifiant ou mot de passe incorrect."
          : error.message
      );
    }
  };

  const deconnexion = async () => { await supabase.auth.signOut(); };

  const peut = useCallback(
    (...roles: UserRole[]) => !!profil && roles.includes(profil.role),
    [profil]
  );

  const value = useMemo(
    () => ({
      session, profil, loading, erreurProfil,
      connexion, deconnexion, rafraichirProfil: chargerProfil, peut,
    }),
    [session, profil, loading, erreurProfil, chargerProfil, peut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
