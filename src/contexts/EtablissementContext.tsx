import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getEtablissements } from "../services/db";
import { useAuth } from "./AuthContext";
import type { Establishment, SelectionEtablissement } from "../types";

// ============================================================================
// Établissement courant.
//
// La papeterie et le restaurant sont deux entités distinctes : rien n'est
// additionné implicitement. Le propriétaire choisit explicitement d'en voir
// un seul ou le cumul ; un employé rattaché reste enfermé dans le sien, sans
// même voir le sélecteur.
// ============================================================================

interface EtablissementContextType {
  /** Établissements accessibles au profil connecté. */
  etablissements: Establishment[];
  /** Sélection courante : un identifiant, ou "tous" pour la vue consolidée. */
  selection: SelectionEtablissement;
  choisir: (s: SelectionEtablissement) => void;
  /** Établissement sélectionné, ou null en vue consolidée. */
  courant: Establishment | null;
  /** Nom affiché dans l'en-tête. */
  libelle: string;
  /** Le profil peut-il changer d'établissement (§5.1) ? */
  peutChanger: boolean;
  /**
   * Établissement à utiliser pour une écriture (vente, caisse, dépense…).
   * null en vue consolidée : on n'enregistre jamais « chez tout le monde ».
   */
  pourEcriture: number | null;
  /** Nom d'un établissement par son identifiant, pour les tableaux consolidés. */
  nomDe: (id: number) => string;
  /** Couleur d'un établissement, même usage. */
  couleurDe: (id: number) => string;
  chargement: boolean;
  erreur: string | null;
}

const EtablissementContext = createContext<EtablissementContextType>({} as EtablissementContextType);

const CLE_STOCKAGE = "eden.etablissement";

export function EtablissementProvider({ children }: { children: React.ReactNode }) {
  const { profil } = useAuth();
  const [etablissements, setEtablissements] = useState<Establishment[]>([]);
  const [selection, setSelection] = useState<SelectionEtablissement>("tous");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const peutChanger = profil?.establishmentId === null;

  useEffect(() => {
    if (!profil) return;
    let annule = false;
    setChargement(true);

    getEtablissements()
      .then((liste) => {
        if (annule) return;
        setEtablissements(liste);
        setErreur(null);

        // Un profil rattaché n'a aucun choix à faire : il est fixé sur le sien.
        if (profil.establishmentId !== null) {
          setSelection(profil.establishmentId);
          return;
        }

        // Le propriétaire retrouve son dernier établissement consulté. On
        // vérifie qu'il existe toujours : un établissement désactivé ne doit
        // pas laisser l'écran vide sans explication.
        const memorise = window.localStorage.getItem(CLE_STOCKAGE);
        if (memorise === "tous") {
          setSelection("tous");
        } else if (memorise && liste.some((e) => String(e.id) === memorise)) {
          setSelection(Number(memorise));
        } else {
          // Par défaut on ouvre sur un établissement précis, jamais sur un
          // cumul : le mélange doit toujours être un choix conscient.
          setSelection(liste[0]?.id ?? "tous");
        }
      })
      .catch((e) => { if (!annule) setErreur(e.message); })
      .finally(() => { if (!annule) setChargement(false); });

    return () => { annule = true; };
  }, [profil]);

  const choisir = useCallback(
    (s: SelectionEtablissement) => {
      if (!peutChanger) return;
      setSelection(s);
      try {
        window.localStorage.setItem(CLE_STOCKAGE, String(s));
      } catch {
        // Navigation privée ou stockage refusé : la sélection reste valable
        // pour la session, elle ne sera simplement pas mémorisée.
      }
    },
    [peutChanger]
  );

  const courant = useMemo(
    () => (typeof selection === "number" ? etablissements.find((e) => e.id === selection) ?? null : null),
    [selection, etablissements]
  );

  const value = useMemo<EtablissementContextType>(
    () => ({
      etablissements,
      selection,
      choisir,
      courant,
      libelle: courant?.nom ?? "Tous les établissements",
      peutChanger,
      pourEcriture: typeof selection === "number" ? selection : null,
      nomDe: (id: number) => etablissements.find((e) => e.id === id)?.nom ?? "—",
      couleurDe: (id: number) => etablissements.find((e) => e.id === id)?.couleur ?? "#a8a49c",
      chargement,
      erreur,
    }),
    [etablissements, selection, choisir, courant, peutChanger, chargement, erreur]
  );

  return (
    <EtablissementContext.Provider value={value}>{children}</EtablissementContext.Provider>
  );
}

export const useEtablissement = () => useContext(EtablissementContext);
