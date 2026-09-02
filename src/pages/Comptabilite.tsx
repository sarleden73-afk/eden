import { useCallback, useEffect, useState } from "react";
import { Calculator, FileDown, Info, Plus } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Erreur, Chargement, Tableau, SelecteurPeriode, Badge,
} from "../components/ui";
import { getRapport, getLivreComptable } from "../services/db";
import { fcfa, nombre, dateCourte, aujourdhui } from "../lib/format";
import { exporterPDF } from "../lib/export";
import ModaleDepense from "../components/ModaleDepense";
import { cn } from "../lib/utils";
import {
  EXPENSE_LABELS, PAYMENT_LABELS, TYPE_ECRITURE_LABELS,
  type ReportData, type PeriodKey, type LivreComptable, type TypeEcriture,
} from "../types";
import { useEtablissement } from "../contexts/EtablissementContext";
import Aide from "../components/Aide";

/**
 * §5.13 Comptabilité / suivi financier.
 *
 * L'enchaînement du cahier des charges — chiffre d'affaires, coût des
 * marchandises, marge brute, dépenses, résultat — est repris tel quel, mais
 * présenté à l'horizontale et avec le vocabulaire du livre de caisse :
 * ce qui entre est au débit, ce qui sort au crédit, la différence est ce qui
 * reste. C'est ainsi que la direction le lit au comptoir.
 */
const TONS_ECRITURE: Record<TypeEcriture, "succes" | "danger" | "alerte" | "neutre"> = {
  vente: "succes",
  depense: "danger",
  achat: "alerte",
  mouvement: "neutre",
};

export default function Comptabilite() {
  const { selection, libelle } = useEtablissement();
  const [periode, setPeriode] = useState<PeriodKey>("mois");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());
  const [rapport, setRapport] = useState<ReportData | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouvelleDepense, setNouvelleDepense] = useState(false);
  const [livre, setLivre] = useState<LivreComptable | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const [r, l] = await Promise.all([
        getRapport(periode, { debut, fin, etablissement: selection }),
        getLivreComptable(periode, { debut, fin, etablissement: selection }),
      ]);
      setRapport(r);
      setLivre(l);
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
    void exporterPDF({
      fichier: "comptabilite-eden",
      titre: "Compte de résultat simplifié",
      perimetre: libelle,
      sousTitre: rapport.periode.libelle,
      synthese: [
        { libelle: "Débit (entrées)", valeur: fcfa(t.ca) },
        { libelle: "Marge brute", valeur: fcfa(t.margeBrute) },
        { libelle: "Crédit (sorties)", valeur: fcfa(t.depenses) },
        { libelle: "Reste en caisse", valeur: fcfa(t.resultat) },
      ],
      sections: [
        {
          titre: "Du débit au reste en caisse",
          entetes: ["Poste", "Montant (FCFA)"],
          colonnesChiffrees: [1],
          lignes: [
            ["Débit (entrées) — ventes encaissées", t.ca],
            ["Coût des marchandises vendues", -t.coutMarchandises],
            ["Marge brute", t.margeBrute],
            ["Crédit (sorties) — dépenses de fonctionnement", -t.depenses],
            ["Reste en caisse", t.resultat],
          ],
        },
        {
          titre: "Résultat par établissement",
          entetes: ["Établissement", "Ventes", "CA", "Coût marchandises", "Marge brute"],
          colonnesChiffrees: [1, 2, 3, 4],
          lignes: rapport.parEtablissement.map((p) => [p.nom, p.nbVentes, p.ca, p.cout, p.marge]),
        },
        {
          titre: "Détail des charges",
          entetes: ["Poste de charge", "Nombre", "Montant"],
          colonnesChiffrees: [1, 2],
          lignes: rapport.depensesParCategorie.map((d) => [
            EXPENSE_LABELS[d.categorie], d.nb, d.montant,
          ]),
        },
        {
          titre: "Engagements fournisseurs",
          entetes: ["Indicateur", "Montant"],
          colonnesChiffrees: [1],
          lignes: [
            ["Achats de la période", rapport.achats.total],
            ["Déjà réglé", rapport.achats.paye],
            ["Restant dû", rapport.achats.restant],
            ["Nombre de ventes", t.nbVentes],
            ["Panier moyen", t.panierMoyen],
          ],
        },
      ],
    });
  };

  const t = rapport?.totaux;
  const tauxMarge = t && t.ca > 0 ? Math.round((t.margeBrute / t.ca) * 100) : 0;
  const tauxResultat = t && t.ca > 0 ? Math.round((t.resultat / t.ca) * 100) : 0;

  return (
    <Layout>
      <PageHeader titre="Comptabilité" sousTitre={`${libelle} — débit, crédit et reste en caisse, ${rapport?.periode.libelle ?? ""}`}>
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!rapport}>PDF</Bouton>
        <Bouton icone={Plus} onClick={() => setNouvelleDepense(true)}>Nouvelle dépense</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="comptabilite">
        <p>
          La ligne du haut se lit de gauche à droite : le <strong>débit</strong> est ce qui est
          entré, le <strong>crédit</strong> ce qui est sorti, le <strong>reste en caisse</strong> ce
          qu'il y a entre les deux une fois le prix d'achat des marchandises vendues déduit.
        </p>
        <p>
          Le tableau « Écritures comptables », en bas, donne les lignes qui composent ces totaux :
          c'est là qu'on justifie un chiffre. Le bouton <strong>Nouvelle dépense</strong> permet de
          rattraper un oubli sans quitter l'écran.
        </p>
      </Aide>

      {chargement && !rapport ? (
        <Chargement texte="Calcul du résultat…" />
      ) : rapport && t ? (
        <div className="space-y-6">
          {/* --- Du débit au reste en caisse, à l'horizontale --- */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="h-5 w-5 text-indigo-600" />
              <h2 className="font-semibold text-gray-900">Du débit au reste en caisse</h2>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Se lit de gauche à droite : ce qui est entré, ce qu'il a fallu payer, ce qui reste.
            </p>

            {/* Cinq étapes alignées, séparées par leur opération. Sur petit
                écran la ligne se replie en deux colonnes plutôt que de forcer
                un défilement latéral. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 xl:gap-2 items-stretch">
              <CarteFlux
                libelle="Débit (entrées)"
                detail={`${nombre(t.nbVentes)} vente(s) — panier moyen ${fcfa(t.panierMoyen)}`}
                montant={t.ca}
                ton="positif"
              />
              <Operateur signe="−" />
              <CarteFlux
                libelle="Coût des marchandises"
                detail="Prix d'achat de ce qui a été vendu"
                montant={t.coutMarchandises}
                ton="negatif"
              />
              <Operateur signe="=" />
              <CarteFlux
                libelle="Marge brute"
                detail={`${tauxMarge} % du débit`}
                montant={t.margeBrute}
                ton="intermediaire"
              />
              <Operateur signe="−" />
              <CarteFlux
                libelle="Crédit (sorties)"
                detail="Loyer, salaires, électricité, transport…"
                montant={t.depenses}
                ton="negatif"
              />
              <Operateur signe="=" />
              <CarteFlux
                libelle="Reste en caisse"
                detail={`${tauxResultat} % du débit`}
                montant={t.resultat}
                ton={t.resultat >= 0 ? "final-positif" : "final-negatif"}
              />
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Le reste en caisse est une estimation : il déduit le prix d'achat des marchandises
              vendues, qui a pu être réglé un autre jour. Le solde réellement présent dans le tiroir
              est celui de l'écran Caisse.
            </p>

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

          {/* --- Écritures comptables --- */}
          {/* Le compte de résultat donne des totaux ; ce journal donne les
              lignes qui les composent, pour qu'un chiffre puisse toujours être
              justifié devant quelqu'un. */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">Écritures comptables</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Toutes les entrées et sorties d'argent de la période, dans l'ordre.
                </p>
              </div>
              {livre && (
                <div className="flex gap-4 text-sm">
                  <span className="text-gray-600">
                    Entrées <strong className="text-green-700 tabulaire">{fcfa(livre.totaux.entrees)}</strong>
                  </span>
                  <span className="text-gray-600">
                    Sorties <strong className="text-red-700 tabulaire">{fcfa(livre.totaux.sorties)}</strong>
                  </span>
                </div>
              )}
            </div>

            {!livre ? (
              <Chargement texte="Chargement des écritures…" />
            ) : livre.ecritures.length === 0 ? (
              <p className="p-6 text-sm text-center text-gray-500">
                Aucun mouvement d'argent sur cette période.
              </p>
            ) : (
              <Tableau
                entetes={["Date", "Référence", "Libellé", "Établissement", "Moyen", "Par", " Entrée", " Sortie"]}
              >
                {livre.ecritures.map((e, i) => (
                  <tr key={`${e.reference}-${i}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(e.date)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 whitespace-nowrap">{e.reference}</div>
                      <Badge ton={TONS_ECRITURE[e.type]}>{TYPE_ECRITURE_LABELS[e.type]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-sm">
                      <div className="truncate" title={e.libelle}>{e.libelle}</div>
                      {e.statut && <div className="text-xs text-amber-700 mt-0.5">{e.statut}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{e.etablissement}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{PAYMENT_LABELS[e.moyen]}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{e.auteur}</td>
                    <td className="px-4 py-3 text-right tabulaire text-green-700 whitespace-nowrap">
                      {e.entree > 0 ? fcfa(e.entree) : ""}
                    </td>
                    <td className="px-4 py-3 text-right tabulaire text-red-700 whitespace-nowrap">
                      {e.sortie > 0 ? fcfa(e.sortie) : ""}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-3" colSpan={6}>Total de la période</td>
                  <td className="px-4 py-3 text-right tabulaire text-green-700">
                    {fcfa(livre.totaux.entrees)}
                  </td>
                  <td className="px-4 py-3 text-right tabulaire text-red-700">
                    {fcfa(livre.totaux.sorties)}
                  </td>
                </tr>
              </Tableau>
            )}
          </Card>
        </div>
      ) : null}

      {/* Saisir une sortie d'argent depuis la comptabilité elle-même : c'est là
          qu'on constate un résultat, donc là qu'on veut corriger un oubli. */}
      <ModaleDepense
        ouverte={nouvelleDepense}
        onFermer={() => setNouvelleDepense(false)}
        onSucces={() => { setNouvelleDepense(false); void recharger(); }}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

type TonFlux = "positif" | "negatif" | "intermediaire" | "final-positif" | "final-negatif";

const STYLES_FLUX: Record<TonFlux, { conteneur: string; montant: string }> = {
  positif: { conteneur: "bg-green-50 border-green-200", montant: "text-green-700" },
  negatif: { conteneur: "bg-red-50/60 border-red-200", montant: "text-red-700" },
  intermediaire: { conteneur: "bg-amber-50 border-amber-200", montant: "text-amber-700" },
  "final-positif": { conteneur: "bg-green-50 border-green-400 border-2", montant: "text-green-700" },
  "final-negatif": { conteneur: "bg-red-50 border-red-400 border-2", montant: "text-red-700" },
};

/**
 * Une étape du calcul.
 *
 * Le montant est toujours affiché en positif : le signe est porté par
 * l'opérateur placé entre les cartes, ce qui évite l'ambiguïté d'un « − 12 000 »
 * qu'on peut lire comme une perte alors que c'est une soustraction.
 */
function CarteFlux({
  libelle, detail, montant, ton,
}: { libelle: string; detail: string; montant: number; ton: TonFlux }) {
  const style = STYLES_FLUX[ton];
  const final = ton.startsWith("final");

  return (
    <div className={cn("flex flex-col justify-between p-4 rounded-lg border min-w-0", style.conteneur)}>
      <p className={cn("text-gray-900 leading-tight", final ? "font-bold" : "font-medium")}>{libelle}</p>
      <p className={cn(
        "tabulaire mt-2 break-words",
        final ? "text-xl font-bold" : "text-lg font-semibold",
        style.montant
      )}>
        {montant < 0 ? "− " : ""}{fcfa(Math.abs(montant))}
      </p>
      <p className="text-xs text-gray-500 mt-1.5 leading-snug">{detail}</p>
    </div>
  );
}

/** Signe entre deux étapes. Horizontal sur grand écran, vertical en dessous. */
function Operateur({ signe }: { signe: "−" | "=" }) {
  return (
    <div
      className="hidden xl:flex items-center justify-center text-xl font-semibold text-gray-400 px-1"
      aria-hidden
    >
      {signe}
    </div>
  );
}
