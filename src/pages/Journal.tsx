import { useCallback, useEffect, useState } from "react";
import { History, FileDown, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Liste, Erreur, Chargement, Badge, Tableau, Vide,
} from "../components/ui";
import { getJournal } from "../services/db";
import { dateHeure } from "../lib/format";
import { exporterCSV } from "../lib/export";
import type { AuditEntry } from "../types";

/**
 * §5.10 Contrôle interne et traçabilité.
 * Journal des opérations sensibles : annulations, modifications de prix,
 * ouvertures et fermetures de caisse, ajustements de stock, changements de rôle.
 */

const LIBELLES_ACTION: Record<string, string> = {
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
  "modification_prix",
  "ajustement_stock",
  "reinitialisation_mot_de_passe",
  "modification_utilisateur",
]);

const ENTITES: Record<string, string> = {
  sales: "Ventes",
  products: "Catalogue",
  cash_sessions: "Caisse",
  cash_movements: "Caisse",
  expenses: "Dépenses",
  purchases: "Achats",
  orders: "Commandes",
  profiles: "Personnel",
  packs: "Packs",
  settings: "Paramètres",
};

export default function Journal() {
  const [entrees, setEntrees] = useState<AuditEntry[]>([]);
  const [filtreEntite, setFiltreEntite] = useState("");
  const [filtreAction, setFiltreAction] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [deplie, setDeplie] = useState<number | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setEntrees(await getJournal({
        entite: filtreEntite || undefined,
        action: filtreAction || undefined,
      }));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [filtreEntite, filtreAction]);

  useEffect(() => { void recharger(); }, [recharger]);

  const sensibles = entrees.filter((e) => ACTIONS_SENSIBLES.has(e.action));

  const exporter = () =>
    exporterCSV(
      "journal-eden",
      ["Date et heure", "Utilisateur", "Action", "Domaine", "Référence", "Motif"],
      entrees.map((e) => [
        dateHeure(e.createdAt), e.userNom ?? "",
        LIBELLES_ACTION[e.action] ?? e.action,
        ENTITES[e.entite] ?? e.entite, e.entiteId ?? "", e.motif ?? "",
      ])
    );

  return (
    <Layout>
      <PageHeader
        titre="Journal des opérations"
        sousTitre="Historique des actions sensibles — qui a fait quoi, quand et pourquoi"
      >
        <Liste value={filtreEntite} onChange={(e) => setFiltreEntite(e.target.value)} className="w-auto py-1.5">
          <option value="">Tous les domaines</option>
          {[...new Set(Object.entries(ENTITES).map(([v, l]) => `${v}|${l}`))].map((x) => {
            const [v, l] = x.split("|");
            return <option key={v} value={v}>{l}</option>;
          })}
        </Liste>
        <Liste value={filtreAction} onChange={(e) => setFiltreAction(e.target.value)} className="w-auto py-1.5">
          <option value="">Toutes les actions</option>
          {Object.entries(LIBELLES_ACTION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Liste>
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!entrees.length}>
          Excel
        </Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      {sensibles.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 mb-5 bg-amber-50 border border-amber-200 rounded-lg">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-px" />
          <p className="text-sm text-amber-900">
            {sensibles.length} opération(s) sensible(s) sur cette liste : annulations, changements
            de prix, ajustements de stock. Elles méritent une relecture périodique.
          </p>
        </div>
      )}

      <Card>
        {chargement ? (
          <Chargement />
        ) : entrees.length === 0 ? (
          <Vide
            icone={History} titre="Aucune opération enregistrée"
            description="Le journal se remplit automatiquement dès qu'une opération sensible est réalisée."
          />
        ) : (
          <Tableau entetes={["Date et heure", "Utilisateur", "Action", "Domaine", "Motif", ""]}>
            {entrees.map((e) => {
              const sensible = ACTIONS_SENSIBLES.has(e.action);
              const ouvert = deplie === e.id;
              const aDesDetails = !!(e.avant || e.apres);

              return (
                <>
                  <tr key={e.id} className={sensible ? "bg-red-50/30" : "hover:bg-gray-50"}>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(e.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{e.userNom ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge ton={sensible ? "danger" : "neutre"}>
                        {LIBELLES_ACTION[e.action] ?? e.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {ENTITES[e.entite] ?? e.entite}
                      {e.entiteId && <span className="text-gray-400 text-xs ml-1">#{e.entiteId}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-md">{e.motif ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {aDesDetails && (
                        <button
                          onClick={() => setDeplie(ouvert ? null : e.id)}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                          title={ouvert ? "Masquer le détail" : "Voir le détail"}
                        >
                          {ouvert ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                  </tr>

                  {ouvert && (
                    <tr key={`${e.id}-detail`}>
                      <td colSpan={6} className="px-4 py-4 bg-gray-50">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Etat titre="Avant" valeur={e.avant} />
                          <Etat titre="Après" valeur={e.apres} />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
