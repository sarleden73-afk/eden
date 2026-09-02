import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// ============================================================================
// Apparence : couleur d'accent et mode clair/sombre.
//
// C'est un confort personnel, pas un réglage d'entreprise : chacun travaille
// sur son poste, parfois de nuit au restaurant, parfois en plein soleil au
// comptoir. Le choix reste donc dans le navigateur de la personne, et non en
// base — inutile de faire un aller-retour serveur pour changer une couleur.
// ============================================================================

export type Accent = "vert" | "or" | "bleu" | "violet" | "terre";
export type ModeTheme = "clair" | "sombre" | "auto";

export const ACCENTS: { cle: Accent; nom: string; apercu: string }[] = [
  { cle: "vert", nom: "Vert Eden", apercu: "#1fa066" },
  { cle: "or", nom: "Or", apercu: "#c08d16" },
  { cle: "bleu", nom: "Bleu", apercu: "#2f6be0" },
  { cle: "violet", nom: "Violet", apercu: "#8348ec" },
  { cle: "terre", nom: "Terracotta", apercu: "#d4552a" },
];

export const MODES: { cle: ModeTheme; nom: string; description: string }[] = [
  { cle: "clair", nom: "Clair", description: "Fond blanc, lisible en plein jour." },
  { cle: "sombre", nom: "Sombre", description: "Fond foncé, reposant le soir." },
  { cle: "auto", nom: "Automatique", description: "Suit le réglage de l'appareil." },
];

interface ThemeContextType {
  accent: Accent;
  mode: ModeTheme;
  /** Mode réellement appliqué : « auto » résolu selon l'appareil. */
  sombre: boolean;
  choisirAccent: (a: Accent) => void;
  choisirMode: (m: ModeTheme) => void;
}

const ThemeContext = createContext<ThemeContextType>({} as ThemeContextType);

const CLE_ACCENT = "eden.accent";
const CLE_MODE = "eden.mode";

function lire<T extends string>(cle: string, valide: readonly T[], defaut: T): T {
  try {
    const v = window.localStorage.getItem(cle) as T | null;
    return v && valide.includes(v) ? v : defaut;
  } catch {
    // Navigation privée ou stockage refusé : on retombe sur le défaut.
    return defaut;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccent] = useState<Accent>(() =>
    lire(CLE_ACCENT, ACCENTS.map((a) => a.cle), "vert")
  );
  const [mode, setMode] = useState<ModeTheme>(() =>
    lire(CLE_MODE, MODES.map((m) => m.cle), "clair")
  );

  // Préférence système, suivie en direct pour le mode automatique.
  const [systemeSombre, setSystemeSombre] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const suivre = (e: MediaQueryListEvent) => setSystemeSombre(e.matches);
    mq.addEventListener("change", suivre);
    return () => mq.removeEventListener("change", suivre);
  }, []);

  const sombre = mode === "sombre" || (mode === "auto" && systemeSombre);

  // Les attributs sont posés sur <html> : le CSS y trouve les variables, et le
  // fond de page est correct avant même que React n'ait rendu quoi que ce soit.
  useEffect(() => {
    const racine = document.documentElement;
    racine.setAttribute("data-accent", accent);
    if (sombre) racine.setAttribute("data-theme", "dark");
    else racine.removeAttribute("data-theme");
    // Barres de défilement et champs natifs suivent le thème.
    racine.style.colorScheme = sombre ? "dark" : "light";
  }, [accent, sombre]);

  const choisirAccent = useCallback((a: Accent) => {
    setAccent(a);
    try { window.localStorage.setItem(CLE_ACCENT, a); } catch { /* stockage refusé */ }
  }, []);

  const choisirMode = useCallback((m: ModeTheme) => {
    setMode(m);
    try { window.localStorage.setItem(CLE_MODE, m); } catch { /* stockage refusé */ }
  }, []);

  const value = useMemo(
    () => ({ accent, mode, sombre, choisirAccent, choisirMode }),
    [accent, mode, sombre, choisirAccent, choisirMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
