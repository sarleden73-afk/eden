import { useEffect, useState } from "react";
import { Modale, Bouton, Saisie, Liste, Champ, Zone, Erreur } from "./ui";
import { creerDepense } from "../services/db";
import { aujourdhui } from "../lib/format";
import { useEtablissement } from "../contexts/EtablissementContext";
import { EXPENSE_LABELS, PAYMENT_LABELS, type ExpenseCategory, type Establishment } from "../types";

/**
 * Saisie d'une dépense (§5.7).
 *
 * Partagée par l'écran Dépenses et la Comptabilité : c'est la même opération,
 * elle ne doit exister qu'en un seul endroit. Deux formulaires séparés
 * finiraient par diverger, et l'un des deux oublierait une règle.
 *
 * Quand l'utilisateur consulte le cumul des établissements, la modale demande
 * elle-même à quel établissement rattacher la dépense, plutôt que de rendre le
 * bouton inutilisable.
 */
export default function ModaleDepense({
  ouverte, onFermer, onSucces,
}: { ouverte: boolean; onFermer: () => void; onSucces: () => void }) {
  const { pourEcriture, libelle, etablissements } = useEtablissement();

  const [etablissementId, setEtablissementId] = useState<string>("");
  const [categorie, setCategorie] = useState<ExpenseCategory>("achat_marchandises");
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [date, setDate] = useState(aujourdhui());
  const [paiement, setPaiement] = useState("especes");
  const [justificatif, setJustificatif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouverte) return;
    setEtablissementId(pourEcriture !== null ? String(pourEcriture) : "");
    setCategorie("achat_marchandises");
    setMontant(""); setMotif(""); setDate(aujourdhui());
    setPaiement("especes"); setJustificatif(""); setErreur(null);
  }, [ouverte, pourEcriture]);

  const actifs: Establishment[] = etablissements.filter((e) => e.actif);
  const cible = etablissementId ? Number(etablissementId) : null;

  const soumettre = async () => {
    if (cible === null) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await creerDepense({
        establishmentId: cible,
        categorie,
        montant: Number(montant) || 0,
        motif: motif.trim(),
        dateDepense: date,
        paymentMethod: paiement,
        justificatif: justificatif.trim() || undefined,
      });
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouverte} titre="Nouvelle dépense" onFermer={onFermer} taille="lg">
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ
          label="Établissement"
          aide={
            pourEcriture !== null
              ? "Défini par le sélecteur, en haut du menu."
              : "Une dépense appartient à un établissement : précisez lequel."
          }
        >
          {pourEcriture !== null ? (
            <Saisie value={libelle} disabled />
          ) : (
            <Liste value={etablissementId} onChange={(e) => setEtablissementId(e.target.value)}>
              <option value="">Choisir…</option>
              {actifs.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </Liste>
          )}
        </Champ>

        <Champ label="Catégorie">
          <Liste value={categorie} onChange={(e) => setCategorie(e.target.value as ExpenseCategory)}>
            {Object.entries(EXPENSE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Liste>
        </Champ>

        <Champ label="Montant (FCFA)">
          <Saisie
            type="number" min={1} value={montant}
            onChange={(e) => setMontant(e.target.value)} autoFocus
          />
        </Champ>

        <Champ label="Date">
          <Saisie type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Champ>

        <Champ label="Mode de paiement">
          <Liste value={paiement} onChange={(e) => setPaiement(e.target.value)}>
            {Object.entries(PAYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Liste>
        </Champ>

        <Champ label="Référence du justificatif" aide="N° de reçu, de facture…">
          <Saisie
            value={justificatif} onChange={(e) => setJustificatif(e.target.value)}
            placeholder="Facultatif"
          />
        </Champ>

        <div className="sm:col-span-2">
          <Champ label="Motif" aide="Obligatoire. Décrivez précisément à quoi correspond la dépense.">
            <Zone
              value={motif} onChange={(e) => setMotif(e.target.value)}
              placeholder="Ex. : facture d'électricité du mois de septembre"
            />
          </Champ>
        </div>
      </div>

      <div className="p-3 mt-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
        Une dépense réglée en espèces sera immédiatement déduite de la caisse ouverte de
        l'établissement. Elle devra ensuite être validée par un responsable avant d'entrer dans le
        résultat consolidé.
      </div>

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton
          onClick={soumettre}
          chargement={envoi}
          disabled={!motif.trim() || !(Number(montant) > 0) || cible === null}
          className="flex-1"
        >
          Enregistrer la dépense
        </Bouton>
      </div>
    </Modale>
  );
}
