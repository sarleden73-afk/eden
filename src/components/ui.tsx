import React from "react";
import { LucideIcon, X, Loader2, Inbox, AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";
import type { PeriodKey } from "../types";
import { fcfa } from "../lib/format";

// ============================================================================
// Composants partagés. Regroupés dans un seul fichier : ils sont courts, et les
// avoir sous les yeux ensemble est ce qui garde les 14 écrans homogènes.
// ============================================================================

export function PageHeader({
  titre, sousTitre, children,
}: { titre: string; sousTitre?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{titre}</h1>
        {sousTitre && <p className="mt-1 text-sm text-gray-500">{sousTitre}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("bg-white rounded-xl border border-gray-200 shadow-sm", className)}>
      {children}
    </div>
  );
}

type BoutonVariante = "primaire" | "secondaire" | "danger" | "fantome";

const VARIANTES: Record<BoutonVariante, string> = {
  primaire: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
  secondaire: "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  fantome: "text-gray-600 hover:bg-gray-100",
};

export function Bouton({
  variante = "primaire", icone: Icone, chargement, className, children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: BoutonVariante; icone?: LucideIcon; chargement?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || chargement}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        VARIANTES[variante],
        className
      )}
    >
      {chargement ? <Loader2 className="h-4 w-4 animate-spin" /> : Icone && <Icone className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Champ({
  label, aide, erreur, children,
}: { label: string; aide?: string; erreur?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1.5">{label}</span>
      {children}
      {aide && !erreur && <span className="block mt-1 text-xs text-gray-500">{aide}</span>}
      {erreur && <span className="block mt-1 text-xs text-red-600">{erreur}</span>}
    </label>
  );
}

const STYLE_SAISIE =
  "w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent " +
  "disabled:bg-gray-100 disabled:text-gray-500";

export const Saisie = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Saisie({ className, ...props }, ref) {
    return <input ref={ref} {...props} className={cn(STYLE_SAISIE, className)} />;
  }
);

export function Liste({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(STYLE_SAISIE, className)}>{children}</select>;
}

export function Zone({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(STYLE_SAISIE, "min-h-[80px]", className)} />;
}

type TonBadge = "neutre" | "succes" | "alerte" | "danger" | "info";

const TONS: Record<TonBadge, string> = {
  neutre: "bg-gray-100 text-gray-700",
  succes: "bg-green-100 text-green-800",
  alerte: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-indigo-100 text-indigo-800",
};

export function Badge({ ton = "neutre", children }: { ton?: TonBadge; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap", TONS[ton])}>
      {children}
    </span>
  );
}

export function Modale({
  ouverte, titre, onFermer, taille = "md", children,
}: {
  ouverte: boolean; titre: string; onFermer: () => void;
  taille?: "md" | "lg" | "xl"; children: React.ReactNode;
}) {
  if (!ouverte) return null;
  const largeur = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[taille];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-gray-950/50" onClick={onFermer} />
      <div className={cn(
        "relative bg-white w-full rounded-t-2xl sm:rounded-xl shadow-xl",
        "max-h-[92vh] flex flex-col", largeur
      )}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{titre}</h2>
          <button onClick={onFermer} className="p-1 -mr-1 rounded-lg hover:bg-gray-100" aria-label="Fermer">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Chargement({ texte = "Chargement…" }: { texte?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      <p className="mt-3 text-sm">{texte}</p>
    </div>
  );
}

export function Vide({
  titre, description, icone: Icone = Inbox, children,
}: { titre: string; description?: string; icone?: LucideIcon; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="p-3 bg-gray-100 rounded-full">
        <Icone className="h-7 w-7 text-gray-400" />
      </div>
      <p className="mt-4 font-medium text-gray-900">{titre}</p>
      {description && <p className="mt-1 text-sm text-gray-500 max-w-sm">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

export function Erreur({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg">
      <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-px" />
      <p className="text-sm text-red-800">{message}</p>
    </div>
  );
}

/** Tableau responsive : défile horizontalement au lieu d'élargir la page. */
export function Tableau({ entetes, children }: { entetes: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {entetes.map((e, i) => (
              <th
                key={i}
                className={cn(
                  "px-4 py-3 font-medium text-gray-600 whitespace-nowrap",
                  // Une entête qui commence par un espace insécable signale une
                  // colonne de chiffres, alignée à droite.
                  typeof e === "string" && e.startsWith(" ") ? "text-right" : "text-left"
                )}
              >
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

export function StatCard({
  titre, valeur, icone: Icone, detail, ton = "neutre",
}: {
  titre: string; valeur: string | number; icone: LucideIcon;
  detail?: string; ton?: "neutre" | "succes" | "danger";
}) {
  const couleurValeur = {
    neutre: "text-gray-900", succes: "text-green-700", danger: "text-red-700",
  }[ton];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-500 truncate">{titre}</p>
          <p className={cn("mt-2 text-2xl font-bold tabulaire truncate", couleurValeur)}>{valeur}</p>
          {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
        </div>
        <div className="p-2.5 bg-indigo-50 rounded-lg shrink-0">
          <Icone className="h-5 w-5 text-indigo-600" />
        </div>
      </div>
    </Card>
  );
}

/** Montant mis en valeur (or) — réservé aux totaux. */
export function Montant({ valeur, gras }: { valeur: number; gras?: boolean }) {
  return (
    <span className={cn("tabulaire text-amber-600", gras && "font-semibold")}>{fcfa(valeur)}</span>
  );
}

const PERIODES: { cle: PeriodKey; label: string }[] = [
  { cle: "jour", label: "Aujourd'hui" },
  { cle: "semaine", label: "Semaine" },
  { cle: "mois", label: "Mois" },
  { cle: "annee", label: "Année" },
  { cle: "personnalise", label: "Période…" },
];

/** §5.11 : aujourd'hui, semaine, mois, année et période personnalisée. */
export function SelecteurPeriode({
  periode, debut, fin, onChange,
}: {
  periode: PeriodKey; debut: string; fin: string;
  onChange: (v: { periode: PeriodKey; debut: string; fin: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
        {PERIODES.map((p) => (
          <button
            key={p.cle}
            onClick={() => onChange({ periode: p.cle, debut, fin })}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              periode === p.cle ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {periode === "personnalise" && (
        <div className="flex items-center gap-2">
          <Saisie
            type="date" value={debut} className="py-1.5 w-auto"
            onChange={(e) => onChange({ periode, debut: e.target.value, fin })}
          />
          <span className="text-gray-400 text-sm">au</span>
          <Saisie
            type="date" value={fin} className="py-1.5 w-auto"
            onChange={(e) => onChange({ periode, debut, fin: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
