import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { Download, Lock, ShoppingBag, Scissors, Percent, Gift, HandCoins, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getSalesSummary, getTransactions, SalesSummary } from "../services/db";

const fmt = (n: number) => Math.round(n ?? 0).toLocaleString("fr-FR");
const PERIODS = ["Jour", "Semaine", "Mois", "Année", "Personnalisé"] as const;
type Period = typeof PERIODS[number];

function rangeFor(period: Period, ref: string, cFrom: string, cTo: string): { from?: string; to?: string; label: string } {
  if (period === "Personnalisé") {
    return {
      from: cFrom ? new Date(cFrom + "T00:00:00").toISOString() : undefined,
      to: cTo ? new Date(cTo + "T23:59:59").toISOString() : undefined,
      label: `${cFrom || "…"} → ${cTo || "…"}`,
    };
  }
  const d = new Date(ref); d.setHours(0, 0, 0, 0);
  let start = new Date(d), end = new Date(d);
  let label = "";
  if (period === "Jour") {
    end.setHours(23, 59, 59, 999);
    label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } else if (period === "Semaine") {
    start.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lundi
    end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    label = `Semaine du ${start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
  } else if (period === "Mois") {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  } else {
    start = new Date(d.getFullYear(), 0, 1);
    end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
    label = `Année ${d.getFullYear()}`;
  }
  return { from: start.toISOString(), to: end.toISOString(), label };
}

export default function Reports() {
  const { user } = useAuth();
  const [business, setBusiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("Mois");
  const [refDate, setRefDate] = useState(new Date().toISOString().split("T")[0]);
  const [cFrom, setCFrom] = useState(new Date().toISOString().split("T")[0]);
  const [cTo, setCTo] = useState(new Date().toISOString().split("T")[0]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [expenses, setExpenses] = useState(0);

  const range = rangeFor(period, refDate, cFrom, cTo);

  useEffect(() => { if (user) getBusiness(user.id).then(b => { setBusiness(b); setLoading(false); }); }, [user]);
  useEffect(() => {
    if (!business) return;
    const { from, to } = range;
    getSalesSummary(business.id, from, to).then(setSummary).catch(() => setSummary(null));
    getTransactions(business.id, from, to).then((tx: any[]) => {
      setExpenses(tx.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0));
    }).catch(() => setExpenses(0));
  }, [business, period, refDate, cFrom, cTo]);

  const s = summary;
  const netResult = (s?.collected || 0) - expenses;

  const chartData = (s?.series || []).map(p => ({
    name: new Date(p.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    total: p.total,
  }));

  const buildReport = () => {
    const now = new Date();
    const row = (label: string, value: string, strong = false) =>
      `<tr><td style="padding:8px 0;color:#555">${label}</td><td style="padding:8px 0;text-align:right;font-weight:${strong ? 800 : 700}">${value}</td></tr>`;
    const top = (s?.topServices || []).map(t => row(t.name, `${t.count} × · ${fmt(t.amount)} FCFA`)).join("") || `<tr><td style="color:#aaa;padding:8px 0">Aucune vente</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Rapport — ${business?.name || "Fidely"}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 24px}
h1{font-size:22px;margin:0}.sub{color:#888;font-size:13px;margin-top:4px}
.brand{color:#4f46e5;font-weight:800;letter-spacing:2px;text-transform:uppercase;font-size:13px}
.card{border:1px solid #eee;border-radius:12px;padding:16px 20px;margin-top:16px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:0 0 8px}
table{width:100%;border-collapse:collapse;font-size:14px}.big{font-size:24px;font-weight:800}
.net{color:${netResult >= 0 ? "#16a34a" : "#dc2626"}}.foot{margin-top:28px;color:#aaa;font-size:12px;text-align:center}
@media print{.noprint{display:none}}</style></head><body>
<div class="brand">${business?.name || "Fidely"}</div><h1>Rapport de ventes</h1>
<div class="sub">Période : ${range.label} · Généré le ${now.toLocaleDateString("fr-FR")} à ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
<div class="card"><h2>Ventes</h2><table>
${row("Prestations réalisées", String(s?.prestations || 0))}
${row("Nombre de ventes (tickets)", String(s?.tickets || 0))}
${row("Chiffre d'affaires (net prestations)", fmt(s?.net || 0) + " FCFA")}
${row("Réductions accordées", fmt(s?.discounts || 0) + " FCFA")}
${row("Prestations offertes", `${s?.offeredCount || 0} · ${fmt(s?.offeredValue || 0)} FCFA`)}
${row("Pourboires", fmt(s?.tips || 0) + " FCFA")}
<tr><td style="padding:10px 0;font-weight:800">Total encaissé</td><td style="padding:10px 0;text-align:right" class="big">${fmt(s?.collected || 0)} FCFA</td></tr>
</table></div>
<div class="card"><h2>Résultat</h2><table>
${row("Total encaissé", fmt(s?.collected || 0) + " FCFA")}
${row("Dépenses (sorties)", fmt(expenses) + " FCFA")}
<tr><td style="padding:10px 0;font-weight:800">Résultat net</td><td style="padding:10px 0;text-align:right" class="big net">${fmt(netResult)} FCFA</td></tr>
</table></div>
<div class="card"><h2>Top prestations</h2><table>${top}</table></div>
<div class="foot">Rapport généré par Fidely · « Enregistrer au format PDF » dans la boîte d'impression.</div>
<div class="noprint" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Imprimer / Enregistrer en PDF</button></div>
</body></html>`;
  };

  const generate = () => {
    const w = window.open("", "_blank");
    if (!w) { alert("Autorisez les pop-ups pour générer le rapport."); return; }
    w.document.write(buildReport());
    w.document.close();
    setTimeout(() => { try { w.print(); } catch {} }, 400);
  };

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  if (business && business.role && business.role !== "admin") {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-16 bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
          <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-900">Accès réservé</h2>
          <p className="text-gray-500 mt-1">Les rapports sont réservés aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  const metric = (icon: React.ReactNode, label: string, value: string, sub?: string, tone = "text-gray-900") => (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>{icon}</div>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );

  return (
    <Layout>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Rapports</h1>
          <p className="text-sm text-gray-500 mt-1">Généré automatiquement à partir des ventes · {range.label}</p>
        </div>
        <button onClick={generate} className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors shadow-sm text-sm font-medium">
          <Download className="h-4 w-4 mr-2" /> Exporter (PDF)
        </button>
      </div>

      {/* Sélecteur de période */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1 flex-wrap">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}>
              {p}
            </button>
          ))}
        </div>
        {period === "Personnalisé" ? (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={cFrom} onChange={e => setCFrom(e.target.value)} className="border-gray-200 rounded-lg text-sm py-1.5" />
            <span className="text-gray-400">→</span>
            <input type="date" value={cTo} onChange={e => setCTo(e.target.value)} className="border-gray-200 rounded-lg text-sm py-1.5" />
          </div>
        ) : (
          <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="border-gray-200 rounded-lg text-sm py-1.5" />
        )}
      </div>

      {/* Indicateurs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {metric(<Scissors className="h-5 w-5 text-indigo-500" />, "Prestations réalisées", String(s?.prestations || 0), `${s?.tickets || 0} vente(s)`)}
        {metric(<ShoppingBag className="h-5 w-5 text-green-500" />, "Chiffre d'affaires", `${fmt(s?.net || 0)}`, "FCFA (net prestations)", "text-green-600")}
        {metric(<Percent className="h-5 w-5 text-red-400" />, "Réductions", `${fmt(s?.discounts || 0)}`, "FCFA accordés", "text-red-500")}
        {metric(<Gift className="h-5 w-5 text-amber-500" />, "Prestations offertes", String(s?.offeredCount || 0), `${fmt(s?.offeredValue || 0)} FCFA offerts`, "text-amber-600")}
        {metric(<HandCoins className="h-5 w-5 text-gray-500" />, "Pourboires", `${fmt(s?.tips || 0)}`, "FCFA", "text-gray-700")}
        {metric(<Wallet className="h-5 w-5 text-indigo-600" />, "Total encaissé", `${fmt(s?.collected || 0)}`, `Résultat net : ${fmt(netResult)} FCFA`, "text-indigo-700")}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">Ventes sur la période</h3>
          <div className="h-72">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">Aucune vente sur cette période.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#a3a3a3", fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#a3a3a3", fontSize: 12 }} />
                  <Tooltip cursor={{ fill: "#f9fafb" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                  <Bar dataKey="total" name="CA (FCFA)" fill="#d4af37" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100"><h3 className="text-lg font-bold text-gray-900">Top prestations</h3></div>
          <div className="p-4 space-y-2">
            {(s?.topServices || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Aucune vente.</p>
            ) : s!.topServices.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 truncate pr-2">{t.name}</span>
                <span className="text-gray-500 whitespace-nowrap"><b className="text-gray-900">{t.count}×</b> · {fmt(t.amount)} FCFA</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
