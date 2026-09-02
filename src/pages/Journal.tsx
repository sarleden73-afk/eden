import { Fragment, useCallback, useEffect, useState } from "react";
import { History, FileDown, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Liste, Erreur, Chargement, Badge, Tableau, Vide,
  SelecteurPeriode,
} from "../components/ui";
import Aide from "../components/Aide";
import { getJournal } from "../services/db";
import { dateHeure, fcfa, aujourdhui } from "../lib/format";
import { exporterListePDF } from "../lib/export";
import { useEtablissement } from "../contexts/EtablissementContext";
import type { AuditEntry, PeriodKey } from "../types";

/**
 * §5.10 Contrôle interne et traçabilité.
 *
 * Le journal regroupe toutes les opérations, pas seulement les gestes de
 * contrôle : ventes, dépenses, achats, caisse, stock, commandes et pointages y
 * figurent au même titre que les annulations et les changements de prix. Une
 * personne qui cherche « ce qui s'est passé hier » ne devrait pas avoir à
 * savoir d'avance dans quel écran regarder.
 *
 * Les opérations sensibles restent distinguées, en rouge : les noyer dans le
 * flot ferait perdre au journal sa fonction de contrôle.
 */

const LIBELLES_ACTION: Record<string, string> = {
  // Opérations courantes
  vente: "Vente",
  vente_annulee: "Vente annulée",
  depense: "Dépense",
  achat: "Achat",
  commande: "Commande",
  pointage: "Pointage",
  mouvement_stock: "Mouvement de stock",

  // Gestes de contrôle tracés
  annulation_vente: "Annulation de vente",
  modification_prix: "Modification de prix",
  modification_produit: "Modification d'article",
  creation_produit: "Création d'article",
  ouverture_caisse: "Ouverture de caisse",
  fermeture_caisse: "Fermeture de caisse",
  mouvement_caisse: "Mouvement de caisse",
  ajustement_stock: "Ajustement de stock",
  creation_utilisateur: "Création de compte",
  modification_utilisateur: "Modification de compte",
  reinitialisation_mot_de_passe: "Réinitialisation de mot de passe",
  creation_depense: "Création de dépense",
  validation_depense: "Validation de dépense",
  creation_achat: "Création d'achat",
  reglement_achat: "Règlement d'achat",
  creation_commande: "Création de commande",
  modification_commande: "Modification de commande",
  creation_pack: "Création de pack",
  modification_pack: "Modification de pack",
  modification_parametres: "Modification des paramètres",
};

/** Les actions qui méritent l'attention d'un contrôleur ressortent en rouge. */
const ACTIONS_SENSIBLES = new Set([
  "annulation_vente",
  "vente_annulee",
  "modification_prix",
  "ajustement_stock",
  "reinitialisation_mot_de_passe",
  "modification_utilisateur",
]);

/** Actions filtrables : seules les traces d'audit portent une action nommée. */
const ACTIONS_TRACEES = Object.keys(LIBELLES_ACTION).filter(
  (a) => !["vente", "vente_annulee", "depense", "achat", "commande", "pointage", "mouvement_stock"].includes(a)
);

/** Libellé affiché dans la colonne « Domaine ». */
const ENTITES: Record<string, string> = {
  sales: "Ventes",
  products: "Catalogue",
  cash_sessions: "Caisse",
  cash_movements: "Caisse",
  stock_movements: "Stocks",
  expenses: "Dépenses",
  purchases: "Achats",
  orders: "Commandes",
  pointages: "Pointages",
  profiles: "Personnel",
  packs: "Packs",
  settings: "Paramètres",
};

/**
 * Choix du filtre. Liste distincte de ENTITES : deux domaines s'affichent tous
 * deux comme « Caisse », mais se filtrent séparément — un menu qui proposerait
 * deux fois la même entrée n'en sélectionnerait jamais qu'une.
 */
const DOMAINES: { valeur: string; label: string }[] = [
  { valeur: "sales", label: "Ventes" },
  { valeur: "expenses", label: "Dépenses" },
  { valeur: "purchases", label: "Achats" },
  { valeur: "orders", label: "Commandes" },
  { valeur: "cash_sessions", label: "Caisse — ouvertures et fermetures" },
  { valeur: "cash_movements", label: "Caisse — mouvements" },
  { valeur: "stock_movements", label: "Stocks" },
  { valeur: "pointages", label: "Pointages" },
  { valeur: "products", label: "Catalogue" },
  { valeur: "packs", label: "Packs" },
  { valeur: "profiles", label: "Personnel" },
  { valeur: "settings", label: "Paramètres" },
];

export default function Journal() {
  const { selection, libelle } = useEtablissement();
  const [periode, setPeriode] = useState<PeriodKey>("semaine");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());

  const [entrees, setEntrees] = useState<AuditEntry[]>([]);
  const [tronque, setTronque] = useState(false);
  const [filtreEntite, setFiltreEntite] = useState("");
  const [filtreAction, setFiltreAction] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [deplie, setDeplie] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await getJournal(periode, {
        debut, fin, etablissement: selection,
        entite: filtreEntite || undefined,
        action: filtreAction || undefined,
      });
      setEntrees(r.entrees);
      setTronque(r.tronque);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [periode, debut, fin, selection, filtreEntite, filtreAction]);

  useEffect(() => { void recharger(); }, [recharger]);

  const sensibles = entrees.filter((e) => ACTIONS_SENSIBLES.has(e.action));

  const exporter = () =>
    exporterListePDF(
      "journal-eden",
      ["Date et heure", "Auteur", "Opération", "Domaine", "Référence", "Établissement", "Détail", "Montant"],
      entrees.map((e) => [
        dateHeure(e.createdAt), e.userNom ?? "",
        LIBELLES_ACTION[e.action] ?? e.action,
        ENTITES[e.entite] ?? e.entite, e.entiteId ?? "",
        e.etablissement ?? "", e.motif ?? "",
        e.montant ? fcfa(e.montant) : "",
      ]),
      { titre: "Journal des opérations", perimetre: libelle }
    );

  return (
    <Layout>
      <PageHeader
        titre="Journal des opérations"
        sousTitre={`${libelle} — tout ce qui a été fait, par qui et quand`}
      >
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <Liste value={filtreEntite} onChange={(e) => setFiltreEntite(e.target.value)} className="w-auto py-1.5">
          <option value="">Tous les domaines</option>
          {DOMAINES.map((d) => <option key={d.valeur} value={d.valeur}>{d.label}</option>)}
        </Liste>
        <Liste value={filtreAction} onChange={(e) => setFiltreAction(e.target.value)} className="w-auto py-1.5">
          <option value="">Toutes les opérations</option>
          {ACTIONS_TRACEES.map((v) => <option key={v} value={v}>{LIBELLES_ACTION[v]}</option>)}
        </Liste>
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!entrees.length}>
          PDF
        </Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="journal">
        <p>
          Toutes les opérations de la période y figurent : ventes, dépenses, achats, ouvertures et
          fermetures de caisse, mouvements de stock, commandes et pointages, ainsi que les gestes de
          contrôle (annulations, changements de prix, modifications de compte).
        </p>
        <p>
          Les lignes <strong>en rouge</strong> sont celles qui appellent une relecture. Le filtre
          « opérations » ne porte que sur les gestes tracés, qui seuls conservent un avant et un
          après — visibles en dépliant la ligne.
        </p>
      </Aide>

      {sensibles.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 mb-5 bg-amber-50 border border-amber-200 rounded-lg">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-px" />
          <p className="text-sm text-amber-900">
            {sensibles.length} opération(s) sensible(s) sur cette période : annulations, changements
            de prix, ajustements de stock, modifications de compte. Elles méritent une relecture.
          </p>
        </div>
      )}

      {tronque && (
        <div className="p-3 mb-5 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-700">
          Seules les 500 opérations les plus récentes sont affichées. Réduisez la période ou
          choisissez un domaine pour voir le reste.
        </div>
      )}

      <Card>
        {chargement ? (
          <Chargement />
        ) : entrees.length === 0 ? (
          <Vide
            icone={History} titre="Aucune opération sur cette période"
            description="Élargissez la période ou retirez les filtres."
          />
        ) : (
          <Tableau
            entetes={["Date et heure", "Auteur", "Opération", "Domaine", "Détail", " Montant", ""]}
          >
            {entrees.map((e) => {
              const sensible = ACTIONS_SENSIBLES.has(e.action);
              const ouvert = deplie === e.cle;
              const aDesDetails = !!(e.avant || e.apres);

              // La clé va sur le fragment, pas sur les <tr> : une entrée dépliée
              // en produit deux, et React n'accepte qu'un élément clé par entrée
              // de liste.
              return (
                <Fragment key={e.cle}>
                  <tr className={sensible ? "bg-red-50/30" : "hover:bg-gray-50"}>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(e.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{e.userNom ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge ton={sensible ? "danger" : e.trace ? "alerte" : "neutre"}>
                        {LIBELLES_ACTION[e.action] ?? e.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {ENTITES[e.entite] ?? e.entite}
                      {e.etablissement && (
                        <span className="block text-xs text-gray-400">{e.etablissement}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-md">
                      <span className="block truncate" title={e.motif ?? undefined}>{e.motif ?? "—"}</span>
                      {e.entiteId && <span className="text-xs text-gray-400">{e.entiteId}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabulaire whitespace-nowrap text-gray-700">
                      {e.montant ? fcfa(e.montant) : ""}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {aDesDetails && (
                        <button
                          onClick={() => setDeplie(ouvert ? null : e.cle)}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                          title={ouvert ? "Masquer le détail" : "Voir le détail"}
                        >
                          {ouvert ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                  </tr>

                  {ouvert && (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 bg-gray-50">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Etat titre="Avant" valeur={e.avant} />
                          <Etat titre="Après" valeur={e.apres} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Tableau>
        )}
      </Card>
    </Layout>
  );
}

function Etat({ titre, valeur }: { titre: string; valeur: unknown }) {
  if (!valeur) {
    return (
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">{titre}</p>
        <p className="text-sm text-gray-400">—</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-gray-500 mb-1.5">{titre}</p>
      <pre className="p-3 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 overflow-x-auto max-h-56">
        {JSON.stringify(valeur, null, 2)}
      </pre>
    </div>
  );
}
