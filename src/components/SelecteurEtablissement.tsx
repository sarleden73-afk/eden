import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Layers, Store } from "lucide-react";
import { cn } from "../lib/utils";
import { useEtablissement } from "../contexts/EtablissementContext";

/**
 * Sélecteur d'établissement — le point d'entrée du multi-établissements.
 *
 * Le propriétaire bascule entre la papeterie, le restaurant, et le cumul.
 * Un employé rattaché ne voit pas de menu : son établissement est affiché tel
 * quel, sans chevron, pour qu'il n'y ait aucune ambiguïté sur l'endroit où il
 * travaille.
 */
export default function SelecteurEtablissement({ compact }: { compact?: boolean }) {
  const { etablissements, selection, choisir, courant, libelle, peutChanger } = useEtablissement();
  const [ouvert, setOuvert] = useState(false);
  const conteneur = useRef<HTMLDivElement>(null);

  // Ferme au clic extérieur et à l'échappement : sur tablette, un menu resté
  // ouvert masque la moitié de l'écran de vente.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: MouseEvent) => {
      if (conteneur.current && !conteneur.current.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", auClic);
    document.addEventListener("keydown", auClavier);
    return () => {
      document.removeEventListener("mousedown", auClic);
      document.removeEventListener("keydown", auClavier);
    };
  }, [ouvert]);

  const pastille = (couleur: string) => (
    <span
      className="h-2.5 w-2.5 rounded-full shrink-0"
      style={{ backgroundColor: couleur }}
      aria-hidden
    />
  );

  if (!peutChanger) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", compact ? "px-1" : "px-3 py-2")}>
        {courant ? pastille(courant.couleur) : <Store className="h-4 w-4 text-gray-500" />}
        <span className="text-sm font-medium text-gray-100 truncate">{libelle}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={conteneur}>
      <button
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        className={cn(
          "flex items-center gap-2 w-full rounded-lg transition-colors",
          "text-left hover:bg-gray-900",
          compact ? "px-2 py-1.5" : "px-3 py-2.5 bg-gray-900/60 border border-gray-800"
        )}
      >
        {courant ? pastille(courant.couleur) : <Layers className="h-4 w-4 text-gray-400 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-100 truncate">{libelle}</span>
          {!compact && (
            <span className="block text-[11px] text-gray-500 truncate">
              {courant?.activite ?? "Vue consolidée des deux pôles"}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-400 shrink-0 transition-transform",
            ouvert && "rotate-180"
          )}
        />
      </button>

      {ouvert && (
        <div
          role="listbox"
          className={cn(
            "absolute z-50 mt-1 w-full min-w-[240px] rounded-lg overflow-hidden",
            "bg-gray-900 border border-gray-800 shadow-xl"
          )}
        >
          {etablissements.map((e) => (
            <button
              key={e.id}
              role="option"
              aria-selected={selection === e.id}
              onClick={() => { choisir(e.id); setOuvert(false); }}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors",
                selection === e.id ? "bg-gray-800" : "hover:bg-gray-800/60"
              )}
            >
              {pastille(e.couleur)}
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-100 truncate">{e.nom}</span>
                {e.activite && (
                  <span className="block text-[11px] text-gray-500 truncate">{e.activite}</span>
                )}
              </span>
              {selection === e.id && <Check className="h-4 w-4 text-indigo-400 shrink-0" />}
            </button>
          ))}

          {/* La vue consolidée est volontairement à part, sous un séparateur :
              c'est un choix délibéré, pas une valeur par défaut. */}
          <div className="border-t border-gray-800">
            <button
              role="option"
              aria-selected={selection === "tous"}
              onClick={() => { choisir("tous"); setOuvert(false); }}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors",
                selection === "tous" ? "bg-gray-800" : "hover:bg-gray-800/60"
              )}
            >
              <Layers className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-100">Tous les établissements</span>
                <span className="block text-[11px] text-gray-500">Cumul, sans saisie possible</span>
              </span>
              {selection === "tous" && <Check className="h-4 w-4 text-indigo-400 shrink-0" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
