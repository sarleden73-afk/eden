import { useEffect, useState, type SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Wallet, ShoppingCart, TrendingUp, TrendingDown, AlertTriangle,
  PackageX, Building2,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, StatCard, Chargement, Erreur, SelecteurPeriode, Badge, Vide, Tableau,
  Modale,
} from "../components/ui";
import { getTableauDeBord, getVentes, getDepenses, getPointagesDuJour } from "../services/db";
import { useAuth } from "../contexts/AuthContext";
import { fcfa, nombre, dateCourte, dateHeure, heure, aujourdhui } from "../lib/format";
import { cn } from "../lib/utils";
import { useEtablissement } from "../contexts/EtablissementContext";
import Aide from "../components/Aide";
import {
  EXPENSE_LABELS, PAYMENT_LABELS,
  type DashboardStats, type PeriodKey, type Sale, type Expense, type SelectionEtablissement,
} from "../types";

/** Carte dont le détail peut être ouvert. La trésorerie n'en a pas : c'est une soustraction, pas une liste. */
type Detail = "entrees" | "ventes" | "sorties";

/**
 * §5.11 Tableau de bord.
 *
 * Un établissement à la fois, jamais de mélange implicite. En vue consolidée,
 * les chiffres restent ventilés par établissement : le total n'apparaît qu'en
 * ligne de synthèse, sous le détail.
 */
export default function Dashboard() {
  const { selection, libelle, courant, chargement: chargementEtab } = useEtablissement();
  const { profil } = useAuth();
  const [periode, setPeriode] = useState<PeriodKey>("jour");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [monArrivee, setMonArrivee] = useState<string | null>(null);

  useEffect(() => {
    if (chargementEtab) return;
    let annule = false;
    setChargement(true);
    getTableauDeBord(periode, { debut, fin, etablissement: selection })
      .then((d) => { if (!annule) { setStats(d); setErreur(null); } })
      .catch((e) => { if (!annule) setErreur(e.message); })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [periode, debut, fin, selection, chargementEtab]);

  // Heure d'arrivée du jour, pour le seul tableau de bord personnel. L'échec
  // est silencieux : ne pas connaître son heure d'arrivée ne doit pas empêcher
  // de voir ses ventes.
  useEffect(() => {
    if (!stats?.restreint || !profil) return;
    let annule = false;
    getPointagesDuJour(selection)
      .then((j) => {
        if (annule) return;
        const mien = j.pointages.find((p) => p.profileId === profil.id);
        setMonArrivee(mien?.arriveA ?? null);
      })
      .catch(() => { /* information d'appoint */ });
    return () => { annule = true; };
  }, [stats?.restreint, profil, selection]);

  const consolide = stats?.etablissementId === null;
  const etabs = stats?.parEtablissement ?? [];

  // Une barre par établissement : le graphique s'adapte au nombre d'entités
  // sans rien coder en dur.
  const serie = (stats?.serie ?? []).map((j) => {
    const ligne: Record<string, string | number> = { jour: dateCourte(j.date).slice(0, 5) };
    for (const e of etabs) ligne[e.nom] = j.valeurs[String(e.establishmentId)] ?? 0;
    if (!stats?.restreint) ligne["Crédit (sorties)"] = j.depenses;
    return ligne;
  });

  return (
    <Layout>
      <PageHeader
        titre="Tableau de bord"
        sousTitre={
          stats?.restreint
            ? `Votre activité — ${libelle}`
            : consolide
              ? "Cumul des établissements, ventilé ci-dessous"
              : courant?.activite ?? libelle
        }
      >
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="tableau-de-bord">
        <p>
          Trois chiffres et leur solde : le <strong>débit</strong> est ce qui est entré en caisse,
          le <strong>crédit</strong> ce qui en est sorti, le <strong>reste en caisse</strong> la
          différence entre les deux sur la période choisie en haut à droite.
        </p>
        <p>
          Cliquez sur une carte pour voir les opérations qui composent son total : c'est là qu'on
          retrouve la vente ou la dépense qui explique un écart.
        </p>
      </Aide>

      <Aide cle="tableau-de-bord-agent" pour={["caissier", "technicien"]} titre="Votre tableau de bord">
        <p>
          Vous voyez ici <strong>vos propres ventes</strong>, et elles seules. Changez la période en
          haut à droite pour votre journée, votre semaine, votre mois ou votre année.
        </p>
        <p>
          Cet écran est en lecture seule : il rend compte de ce que vous avez enregistré, rien n'y
          est modifiable. Pour corriger une vente, adressez-vous à un responsable.
        </p>
      </Aide>

      {(chargement || chargementEtab) && !stats ? (
        <Chargement />
      ) : stats ? (
        <div className="space-y-6">
          {/* --- Synthèse : entrées, sorties, ce qui reste --- */}
          {/* La marge brute a été retirée : tant que les prix d'achat ne sont
              pas renseignés, elle vaut mécaniquement le chiffre d'affaires et
              n'apprend rien. Ce qui compte au quotidien, c'est ce qui entre,
              ce qui sort, et ce qui reste. */}
          <div className={cn(
            "grid gap-4 sm:grid-cols-2",
            stats.restreint ? "lg:grid-cols-3" : "lg:grid-cols-4"
          )}>
            <StatCard
              titre={stats.restreint ? "Vos ventes" : "Débit (entrées)"}
              valeur={fcfa(stats.ca)}
              icone={TrendingUp}
              detail={consolide ? "Cumul des établissements" : libelle}
              onDetail={() => setDetail("entrees")}
            />
            <StatCard
              titre="Nombre de ventes"
              valeur={nombre(stats.nbVentes)}
              icone={ShoppingCart}
              onDetail={() => setDetail("ventes")}
            />
            {!stats.restreint ? (
              <>
                <StatCard
                  titre="Crédit (sorties)"
                  valeur={fcfa(stats.depenses)}
                  icone={TrendingDown}
                  detail="Salaires, loyer, achats, imprévus…"
                  onDetail={() => setDetail("sorties")}
                />
                {/* Pas de détail sur cette carte : c'est une soustraction entre
                    les deux précédentes, son détail est le leur. */}
                <StatCard
                  titre="Reste en caisse"
                  valeur={fcfa(stats.tresorerie)}
                  icone={stats.tresorerie >= 0 ? Wallet : TrendingDown}
                  ton={stats.tresorerie >= 0 ? "succes" : "danger"}
                  detail="Débit − crédit"
                />
              </>
            ) : (
              // Pour l'agent, l'heure d'arrivée vaut mieux que le rappel de son
              // établissement : il le connaît, il y travaille.
              <StatCard
                titre="Votre arrivée aujourd'hui"
                valeur={monArrivee ? heure(monArrivee) : "Non pointée"}
                icone={Building2}
                ton={monArrivee ? "succes" : "neutre"}
                detail={libelle}
              />
            )}
          </div>

          {/* --- Ventilation par établissement (§1 : séparés ET globaux) --- */}
          {!stats.restreint && etabs.length > 1 && (
            <Card>
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">Santé de chaque établissement</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Chaque ligne est une entité distincte. Le total ne sert qu'à la synthèse.
                </p>
              </div>
              <Tableau
                entetes={["Établissement", " Ventes", " Débit (entrées)", " Crédit (sorties)", " Reste en caisse"]}
              >
                {etabs.map((e) => (
                  <tr key={e.establishmentId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: e.couleur }}
                          aria-hidden
                        />
                        <span className="font-medium text-gray-900">{e.nom}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabulaire">{nombre(e.nbVentes)}</td>
                    <td className="px-4 py-3 text-right tabulaire font-medium">{fcfa(e.ca)}</td>
                    <td className="px-4 py-3 text-right tabulaire text-red-700">{fcfa(e.depenses)}</td>
                    <td className={cn(
                      "px-4 py-3 text-right tabulaire font-semibold",
                      e.tresorerie >= 0 ? "text-green-700" : "text-red-700"
                    )}>
                      {fcfa(e.tresorerie)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-3">Total groupe</td>
                  <td className="px-4 py-3 text-right tabulaire">{nombre(stats.nbVentes)}</td>
                  <td className="px-4 py-3 text-right tabulaire">{fcfa(stats.ca)}</td>
                  <td className="px-4 py-3 text-right tabulaire text-red-700">{fcfa(stats.depenses)}</td>
                  <td className={cn(
                    "px-4 py-3 text-right tabulaire",
                    stats.tresorerie >= 0 ? "text-green-700" : "text-red-700"
                  )}>
                    {fcfa(stats.tresorerie)}
                  </td>
                </tr>
              </Tableau>
            </Card>
          )}

          {/* --- Évolution --- */}
          <Card className="p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Évolution sur la période</h2>
            {serie.length === 0 ? (
              <Vide titre="Aucun mouvement sur cette période" icone={IconeGraphiqueVide} />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e2" vertical={false} />
                    <XAxis dataKey="jour" tick={{ fontSize: 12, fill: "#7f7a72" }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#7f7a72" }} tickLine={false} axisLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(v: number) => fcfa(v)}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e8e6e2", fontSize: 13 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {etabs.map((e) => (
                      <Bar key={e.establishmentId} dataKey={e.nom} fill={e.couleur} radius={[3, 3, 0, 0]} />
                    ))}
                    {!stats.restreint && (
                      <Bar dataKey="Crédit (sorties)" fill="#c05252" radius={[3, 3, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* --- État des caisses (§5.11) --- */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">État des caisses</h2>
                <Link to="/caisse" className="text-sm text-indigo-600 hover:underline">Gérer</Link>
              </div>

              {stats.caisses.length === 0 ? (
                <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Wallet className="h-5 w-5 text-amber-600 shrink-0 mt-px" />
                  <p className="text-sm text-amber-800">
                    Aucune caisse ouverte {consolide ? "" : `pour ${libelle}`}. Les ventes ne peuvent
                    pas être enregistrées tant qu'une caisse n'est pas ouverte.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.caisses.map((c) => (
                    <div key={c.sessionId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{c.etablissementNom}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Ouverte à {heure(c.ouverteA)} par {c.ouvertePar}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-semibold text-amber-600 tabulaire">
                          {fcfa(c.soldeTheorique)}
                        </p>
                        <p className="text-xs text-gray-500">solde théorique</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* --- Alertes de stock (§5.11) --- */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Alertes de stock</h2>
                <Link to="/stocks" className="text-sm text-indigo-600 hover:underline">Voir tout</Link>
              </div>

              {stats.ruptures.length === 0 && stats.bientotEnRupture.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">
                  Aucune alerte : tous les articles suivis sont au-dessus de leur seuil.
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {stats.ruptures.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-2.5 bg-red-50 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <PackageX className="h-4 w-4 text-red-600 shrink-0" />
                        <span className="text-sm text-gray-900 truncate">{p.nom}</span>
                      </div>
                      <Badge ton="danger">Rupture</Badge>
                    </div>
                  ))}
                  {stats.bientotEnRupture.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-2.5 bg-amber-50 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span className="text-sm text-gray-900 truncate">{p.nom}</span>
                      </div>
                      <Badge ton="alerte">
                        {nombre(p.quantite)} / seuil {nombre(p.seuilAlerte)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {/* Détail d'un indicateur : les lignes qui composent le total affiché. */}
      <ModaleDetail
        quoi={detail}
        onFermer={() => setDetail(null)}
        periode={periode}
        debut={debut}
        fin={fin}
        etablissement={selection}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

const TITRES_DETAIL: Record<Detail, string> = {
  entrees: "Détail du débit (entrées)",
  ventes: "Détail des ventes",
  sorties: "Détail du crédit (sorties)",
};

/**
 * Détail d'un indicateur.
 *
 * Les données sont demandées aux mêmes routes que les écrans Ventes et
 * Dépenses, avec la période et l'établissement en cours : ce qui s'affiche ici
 * est donc, par construction, exactement ce qui a servi à calculer le total —
 * et non un second calcul qui pourrait diverger.
 */
function ModaleDetail({
  quoi, onFermer, periode, debut, fin, etablissement,
}: {
  quoi: Detail | null;
  onFermer: () => void;
  periode: PeriodKey;
  debut: string;
  fin: string;
  etablissement: SelectionEtablissement;
}) {
  const [ventes, setVentes] = useState<Sale[] | null>(null);
  const [depenses, setDepenses] = useState<Expense[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!quoi) return;
    let annule = false;
    setErreur(null);
    setVentes(null);
    setDepenses(null);

    const options = { debut, fin, etablissement };
    const promesse = quoi === "sorties"
      ? getDepenses(periode, options).then((d) => { if (!annule) setDepenses(d); })
      : getVentes(periode, options).then((v) => { if (!annule) setVentes(v); });

    promesse.catch((e) => {
      if (!annule) {
        setErreur(e instanceof Error ? e.message : "Détail indisponible.");
      }
    });
    return () => { annule = true; };
  }, [quoi, periode, debut, fin, etablissement]);

  if (!quoi) return null;
  const listeDepenses = quoi === "sorties";

  return (
    <Modale ouverte titre={TITRES_DETAIL[quoi]} onFermer={onFermer} taille="xl">
      <Erreur message={erreur} />

      {listeDepenses ? (
        !depenses ? (
          <Chargement />
        ) : depenses.length === 0 ? (
          <Vide titre="Aucune sortie sur cette période" icone={TrendingDown} />
        ) : (
          <Tableau entetes={["Date", "Poste", "Motif", "Établissement", "Par", " Montant"]}>
            {depenses.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(d.dateDepense)}</td>
                <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{EXPENSE_LABELS[d.categorie]}</td>
                <td className="px-4 py-3 text-gray-700 max-w-xs">
                  <span className="block truncate" title={d.motif}>{d.motif}</span>
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{d.etablissementNom ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{d.effectueParNom ?? "—"}</td>
                <td className="px-4 py-3 text-right tabulaire font-medium text-red-700 whitespace-nowrap">
                  {fcfa(d.montant)}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-4 py-3" colSpan={5}>Total — {depenses.length} sortie(s)</td>
              <td className="px-4 py-3 text-right tabulaire text-red-700">
                {fcfa(depenses.reduce((s, d) => s + d.montant, 0))}
              </td>
            </tr>
          </Tableau>
        )
      ) : !ventes ? (
        <Chargement />
      ) : ventes.length === 0 ? (
        <Vide titre="Aucune vente sur cette période" icone={ShoppingCart} />
      ) : (
        <Tableau entetes={["Date", "Reçu", "Établissement", "Vendeur", "Moyen", " Total"]}>
          {ventes.map((v) => (
            <tr key={v.id} className={cn("hover:bg-gray-50", v.statut === "annulee" && "opacity-60")}>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(v.createdAt)}</td>
              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                {v.numeroRecu}
                {v.statut === "annulee" && <Badge ton="danger">Annulée</Badge>}
              </td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.etablissementNom ?? "—"}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.vendeurNom ?? "—"}</td>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{PAYMENT_LABELS[v.paymentMethod]}</td>
              <td className="px-4 py-3 text-right tabulaire font-medium text-green-700 whitespace-nowrap">
                {fcfa(v.total)}
              </td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-3" colSpan={5}>Total — {ventes.length} vente(s)</td>
            <td className="px-4 py-3 text-right tabulaire text-green-700">
              {fcfa(ventes.reduce((s, v) => s + v.total, 0))}
            </td>
          </tr>
        </Tableau>
      )}
    </Modale>
  );
}

/** Icône de substitution pour l'état vide du graphique. */
function IconeGraphiqueVide(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}
