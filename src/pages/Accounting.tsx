import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getTransactions, createTransaction, updateTransaction, deleteTransaction, getSalesSummary, Transaction, SalesSummary } from "../services/db";
import { Plus, TrendingUp, TrendingDown, Wallet, X, Trash2, Pencil, ShoppingBag, HandCoins } from "lucide-react";

const EXPENSE_CATEGORIES = ["Loyer", "Salaires", "Fournitures", "Électricité/Eau", "Marketing", "Imprévu", "Autre"];
const INCOME_CATEGORIES = ["Vente", "Pourboire", "Prestation", "Acompte", "Autre"];
const AUTO_CATEGORIES = ["Vente", "Pourboire"]; // générées automatiquement par la caisse

function rangeFor(period: string, ref: string): { from?: string; to?: string } {
  if (period === "Tout") return {};
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  let start = new Date(d), end = new Date(d);
  if (period === "Jour") {
    end.setHours(23, 59, 59, 999);
  } else if (period === "Semaine") {
    start.setDate(d.getDate() - d.getDay());
    end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
  } else if (period === "Mois") {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function Accounting() {
  const { user } = useAuth();
  const [business, setBusiness] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("Mois");
  const [refDate, setRefDate] = useState(new Date().toISOString().split("T")[0]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const isAdmin = business?.role === "admin";
  const [form, setForm] = useState({
    type: "debit" as "credit" | "debit",
    amount: "",
    category: "Imprévu",
    description: "",
    date: new Date().toISOString().split("T")[0],
  });

  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => { if (business) loadTransactions(business.id); }, [business, period, refDate]);

  const load = async () => {
    try {
      const rest = await getBusiness(user!.id);
      setBusiness(rest);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const loadTransactions = async (businessId: number) => {
    try {
      const { from, to } = rangeFor(period, refDate);
      const [data, summary] = await Promise.all([
        getTransactions(businessId, from, to),
        getSalesSummary(businessId, from, to).catch(() => null),
      ]);
      setTransactions(data);
      setSales(summary);
    } catch (e) { console.error(e); }
  };

  // La table transactions est la source unique du solde : les ventes de caisse y créent
  // automatiquement une écriture crédit (« Vente »), en plus des opérations manuelles.
  // On ne ré-additionne donc PAS le résumé des ventes (sinon double comptage).
  const credits = transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const debits = transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const net = credits - debits;

  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditingId(null);
    setForm({ type: "debit", amount: "", category: "Imprévu", description: "", date: new Date().toISOString().split("T")[0] });
    setFormError("");
    setShowModal(true);
  };

  const openEdit = (t: Transaction) => {
    setEditingId(t.id);
    setForm({
      type: t.type,
      amount: String(t.amount),
      category: t.category || (t.type === "credit" ? INCOME_CATEGORIES[0] : "Imprévu"),
      description: t.description || "",
      date: new Date(t.date).toISOString().split("T")[0],
    });
    setFormError("");
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        type: form.type,
        amount: parseInt(form.amount),
        category: form.category,
        description: form.description,
        date: new Date(form.date).toISOString(),
      };
      if (editingId) await updateTransaction(editingId, payload as any);
      else await createTransaction(business.id, payload as any);
      setShowModal(false);
      setEditingId(null);
      setForm({ type: "debit", amount: "", category: "Imprévu", description: "", date: new Date().toISOString().split("T")[0] });
      loadTransactions(business.id);
    } catch (err) {
      setFormError((err as Error).message || "Échec de l'enregistrement.");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer cette opération ?")) return;
    try { await deleteTransaction(id); loadTransactions(business.id); } catch (e) { console.error(e); }
  };

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Comptabilité</h1>
          <p className="text-sm text-gray-500 mt-1">Suivi des entrées, sorties et solde</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            {["Jour", "Semaine", "Mois", "Tout"].map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                {p}
              </button>
            ))}
            {period !== "Tout" && (
              <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)}
                className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded text-gray-500" />
            )}
          </div>
          <button onClick={openNew}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium">
            <Plus className="h-4 w-4 mr-2" /> Ajouter une opération
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Total Crédits (entrées)</p>
            <p className="text-2xl font-bold text-green-600">{fmt(credits)} FCFA</p>
          </div>
          <div className="h-12 w-12 bg-green-50 rounded-xl flex items-center justify-center"><TrendingUp className="h-6 w-6 text-green-600" /></div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Total Débits (sorties)</p>
            <p className="text-2xl font-bold text-red-600">{fmt(debits)} FCFA</p>
          </div>
          <div className="h-12 w-12 bg-red-50 rounded-xl flex items-center justify-center"><TrendingDown className="h-6 w-6 text-red-600" /></div>
        </div>
        <div className={`rounded-2xl p-6 shadow-sm border flex items-center justify-between ${net >= 0 ? "bg-gray-950 border-gray-900 text-white" : "bg-red-600 border-red-700 text-white"}`}>
          <div>
            <p className="text-sm font-medium text-gray-300 mb-1">Solde net</p>
            <p className="text-2xl font-bold">{fmt(net)} FCFA</p>
          </div>
          <div className="h-12 w-12 bg-white/10 rounded-xl flex items-center justify-center"><Wallet className="h-6 w-6 text-white" /></div>
        </div>
      </div>

      {sales && (sales.collected > 0 || sales.prestations > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex items-center mb-3">
            <ShoppingBag className="h-5 w-5 text-green-600 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Ventes de la caisse <span className="text-xs font-normal text-gray-400">(automatique)</span></h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div><p className="text-gray-500">Prestations</p><p className="font-bold text-gray-900">{sales.prestations} ({sales.tickets} vente{sales.tickets > 1 ? "s" : ""})</p></div>
            <div><p className="text-gray-500">CA net prestations</p><p className="font-bold text-green-600">{fmt(sales.net)} FCFA</p></div>
            <div><p className="text-gray-500 flex items-center"><HandCoins className="h-3.5 w-3.5 mr-1" />Pourboires</p><p className="font-bold text-gray-700">{fmt(sales.tips)} FCFA</p></div>
            <div><p className="text-gray-500">Encaissé (ventes)</p><p className="font-bold text-indigo-600">{fmt(sales.collected)} FCFA</p></div>
          </div>
          {(sales.discounts > 0 || sales.offeredValue > 0) && (
            <p className="text-xs text-gray-400 mt-3">
              {sales.discounts > 0 && `Réductions accordées : ${fmt(sales.discounts)} FCFA. `}
              {sales.offeredValue > 0 && `Prestations offertes : ${sales.offeredCount} (${fmt(sales.offeredValue)} FCFA, non comptés dans le CA).`}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Écritures comptables</h2>
          <p className="text-xs text-gray-400 mt-0.5">Ventes de caisse (automatiques) + opérations saisies à la main</p>
        </div>
        {transactions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aucune opération sur cette période.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Catégorie</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3 text-right">Montant</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-600">{new Date(t.date).toLocaleDateString("fr-FR")}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">{t.category || "—"}</span>
                      {AUTO_CATEGORIES.includes(t.category || "") && <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-50 text-green-600">auto</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{t.description || "—"}</td>
                    <td className={`px-6 py-4 text-right text-sm font-bold ${t.type === "credit" ? "text-green-600" : "text-red-600"}`}>
                      {t.type === "credit" ? "+" : "−"}{fmt(t.amount)} FCFA
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(t)} title="Modifier" className="text-gray-400 hover:text-indigo-600 mr-1"><Pencil className="h-4 w-4" /></button>
                      {isAdmin && <button onClick={() => handleDelete(t.id)} title="Supprimer" className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editingId ? "Modifier l'opération" : "Nouvelle opération"}</h3>
              <button onClick={() => { setShowModal(false); setEditingId(null); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm">{formError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setForm({ ...form, type: "credit", category: INCOME_CATEGORIES[0] })}
                  className={`py-2 rounded-lg text-sm font-medium border ${form.type === "credit" ? "bg-green-50 border-green-300 text-green-700" : "border-gray-200 text-gray-500"}`}>
                  Crédit (entrée)
                </button>
                <button type="button" onClick={() => setForm({ ...form, type: "debit", category: "Imprévu" })}
                  className={`py-2 rounded-lg text-sm font-medium border ${form.type === "debit" ? "bg-red-50 border-red-300 text-red-700" : "border-gray-200 text-gray-500"}`}>
                  Débit (sortie)
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Montant (FCFA)</label>
                <input type="number" min="0" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm">
                  {(form.type === "credit" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optionnel)</label>
                <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: Facture électricité juillet" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <button type="submit" disabled={saving} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? "Enregistrement..." : editingId ? "Enregistrer les modifications" : "Enregistrer"}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
