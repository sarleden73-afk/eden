import { useEffect, useState, type SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Wallet, ShoppingCart, TrendingUp, TrendingDown, CreditCard, AlertTriangle,
  PackageX, Store, UtensilsCrossed,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, StatCard, Chargement, Erreur, SelecteurPeriode, Badge, Vide,
} from "../components/ui";
import { getTableauDeBord } from "../services/db";
import { fcfa, nombre, dateCourte, heure } from "../lib/format";
import { cn } from "../lib/utils";
import { POLE_LABELS, type DashboardStats, type PeriodKey } from "../types";
import { aujourdhui } from "../lib/format";

/** §5.11 Tableau de bord. */
export default function Dashboard() {
  const [periode, setPeriode] = useState<PeriodKey>("jour");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    getTableauDeBord(periode, { debut, fin })
      .then((d) => { if (!annule) { setStats(d); setErreur(null); } })
      .catch((e) => { if (!annule) setErreur(e.message); })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [periode, debut, fin]);

  const serie = (stats?.serie ?? []).map((j) => ({
    jour: dateCourte(j.date).slice(0, 5),
    "Multi-Services": j.caMultiServices,
    "Food": j.caFood,
    // Les dépenses valent toujours 0 pour un profil restreint : la barre est
    // retirée plutôt que dessinée à plat, ce qui laisserait croire à une absence
    // de dépenses au lieu d'une absence de droit.
    ...(stats?.restreint ? {} : { "Dépenses": j.depenses }),
  }));

  return (
    <Layout>
      <PageHeader
        titre="Tableau de bord"
        sousTitre={
          stats?.restreint
            ? "Votre activité, l'état de la caisse et les alertes de stock"
            : "Vue consolidée des deux pôles"
        }
      >
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
      </PageHeader>

      <Erreur message={erreur} />

      {chargement && !stats ? (
        <Chargement />
      ) : stats ? (
        <div className="space-y-6">
          {/* --- Chiffre d'affaires --- */}
          {/* Un profil restreint (caissier, technicien) voit ses propres ventes,
              sans marge ni bénéfice : le serveur ne les lui transmet pas. */}
          <div className={cn(
            "grid gap-4 sm:grid-cols-2",
            stats.restreint ? "lg:grid-cols-3" : "lg:grid-cols-4"
          )}>
            <StatCard
              titre={POLE_LABELS.MULTI_SERVICES}
              valeur={fcfa(stats.caMultiServices)}
              icone={Store}
              detail={stats.restreint ? "Vos ventes" : "Chiffre d'affaires"}
            />
            <StatCard
              titre={POLE_LABELS.FOOD}
              valeur={fcfa(stats.caFood)}
              icone={UtensilsCrossed}
              detail={stats.restreint ? "Vos ventes" : "Chiffre d'affaires"}
            />
            <StatCard
              titre={stats.restreint ? "Votre total" : "CA total"}
              valeur={fcfa(stats.caTotal)}
              icone={TrendingUp}
              detail={`${nombre(stats.nbVentes)} vente${stats.nbVentes > 1 ? "s" : ""}`}
            />
            {!stats.restreint && (
              <StatCard
                titre="Bénéfice estimatif"
                valeur={fcfa(stats.beneficeEstimatif)}
                icone={stats.beneficeEstimatif >= 0 ? TrendingUp : TrendingDown}
                ton={stats.beneficeEstimatif >= 0 ? "succes" : "danger"}
                detail="Marge brute − dépenses"
              />
            )}
          </div>

          {!stats.restreint && (
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard titre="Marge brute" valeur={fcfa(stats.margeBrute)} icone={TrendingUp} />
              <StatCard titre="Dépenses" valeur={fcfa(stats.depenses)} icone={CreditCard} />
              <StatCard titre="Nombre de ventes" valeur={nombre(stats.nbVentes)} icone={ShoppingCart} />
            </div>
          )}

          {/* --- Évolution --- */}
          <Card className="p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Évolution sur la période</h2>
            {serie.length === 0 ? (
              <Vide titre="Aucun mouvement sur cette période" icone={BarChartVide} />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e2" vertical={false} />
                    <XAxis dataKey="jour" tick={{ fontSize: 12, fill: "#7f7a72" }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#7f7a72" }} tickLine={false} axisLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(v: number) => fcfa(v)}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e8e6e2", fontSize: 13 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Multi-Services" fill="#1fa066" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Food" fill="#d4a017" radius={[3, 3, 0, 0]} />
                    {!stats.restreint && (
                      <Bar dataKey="Dépenses" fill="#c05252" radius={[3, 3, 0, 0]} />
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
                    Aucune caisse ouverte. Les ventes ne peuvent pas être enregistrées tant qu'une
                    caisse n'est pas ouverte pour le pôle concerné.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.caisses.map((c) => (
                    <div key={c.sessionId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{POLE_LABELS[c.pole]}</p>
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
    </Layout>
  );
}

/** Icône de substitution pour l'état vide du graphique. */
function BarChartVide(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}
