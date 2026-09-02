import { useCallback, useEffect, useState } from "react";
import { CreditCard, Plus, Check, FileDown, ShieldCheck, Clock } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide, StatCard, SelecteurPeriode,
} from "../components/ui";
import { getDepenses, validerDepense } from "../services/db";
import ModaleDepense from "../components/ModaleDepense";
import { fcfa, dateCourte, aujourdhui } from "../lib/format";
import { exporterListePDF } from "../lib/export";
import {
  EXPENSE_LABELS, PAYMENT_LABELS,
  type Expense, type PeriodKey, type ExpenseCategory,
} from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useEtablissement } from "../contexts/EtablissementContext";
import Aide from "../components/Aide";

/** §5.7 Gestion des dépenses. */
export default function Depenses() {
  const { peut } = useAuth();
  const { selection, libelle, pourEcriture } = useEtablissement();
  const peutValider = peut("admin", "responsable");

  const [periode, setPeriode] = useState<PeriodKey>("mois");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());

  const [depenses, setDepenses] = useState<Expense[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setDepenses(await getDepenses(periode, { debut, fin, etablissement: selection }));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [periode, debut, fin, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const total = depenses.reduce((s, d) => s + d.montant, 0);
  const enAttente = depenses.filter((d) => !d.validePar);
  const totalEnAttente = enAttente.reduce((s, d) => s + d.montant, 0);

  const valider = async (id: number) => {
    try {
      await validerDepense(id);
      void recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Validation impossible.");
    }
  };

  const exporter = () =>
    exporterListePDF(
      "depenses-eden",
      ["Date", "Établissement", "Catégorie", "Motif", "Montant", "Paiement", "Effectuée par", "Validée par", "Justificatif"],
      depenses.map((d) => [
        dateCourte(d.dateDepense), d.etablissementNom ?? "—", EXPENSE_LABELS[d.categorie],
        d.motif, d.montant, PAYMENT_LABELS[d.paymentMethod],
        d.effectueParNom ?? "", d.valideParNom ?? "Non validée", d.justificatif ?? "",
      ])
    );

  return (
    <Layout>
      <PageHeader titre="Dépenses" sousTitre={`${libelle} — saisie, justification et validation`}>
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!depenses.length}>
          PDF
        </Bouton>
        <Bouton icone={Plus} onClick={() => setNouvelle(true)}>Nouvelle dépense</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="depenses">
        <p>
          Toute sortie d'argent se saisit ici, rattachée à un établissement et à un poste de charge.
          Une dépense n'entre dans le résultat consolidé qu'une fois <strong>validée</strong> par un
          responsable.
        </p>
      </Aide>

      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <StatCard titre="Total des dépenses" valeur={fcfa(total)} icone={CreditCard} detail={`${depenses.length} dépense(s)`} />
        <StatCard titre="Validées" valeur={fcfa(total - totalEnAttente)} icone={ShieldCheck} ton="succes" />
        <StatCard
          titre="En attente de validation" valeur={fcfa(totalEnAttente)} icone={Clock}
          ton={totalEnAttente > 0 ? "danger" : "neutre"} detail={`${enAttente.length} dépense(s)`}
        />
      </div>

      <Card>
        {chargement ? (
          <Chargement />
        ) : depenses.length === 0 ? (
          <Vide
            icone={CreditCard} titre="Aucune dépense sur cette période"
            description="Électricité, loyer, transport, matières premières… chaque sortie d'argent doit être enregistrée pour que le résultat soit fiable."
          />
        ) : (
          <Tableau entetes={["Date", "Catégorie", "Motif", "Établissement", " Montant", "Par", "Validation", ""]}>
            {depenses.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(d.dateDepense)}</td>
                <td className="px-4 py-3">
                  <Badge ton="info">{EXPENSE_LABELS[d.categorie]}</Badge>
                </td>
                <td className="px-4 py-3 text-gray-900 max-w-xs truncate" title={d.motif}>{d.motif}</td>
                <td className="px-4 py-3 text-gray-600">{d.etablissementNom ?? "—"}</td>
                <td className="px-4 py-3 text-right tabulaire font-medium text-red-700 whitespace-nowrap">
                  {fcfa(d.montant)}
                </td>
                <td className="px-4 py-3 text-gray-600">{d.effectueParNom ?? "—"}</td>
                <td className="px-4 py-3">
                  {d.validePar ? (
                    <div>
                      <Badge ton="succes">Validée</Badge>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {d.valideParNom} · {dateCourte(d.valideLe)}
                      </div>
                    </div>
                  ) : (
                    <Badge ton="alerte">En attente</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {!d.validePar && peutValider && (
                    <button
                      onClick={() => void valider(d.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-green-700 hover:bg-green-50"
                    >
                      <Check className="h-3.5 w-3.5" />Valider
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Tableau>
        )}
      </Card>

      <ModaleDepense
        ouverte={nouvelle}
        onFermer={() => setNouvelle(false)}
        onSucces={() => { setNouvelle(false); void recharger(); }}
      />
    </Layout>
  );
}

