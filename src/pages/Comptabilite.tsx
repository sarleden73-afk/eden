import { useCallback, useEffect, useState } from "react";
import { Calculator, Printer, FileDown, ArrowDown, Info } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Erreur, Chargement, Tableau, SelecteurPeriode,
} from "../components/ui";
import { getRapport } from "../services/db";
import { fcfa, nombre, aujourdhui } from "../lib/format";
import { exporterCSV, exporterPDF } from "../lib/export";
import { cn } from "../lib/utils";
import { EXPENSE_LABELS, type ReportData, type PeriodKey } from "../types";
import { useEtablissement } from "../contexts/EtablissementContext";

/**
 * §5.13 Comptabilité / suivi financier.
 * La cascade demandée au cahier des charges :
 *   Chiffre d'affaires → Coût des marchandises → Marge brute → Dépenses → Résultat.
 */
export default function Comptabilite() {
  const { selection, libelle } = useEtablissement();
  const [periode, setPeriode] = useState<PeriodKey>("mois");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());
  const [rapport, setRapport] = useState<ReportData | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setRapport(await getRapport(periode, { debut, fin, etablissement: selection }));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [periode, debut, fin, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const exporter = () => {
    if (!rapport) return;
    const t = rapport.totaux;
    exporterCSV(
      "comptabilite-eden",
      ["Poste", "Montant (FCFA)"],
      [
        ["Chiffre d'affaires", t.ca],
        ["Coût des marchandises vendues", -t.coutMarchandises],
        ["MARGE BRUTE", t.margeBrute],
        ...rapport.depensesParCategorie.map((d) => [`  ${EXPENSE_LABELS[d.categorie]}`, -d.montant]),
        ["Total des dépenses", -t.depenses],
        ["RESULTAT ESTIMATIF", t.resultat],
        [],
        ["Nombre de ventes", t.nbVentes],
        ["Panier moyen", t.panierMoyen],
        ["Achats de la période", rapport.achats.total],
        ["Dettes fournisseurs restantes", rapport.achats.restant],
      ]
    );
  };

  const t = rapport?.totaux;
  const tauxMarge = t && t.ca > 0 ? Math.round((t.margeBrute / t.ca) * 100) : 0;
  const tauxResultat = t && t.ca > 0 ? Math.round((t.resultat / t.ca) * 100) : 0;

  return (
    <Layout>
      <PageHeader titre="Comptabilité" sousTitre={`${libelle} — compte de résultat simplifié, ${rapport?.periode.libelle ?? ""}`}>
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!rapport}>Excel</Bouton>
        <Bouton variante="secondaire" icone={Printer} onClick={exporterPDF} disabled={!rapport}>PDF</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      {chargement && !rapport ? (
        <Chargement texte="Calcul du résultat…" />
      ) : rapport && t ? (
        <div className="space-y-6">
          {/* --- Cascade du résultat --- */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <Calculator className="h-5 w-5 text-indigo-600" />
              <h2 className="font-semibold text-gray-900">Du chiffre d'affaires au résultat</h2>
            </div>

            <div className="space-y-2 max-w-2xl">
              <LigneCascade
                libelle="Chiffre d'affaires"
                detail={`${nombre(t.nbVentes)} vente(s) — panier moyen ${fcfa(t.panierMoyen)}`}
                montant={t.ca}
                ton="positif"
              />
              <Fleche />
              <LigneCascade
                libelle="Coût des marchandises vendues"
                detail="Prix d'achat des articles effectivement vendus"
                montant={-t.coutMarchandises}
                ton="negatif"
              />
              <Fleche />
              <LigneCascade
                libelle="Marge brute"
                detail={`${tauxMarge} % du chiffre d'affaires`}
                montant={t.margeBrute}
                ton="intermediaire"
              />
              <Fleche />
              <LigneCascade
                libelle="Dépenses de fonctionnement"
                detail="Loyer, salaires, électricité, transport…"
                montant={-t.depenses}
                ton="negatif"
              />
              <Fleche />
              <LigneCascade
                libelle="Résultat estimatif"
                detail={`${tauxResultat} % du chiffre d'affaires`}
                montant={t.resultat}
                ton={t.resultat >= 0 ? "final-positif" : "final-negatif"}
              />
            </div>

            {t.coutMarchandises === 0 && t.ca > 0 && (
              <div className="flex items-start gap-2.5 mt-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <Info className="h-5 w-5 text-amber-600 shrink-0 mt-px" />
                <p className="text-sm text-amber-900">
                  Aucun coût de marchandises n'est enregistré : les prix d'achat des articles sont
                  encore à 0. Tant qu'ils ne sont pas renseignés (Catalogue, ou automatiquement via
                  les achats fournisseurs), la marge brute affichée est égale au chiffre d'affaires
                  et le résultat est surévalué.
                </p>
              </div>
            )}
          </Card>

          {/* --- Résultat par pôle --- */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Résultat par établissement</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Les dépenses ne sont pas réparties ici : elles apparaissent au niveau consolidé,
                chaque dépense étant déjà rattachée à son établissement à la saisie.
              </p>
            </div>
            <Tableau entetes={["Établissement", " Ventes", " CA", " Coût marchandises", " Marge brute", " Taux"]}>
              {rapport.parEtablissement.map((p) => (
                <tr key={p.establishmentId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.nom}</td>
                  <td className="px-4 py-3 text-right tabulaire">{nombre(p.nbVentes)}</td>
                  <td className="px-4 py-3 text-right tabulaire font-medium">{fcfa(p.ca)}</td>
                  <td className="px-4 py-3 text-right tabulaire text-gray-600">{fcfa(p.cout)}</td>
                  <td className={cn("px-4 py-3 text-right tabulaire font-medium", p.marge >= 0 ? "text-green-700" : "text-red-700")}>
                    {fcfa(p.marge)}
                  </td>
                  <td className="px-4 py-3 text-right tabulaire text-gray-600">
                    {p.ca > 0 ? `${Math.round((p.marge / p.ca) * 100)} %` : "—"}
                  </td>
                </tr>
              ))}
            </Tableau>
          </Card>

          {/* --- Détail des dépenses --- */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Détail des charges</h2>
            </div>
            {rapport.depensesParCategorie.length === 0 ? (
              <p className="p-6 text-sm text-center text-gray-500">
                Aucune dépense enregistrée sur la période.
              </p>
            ) : (
              <Tableau entetes={["Poste de charge", " Nombre", " Montant", " Part des charges"]}>
                {rapport.depensesParCategorie.map((d) => (
                  <tr key={d.categorie} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{EXPENSE_LABELS[d.categorie]}</td>
                    <td className="px-4 py-3 text-right tabulaire text-gray-500">{d.nb}</td>
                    <td className="px-4 py-3 text-right tabulaire font-medium text-red-700">{fcfa(d.montant)}</td>
                    <td className="px-4 py-3 text-right tabulaire text-gray-600">
                      {t.depenses > 0 ? `${Math.round((d.montant / t.depenses) * 100)} %` : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-3">Total des charges</td>
                  <td />
                  <td className="px-4 py-3 text-right tabulaire text-red-700">{fcfa(t.depenses)}</td>
                  <td className="px-4 py-3 text-right tabulaire">100 %</td>
                </tr>
              </Tableau>
            )}
          </Card>

          {/* --- Trésorerie fournisseurs --- */}
          <Card className="p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Engagements fournisseurs</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-gray-500">Achats de la période</p>
                <p className="mt-1 text-xl font-bold text-gray-900 tabulaire">{fcfa(rapport.achats.total)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{rapport.achats.nb} achat(s)</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Déjà réglé</p>
                <p className="mt-1 text-xl font-bold text-green-700 tabulaire">{fcfa(rapport.achats.paye)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Restant dû</p>
                <p className={cn(
                  "mt-1 text-xl font-bold tabulaire",
                  rapport.achats.restant > 0 ? "text-red-700" : "text-gray-900"
                )}>
                  {fcfa(rapport.achats.restant)}
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              Ces montants concernent les achats datés de la période. Une dette contractée plus tôt
              et non réglée n'y figure pas — la liste complète est dans Achats, colonne « Restant dû ».
            </p>
          </Card>
        </div>
      ) : null}
    </Layout>
  );
}

// ---------------------------------------------------------------------------

type TonCascade = "positif" | "negatif" | "intermediaire" | "final-positif" | "final-negatif";

const STYLES_CASCADE: Record<TonCascade, { conteneur: string; montant: string }> = {
  positif: { conteneur: "bg-gray-50 border-gray-200", montant: "text-gray-900" },
  negatif: { conteneur: "bg-red-50/60 border-red-100", montant: "text-red-700" },
  intermediaire: { conteneur: "bg-amber-50 border-amber-200", montant: "text-amber-700" },
  "final-positif": { conteneur: "bg-green-50 border-green-300 border-2", montant: "text-green-700" },
  "final-negatif": { conteneur: "bg-red-50 border-red-300 border-2", montant: "text-red-700" },
};

function LigneCascade({
  libelle, detail, montant, ton,
}: { libelle: string; detail: string; montant: number; ton: TonCascade }) {
  const style = STYLES_CASCADE[ton];
  const final = ton.startsWith("final");

  return (
    <div className={cn("flex items-center justify-between gap-4 p-4 rounded-lg border", style.conteneur)}>
      <div className="min-w-0">
        <p className={cn("text-gray-900", final ? "text-base font-bold" : "font-medium")}>{libelle}</p>
        <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
      </div>
      <p className={cn("tabulaire whitespace-nowrap", final ? "text-2xl font-bold" : "text-lg font-semibold", style.montant)}>
        {montant < 0 ? "− " : ""}{fcfa(Math.abs(montant))}
      </p>
    </div>
  );
}

function Fleche() {
  return (
    <div className="flex justify-center py-0.5">
      <ArrowDown className="h-4 w-4 text-gray-300" />
    </div>
  );
}
