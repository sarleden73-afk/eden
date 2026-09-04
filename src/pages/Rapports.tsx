import { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Package,
  Scale, ShoppingCart,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Erreur, Chargement, Badge, Tableau, Vide,
  StatCard, SelecteurPeriode, BoutonsExport,
} from "../components/ui";
import { getRapport } from "../services/db";
import { fcfa, nombre, dateCourte, aujourdhui } from "../lib/format";
import { exporterPDF, exporterCSV } from "../lib/export";
import { cn } from "../lib/utils";
import { useEtablissement } from "../contexts/EtablissementContext";
import Aide from "../components/Aide";
import {
  EXPENSE_LABELS, PAYMENT_LABELS, ROLE_LABELS,
  type ReportData, type PeriodKey,
} from "../types";

const COULEURS = ["#1fa066", "#d4a017", "#45bd83", "#b8860b", "#7bd7a8", "#c05252", "#136644"];

/** §5.12 Rapports et statistiques. */
export default function Rapports() {
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

  const exporterTout = (format: "pdf" | "csv") => {
    if (!rapport) return;
    // Un seul fichier, sections empilées : plus simple à archiver et à envoyer
    // que cinq exports séparés.
    const sections: { titre: string; entetes: string[]; lignes: (string | number)[][]; colonnesChiffrees?: number[] }[] = [];
    const section = (
      titre: string, entetes: string[], donnees: (string | number)[][], colonnesChiffrees?: number[]
    ) => sections.push({ titre, entetes, lignes: donnees, colonnesChiffrees });

    section("CHIFFRE D AFFAIRES PAR ETABLISSEMENT",
      ["Établissement", "CA", "Coût marchandises", "Marge", "Nb ventes"],
      rapport.parEtablissement.map((p) => [p.nom, p.ca, p.cout, p.marge, p.nbVentes]));

    section("CHIFFRE D'AFFAIRES PAR EMPLOYE",
      ["Employé", "Rôle", "Nb ventes", "CA"],
      rapport.caParEmploye.map((e) => [e.employe, ROLE_LABELS[e.role], e.nbVentes, e.ca]));

    section("CHIFFRE D'AFFAIRES PAR PRODUIT",
      ["Produit", "Établissement", "Quantité vendue", "CA", "Marge"],
      rapport.caParProduit.map((p) => [p.produit, p.etablissement, p.quantite, p.ca, p.marge]));

    section("MODES DE PAIEMENT",
      ["Mode", "Montant", "Nb ventes"],
      rapport.caParPaiement.map((p) => [PAYMENT_LABELS[p.methode], p.montant, p.nbVentes]));

    section("DEPENSES PAR CATEGORIE",
      ["Catégorie", "Montant", "Nombre"],
      rapport.depensesParCategorie.map((d) => [EXPENSE_LABELS[d.categorie], d.montant, d.nb]));

    section("ECARTS DE CAISSE",
      ["Date", "Établissement", "Responsable", "Théorique", "Physique", "Écart"],
      rapport.ecartsCaisse.map((e) => [
        dateCourte(e.date), e.etablissement, e.responsable, e.theorique, e.physique, e.ecart,
      ]));

    section("SYNTHESE",
      ["Indicateur", "Montant"],
      [
        ["Chiffre d'affaires", rapport.totaux.ca],
        ["Coût des marchandises", rapport.totaux.coutMarchandises],
        ["Marge brute", rapport.totaux.margeBrute],
        ["Dépenses", rapport.totaux.depenses],
        ["Résultat estimatif", rapport.totaux.resultat],
        ["Nombre de ventes", rapport.totaux.nbVentes],
        ["Panier moyen", rapport.totaux.panierMoyen],
        ["Achats — total", rapport.achats.total],
        ["Achats — restant dû", rapport.achats.restant],
      ]);

    void (format === "pdf" ? exporterPDF : exporterCSV)({
      fichier: "rapport-eden",
      titre: "Rapport d'activité",
      perimetre: libelle,
      sousTitre: rapport.periode.libelle,
      paysage: true,
      synthese: [
        { libelle: "Chiffre d'affaires", valeur: fcfa(rapport.totaux.ca) },
        { libelle: "Ventes", valeur: nombre(rapport.totaux.nbVentes) },
        { libelle: "Dépenses", valeur: fcfa(rapport.totaux.depenses) },
        { libelle: "Résultat", valeur: fcfa(rapport.totaux.resultat) },
      ],
      sections,
    });
  };

  return (
    <Layout>
      <PageHeader titre="Rapports et statistiques" sousTitre={`${libelle} — ${rapport?.periode.libelle ?? ""}`}>
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <BoutonsExport
          onPdf={() => exporterTout("pdf")}
          onCsv={() => exporterTout("csv")}
          desactive={!rapport}
        />
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="rapports">
        <p>
          Chaque tableau suit la période choisie en haut à droite et l'établissement sélectionné dans
          le menu. Le bouton <strong>PDF</strong> exporte exactement ce qui est affiché — ni plus, ni
          moins — pour être imprimé ou transmis.
        </p>
      </Aide>

      {chargement && !rapport ? (
        <Chargement texte="Calcul du rapport…" />
      ) : rapport ? (
        <div className="space-y-6">
          {/* --- Synthèse --- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              titre="Chiffre d'affaires" valeur={fcfa(rapport.totaux.ca)} icone={TrendingUp}
              detail={`${nombre(rapport.totaux.nbVentes)} vente(s)`}
            />
            <StatCard titre="Marge brute" valeur={fcfa(rapport.totaux.margeBrute)} icone={TrendingUp} />
            <StatCard titre="Dépenses" valeur={fcfa(rapport.totaux.depenses)} icone={TrendingDown} />
            <StatCard
              titre="Résultat estimatif" valeur={fcfa(rapport.totaux.resultat)} icone={Scale}
              ton={rapport.totaux.resultat >= 0 ? "succes" : "danger"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard titre="Panier moyen" valeur={fcfa(rapport.totaux.panierMoyen)} icone={ShoppingCart} />
            <StatCard
              titre="Achats de la période" valeur={fcfa(rapport.achats.total)} icone={Package}
              detail={rapport.achats.restant > 0 ? `Restant dû : ${fcfa(rapport.achats.restant)}` : "Tout est réglé"}
              ton={rapport.achats.restant > 0 ? "danger" : "neutre"}
            />
          </div>

          {/* --- CA par pôle --- */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Chiffre d'affaires par établissement</h2>
            </div>
            <Tableau entetes={["Établissement", " Nb ventes", " CA", " Coût marchandises", " Marge", " Taux de marge"]}>
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
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabulaire">{nombre(rapport.totaux.nbVentes)}</td>
                <td className="px-4 py-3 text-right tabulaire">{fcfa(rapport.totaux.ca)}</td>
                <td className="px-4 py-3 text-right tabulaire">{fcfa(rapport.totaux.coutMarchandises)}</td>
                <td className="px-4 py-3 text-right tabulaire text-amber-600">{fcfa(rapport.totaux.margeBrute)}</td>
                <td className="px-4 py-3 text-right tabulaire">
                  {rapport.totaux.ca > 0
                    ? `${Math.round((rapport.totaux.margeBrute / rapport.totaux.ca) * 100)} %`
                    : "—"}
                </td>
              </tr>
            </Tableau>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* --- CA par employé (§5.12) --- */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Chiffre d'affaires par employé</h2>
              </div>
              {rapport.caParEmploye.length === 0 ? (
                <Vide titre="Aucune vente sur la période" icone={Users} />
              ) : (
                <Tableau entetes={["Employé", " Nb ventes", " CA", " Part"]}>
                  {rapport.caParEmploye.map((e) => (
                    <tr key={e.employe} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{e.employe}</div>
                        <div className="text-xs text-gray-500">{ROLE_LABELS[e.role]}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabulaire">{nombre(e.nbVentes)}</td>
                      <td className="px-4 py-3 text-right tabulaire font-medium">{fcfa(e.ca)}</td>
                      <td className="px-4 py-3 text-right tabulaire text-gray-600">
                        {rapport.totaux.ca > 0 ? `${Math.round((e.ca / rapport.totaux.ca) * 100)} %` : "—"}
                      </td>
                    </tr>
                  ))}
                </Tableau>
              )}
            </Card>

            {/* --- Modes de paiement --- */}
            <Card className="p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Répartition par mode de paiement</h2>
              {rapport.caParPaiement.length === 0 ? (
                <Vide titre="Aucune vente sur la période" icone={BarChart3} />
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={rapport.caParPaiement.map((p) => ({
                            name: PAYMENT_LABELS[p.methode], value: p.montant,
                          }))}
                          dataKey="value" nameKey="name" cx="50%" cy="50%"
                          innerRadius={45} outerRadius={80} paddingAngle={2}
                        >
                          {rapport.caParPaiement.map((_, i) => (
                            <Cell key={i} fill={COULEURS[i % COULEURS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => fcfa(v)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {rapport.caParPaiement.map((p) => (
                      <div key={p.methode} className="flex justify-between text-sm">
                        <span className="text-gray-600">{PAYMENT_LABELS[p.methode]}</span>
                        <span className="tabulaire font-medium">{fcfa(p.montant)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* --- Meilleures ventes --- */}
          <Card className="p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Produits les plus vendus</h2>
            {rapport.meilleuresVentes.length === 0 ? (
              <Vide titre="Aucune vente sur la période" icone={Package} />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rapport.meilleuresVentes.map((p) => ({
                      nom: p.produit.length > 22 ? `${p.produit.slice(0, 20)}…` : p.produit,
                      CA: p.ca,
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e2" horizontal={false} />
                    <XAxis
                      type="number" tick={{ fontSize: 12, fill: "#7f7a72" }}
                      tickLine={false} axisLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <YAxis
                      type="category" dataKey="nom" width={150}
                      tick={{ fontSize: 11, fill: "#5e5a54" }} tickLine={false} axisLine={false}
                    />
                    <Tooltip formatter={(v: number) => fcfa(v)} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                    <Bar dataKey="CA" fill="#1fa066" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* --- Détail par produit --- */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Détail par article</h2>
            </div>
            {rapport.caParProduit.length === 0 ? (
              <Vide titre="Aucune vente sur la période" icone={Package} />
            ) : (
              <Tableau entetes={["Article", "Établissement", " Quantité", " CA", " Marge"]}>
                {rapport.caParProduit.slice(0, 60).map((p) => (
                  <tr key={p.produit} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{p.produit}</td>
                    <td className="px-4 py-3 text-gray-600">{p.etablissement}</td>
                    <td className="px-4 py-3 text-right tabulaire">{nombre(p.quantite)}</td>
                    <td className="px-4 py-3 text-right tabulaire font-medium">{fcfa(p.ca)}</td>
                    <td className={cn("px-4 py-3 text-right tabulaire", p.marge >= 0 ? "text-green-700" : "text-red-700")}>
                      {fcfa(p.marge)}
                    </td>
                  </tr>
                ))}
              </Tableau>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* --- Dépenses par catégorie --- */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">Dépenses par catégorie</h2>
              </div>
              {rapport.depensesParCategorie.length === 0 ? (
                <Vide titre="Aucune dépense sur la période" icone={TrendingDown} />
              ) : (
                <Tableau entetes={["Catégorie", " Nb", " Montant", " Part"]}>
                  {rapport.depensesParCategorie.map((d) => (
                    <tr key={d.categorie} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{EXPENSE_LABELS[d.categorie]}</td>
                      <td className="px-4 py-3 text-right tabulaire text-gray-500">{d.nb}</td>
                      <td className="px-4 py-3 text-right tabulaire font-medium text-red-700">{fcfa(d.montant)}</td>
                      <td className="px-4 py-3 text-right tabulaire text-gray-600">
                        {rapport.totaux.depenses > 0
                          ? `${Math.round((d.montant / rapport.totaux.depenses) * 100)} %`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </Tableau>
              )}
            </Card>

            {/* --- Écarts de caisse (§5.12) --- */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">Écarts de caisse</h2>
                <p className="text-sm text-gray-500 mt-0.5">Caisses fermées sur la période</p>
              </div>
              {rapport.ecartsCaisse.length === 0 ? (
                <Vide titre="Aucune caisse fermée sur la période" icone={Scale} />
              ) : (
                <Tableau entetes={["Date", "Établissement", "Responsable", " Écart"]}>
                  {rapport.ecartsCaisse.map((e) => (
                    <tr key={e.sessionId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(e.date)}</td>
                      <td className="px-4 py-3 text-gray-600">{e.etablissement}</td>
                      <td className="px-4 py-3 text-gray-700">{e.responsable}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge ton={!e.ecart ? "succes" : Math.abs(e.ecart) < 500 ? "alerte" : "danger"}>
                          {e.ecart > 0 ? "+" : ""}{fcfa(e.ecart)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </Tableau>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
