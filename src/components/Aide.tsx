import React, { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import type { UserRole } from "../types";

/**
 * Mode d'emploi d'un écran.
 *
 * Encadré court, refermable, rangé en haut de chaque écran de direction. Il
 * répond à « à quoi sert cette page et comment la lire », pas à « où cliquer » :
 * un mode d'emploi qui décrit les boutons devient faux dès la première
 * modification, alors que l'intention d'un écran, elle, ne bouge pas.
 *
 * Une fois refermé, il ne revient plus : le choix est retenu par écran dans le
 * navigateur. Quelqu'un qui connaît son outil n'a pas à écarter le même
 * bandeau tous les matins.
 */
export default function Aide({
  cle,
  titre = "Mode d'emploi",
  pour = ["admin", "responsable"],
  children,
}: {
  /** Identifiant de l'écran, pour retenir la fermeture. */
  cle: string;
  titre?: string;
  /** Rôles à qui l'aide s'adresse. */
  pour?: UserRole[];
  children: React.ReactNode;
}) {
  const { profil } = useAuth();
  const stockage = `eden.aide.${cle}`;

  const [ferme, setFerme] = useState(() => {
    try { return window.localStorage.getItem(stockage) === "1"; } catch { return false; }
  });

  if (ferme || !profil || !pour.includes(profil.role)) return null;

  const fermer = () => {
    setFerme(true);
    try { window.localStorage.setItem(stockage, "1"); } catch { /* stockage refusé */ }
  };

  return (
    <div className="flex items-start gap-3 p-4 mb-5 bg-indigo-50/70 border border-indigo-200 rounded-lg">
      <HelpCircle className="h-5 w-5 text-indigo-600 shrink-0 mt-px" aria-hidden />
      <div className="min-w-0 flex-1 text-sm text-indigo-950">
        <p className="font-semibold mb-1">{titre}</p>
        <div className="space-y-1.5 leading-relaxed [&_strong]:font-semibold">{children}</div>
      </div>
      <button
        onClick={fermer}
        className="p-1 -m-1 rounded hover:bg-indigo-100 shrink-0"
        aria-label="Masquer ce mode d'emploi"
        title="Masquer ce mode d'emploi"
      >
        <X className="h-4 w-4 text-indigo-500" />
      </button>
    </div>
  );
}
