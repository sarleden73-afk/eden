import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  getBusiness, getCustomers, createCustomer, getServices, getVariants, getEmployees, getVisits,
  recordVisit, redeemReward, getLoyaltySettings, lookupCustomerByPhone, assignCard, VisitItem,
  Customer, ServiceVariant, LoyaltyMode,
} from "../services/db";
import Layout from "../components/Layout";
import { Plus, Search, X, Users as UsersIcon, Award, CheckCircle, Star, CreditCard, Phone, Trash2, Gift, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

const fmt = (n: number) => (n ?? 0).toLocaleString("fr-FR");
const INACTIVE_DAYS = 60;

const progressLabel = (mode: LoyaltyMode) => mode === "points" ? "points" : mode === "stamps" ? "tampons" : "visites";
const progressOf = (mode: LoyaltyMode, c: Customer) => mode === "points" ? c.points : mode === "stamps" ? c.stamps : c.visits;
const isInactive = (c: Customer) => {
  const ref = c.lastVisitDate || c.createdAt;
  if (!ref) return false;
  return (Date.now() - new Date(ref).getTime()) / 86400000 > INACTIVE_DAYS;
};

export default function Customers() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [variantsByService, setVariantsByService] = useState<Record<number, ServiceVariant[]>>({});
  const [employeesList, setEmployeesList] = useState<any[]>([]);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [mode, setMode] = useState<LoyaltyMode>("visits");
  const [role, setRole] = useState<string>("admin");
  const isAdmin = role === "admin";
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Quick phone-first lookup
  const [phoneQuery, setPhoneQuery] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickHasCard, setQuickHasCard] = useState(true);
  const [creatingQuick, setCreatingQuick] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [serverMatch, setServerMatch] = useState<Customer | null>(null); // recherche serveur (staff)
  const [assigningCard, setAssigningCard] = useState(false);

  // Detail / cart state
  const [selected, setSelected] = useState<Customer | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const emptyCartRow = () => ({ serviceId: "", variantId: "", employeeId: "", offered: false, qty: 1 });
  const [cart, setCart] = useState<{ serviceId: string; variantId: string; employeeId: string; offered: boolean; qty: number }[]>([emptyCartRow()]);
  const [tip, setTip] = useState("");
  const [discount, setDiscount] = useState("");
  const [saving, setSaving] = useState(false);
  const [validateMsg, setValidateMsg] = useState("");
  const [detailError, setDetailError] = useState("");

  // Prestation pré-sélectionnée depuis l'onglet Prestations (bouton "Vendre")
  const [pendingServiceId] = useState<string | null>(() => {
    const v = sessionStorage.getItem("fidely_pending_service");
    sessionStorage.removeItem("fidely_pending_service");
    return v;
  });

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    try {
      const rest = await getBusiness(user!.id);
      if (rest) {
        setBusinessId(rest.id);
        if (rest.role) setRole(rest.role);
        const [custData, svcData, empData, loyalty] = await Promise.all([
          getCustomers(rest.id), getServices(rest.id), getEmployees(rest.id), getLoyaltySettings(rest.id).catch(() => ({ mode: "visits" as LoyaltyMode })),
        ]);
        setCustomers(custData);
        setServices(svcData);
        setEmployeesList(empData);
        setMode(loyalty.mode);
        const entries = await Promise.all(svcData.map(async (s: any) => [s.id, await getVariants(s.id).catch(() => [])] as const));
        setVariantsByService(Object.fromEntries(entries));
      }
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  // --- Phone-first quick lookup ---
  // Admin : recherche locale instantanée (il a les numéros). Staff : le numéro n'est
  // jamais chargé côté navigateur, donc on interroge le serveur qui retrouve le client
  // sans jamais renvoyer son numéro.
  const localMatch = useMemo(() => {
    const q = phoneQuery.trim();
    if (q.length < 3) return null;
    return customers.find(c => (c.phone || "").replace(/\s/g, "").includes(q.replace(/\s/g, ""))) || null;
  }, [phoneQuery, customers]);

  useEffect(() => {
    if (isAdmin || !businessId) { setServerMatch(null); return; }
    const q = phoneQuery.trim();
    if (q.length < 3) { setServerMatch(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const found = await lookupCustomerByPhone(businessId, q);
        if (!cancelled) setServerMatch(found);
      } catch { if (!cancelled) setServerMatch(null); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [phoneQuery, isAdmin, businessId]);

  const phoneMatch = isAdmin ? localMatch : serverMatch;

  const handleQuickCreate = async () => {
    if (!businessId || !phoneQuery.trim() || !quickName.trim()) return;
    setCreatingQuick(true);
    setQuickError("");
    try {
      const c = await createCustomer(businessId, { name: quickName.trim(), phone: phoneQuery.trim(), hasCard: quickHasCard });
      setCustomers(prev => [...prev, c]);
      setPhoneQuery("");
      setQuickName("");
      setQuickHasCard(true);
      openDetail(c);
    } catch (err) {
      setQuickError((err as Error).message || "Échec de la création.");
    } finally { setCreatingQuick(false); }
  };

  // --- Detail / cart ---
  const openDetail = async (c: Customer) => {
    setSelected(c);
    setCart([{ ...emptyCartRow(), serviceId: pendingServiceId || "" }]);
    setTip("");
    setDiscount("");
    setValidateMsg("");
    setDetailError("");
    setHistory([]);
    try {
      const v = await getVisits(c.id);
      v.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setHistory(v);
      const fresh = await fetch(`/api/customers/${c.id}`).then(r => r.json());
      // L'endpoint public ne renvoie plus le téléphone : on conserve celui de la liste
      // (présent pour l'admin, absent pour le staff).
      setSelected({ ...fresh, phone: c.phone });
    } catch (e) { console.error(e); }
  };

  const addCartRow = () => setCart([...cart, emptyCartRow()]);
  const removeCartRow = (i: number) => setCart(cart.filter((_, idx) => idx !== i));
  const updateCartRow = (i: number, patch: Partial<{ serviceId: string; variantId: string; employeeId: string; offered: boolean; qty: number }>) => {
    setCart(cart.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };

  const cartLines = cart
    .filter(r => r.serviceId)
    .map(r => {
      const svc = services.find((s: any) => s.id === parseInt(r.serviceId));
      const variant = r.variantId ? (variantsByService[parseInt(r.serviceId)] || []).find(v => v.id === parseInt(r.variantId)) : null;
      const unitPrice = r.offered ? 0 : (variant ? variant.price : svc?.price || 0);
      const label = variant ? `${svc?.name} — ${variant.name}` : svc?.name;
      const qty = Math.max(1, r.qty || 1);
      return { ...r, qty, label, unitPrice, price: unitPrice * qty };
    });
  const cartSubtotal = cartLines.reduce((s, l) => s + l.price, 0);
  const tipCents = (parseInt(tip) || 0) * 100;
  const discountCents = (parseInt(discount) || 0) * 100;
  const cartTotal = Math.max(0, cartSubtotal - discountCents) + tipCents;
  // Traçabilité obligatoire : chaque prestation doit être liée à l'employé qui l'a réalisée.
  const missingEmployee = cartLines.some(l => !l.employeeId);

  const handleValidate = async () => {
    if (!selected || cartLines.length === 0 || saving) {
      if (cartLines.length === 0) setDetailError("Ajoutez au moins une prestation.");
      return;
    }
    if (missingEmployee) { setDetailError("Sélectionnez l'employé pour chaque prestation avant de valider."); return; }
    setSaving(true);
    setDetailError("");
    setValidateMsg("");
    try {
      // Une quantité x2/x3 se traduit simplement par plusieurs lignes identiques
      // (comme "burger x2" au restaurant) — aucun changement côté serveur nécessaire.
      const items: VisitItem[] = cart.filter(r => r.serviceId).flatMap(r =>
        Array.from({ length: Math.max(1, r.qty || 1) }, () => ({
          serviceId: r.variantId ? undefined : parseInt(r.serviceId),
          variantId: r.variantId ? parseInt(r.variantId) : undefined,
          employeeId: r.employeeId ? parseInt(r.employeeId) : undefined,
          offered: r.offered,
        }))
      );
      // tip/discount sont exprimés en FCFA côté serveur (comme le montant des prestations)
      const res = await recordVisit(selected.id, items, { tip: parseInt(tip) || 0, discount: parseInt(discount) || 0 });
      const rewardMsg = res.unlockedRewards?.length ? ` 🎁 ${res.unlockedRewards.length} récompense(s) disponible(s) !` : "";
      setValidateMsg(`Prestation enregistrée ! +${res.earnedPoints} pts · ${fmt(res.amount)} FCFA.${rewardMsg}`);
      const fresh = await fetch(`/api/customers/${selected.id}`).then(r => r.json());
      setSelected({ ...fresh, phone: selected.phone });
      setCustomers(prev => prev.map(c => c.id === selected.id ? { ...fresh, phone: c.phone } : c));
      const v = await getVisits(selected.id);
      v.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setHistory(v);
      setCart([emptyCartRow()]);
      setTip("");
      setDiscount("");
    } catch (err) {
      setDetailError((err as Error).message || "Échec de la validation.");
    } finally { setSaving(false); }
  };

  const [redeeming, setRedeeming] = useState(false);
  const handleRedeem = async (rewardId: number) => {
    if (!selected || redeeming) return;
    setRedeeming(true);
    try {
      await redeemReward(selected.id, rewardId);
      const fresh = await fetch(`/api/customers/${selected.id}`).then(r => r.json());
      setSelected({ ...fresh, phone: selected.phone });
      setCustomers(prev => prev.map(c => c.id === selected.id ? { ...fresh, phone: c.phone } : c));
      setValidateMsg("Récompense utilisée. Le compteur repart à zéro.");
    } catch (err) {
      setDetailError((err as Error).message || "Échec.");
    } finally { setRedeeming(false); }
  };

  const handleAssignCard = async () => {
    if (!selected || assigningCard) return;
    setAssigningCard(true);
    setDetailError("");
    try {
      const updated = await assignCard(selected.id);
      setSelected(prev => prev ? { ...prev, cardNumber: updated.cardNumber } : prev);
      setCustomers(prev => prev.map(c => c.id === selected.id ? { ...c, cardNumber: updated.cardNumber } : c));
      setValidateMsg(`Carte de fidélité attribuée : N° ${updated.cardNumber}`);
    } catch (err) {
      setDetailError((err as Error).message || "Échec de l'attribution de la carte.");
    } finally { setAssigningCard(false); }
  };

  const q = searchTerm.trim().toLowerCase();
  const filteredCustomers = customers.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(searchTerm) ||
    (c.cardNumber || "").toLowerCase().includes(q) || (c.code || "").toLowerCase().includes(q)
  );

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
        <p className="text-sm text-gray-500 mt-1">Cherchez par téléphone pour démarrer une prestation en quelques secondes</p>
      </div>

      {/* Phone-first quick lookup */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
        <label className="block text-sm font-semibold text-gray-800 mb-2">📞 Numéro de téléphone du client</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Phone className="h-5 w-5 text-gray-400" /></div>
          <input
            type="tel" autoFocus value={phoneQuery} onChange={e => { setPhoneQuery(e.target.value); setQuickError(""); }}
            placeholder="Ex: 690112233"
            className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        {phoneQuery.trim().length >= 3 && (
          phoneMatch ? (
            <div className="mt-3 flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-3">
              <div>
                <p className="font-semibold text-green-800">{phoneMatch.name} <span className="text-xs font-mono text-green-600">({phoneMatch.code})</span></p>
                <p className="text-xs text-green-700">Client trouvé — {progressOf(mode, phoneMatch)} {progressLabel(mode)}</p>
              </div>
              <button onClick={() => { openDetail(phoneMatch); setPhoneQuery(""); }} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                Ouvrir la fiche →
              </button>
            </div>
          ) : (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-sm text-amber-800 mb-2">Aucun client avec ce numéro. Créer un nouveau client ?</p>
              {quickError && <p className="text-sm text-red-600 mb-2">{quickError}</p>}
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={quickName} onChange={e => setQuickName(e.target.value)} placeholder="Nom complet" className="flex-1 border-amber-200 rounded-lg text-sm" />
                <button onClick={handleQuickCreate} disabled={creatingQuick || !quickName.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {creatingQuick ? "Création..." : "Créer le client"}
                </button>
              </div>
              <label className="flex items-center text-xs text-amber-800 mt-2 cursor-pointer">
                <input type="checkbox" checked={quickHasCard} onChange={e => setQuickHasCard(e.target.checked)} className="mr-2 rounded" />
                Attribuer une carte de fidélité à ce client
              </label>
            </div>
          )
        )}
      </div>

      <div className="mb-4 relative max-w-md">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-5 w-5 text-gray-400" /></div>
        <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm shadow-sm"
          placeholder="Ou cherchez par nom, code (CL-0001)..." />
      </div>

      <div className="bg-white shadow-sm overflow-hidden rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3 text-center">{progressLabel(mode)}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCustomers.map(customer => (
                <tr key={customer.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(customer)}>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="relative mr-3">
                        <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">{customer.name.charAt(0).toUpperCase()}</div>
                        {isInactive(customer) && (
                          <span title={`Aucune visite depuis plus de ${INACTIVE_DAYS} jours`} className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 border-2 border-white" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
                        {isAdmin
                          ? <p className="text-xs text-gray-500">{customer.phone}</p>
                          : <p className="text-xs text-gray-400 font-mono">{customer.code || "—"}</p>}
                      </div>
                      {customer.rewardStatus === "available" && (
                        <span className="ml-3 px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-100 text-green-800 flex items-center"><Award className="h-3 w-3 mr-1" />Récompense</span>
                      )}
                      {isInactive(customer) && (
                        <span className="ml-2 px-2 py-0.5 text-[11px] font-medium rounded-full bg-red-50 text-red-700 flex items-center"><AlertCircle className="h-3 w-3 mr-1" />Inactif</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4"><span className="font-mono text-sm font-semibold text-gray-700">{customer.code || "—"}</span></td>
                  <td className="px-6 py-4 text-center"><span className="inline-flex items-center text-sm font-bold text-indigo-600"><Star className="h-3.5 w-3.5 mr-1 text-amber-400" />{fmt(progressOf(mode, customer))}</span></td>
                  <td className="px-6 py-4 text-right"><span className="text-indigo-600 text-sm font-medium">Ouvrir →</span></td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-500"><UsersIcon className="h-12 w-12 text-gray-300 mb-3 mx-auto" /> Aucun client trouvé.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Client detail + prestation cart */}
      {selected && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 sticky top-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{selected.name}</h3>
                <p className="text-xs text-gray-500 font-mono">{selected.code}{isAdmin && selected.phone ? ` · ${selected.phone}` : ""}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-indigo-50 rounded-xl p-3">
                  <p className="text-xl font-bold text-indigo-700 flex items-center justify-center"><Star className="h-4 w-4 mr-1 text-amber-400" />{fmt(progressOf(mode, selected))}</p>
                  <p className="text-[11px] text-indigo-600 uppercase font-medium">{progressLabel(mode)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xl font-bold text-gray-900">{selected.tier || "—"}</p>
                  <p className="text-[11px] text-gray-500 uppercase font-medium">Niveau</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  {selected.cardNumber ? (
                    <p className="text-xl font-bold text-gray-900 flex items-center justify-center"><CreditCard className="h-4 w-4 mr-1 text-gray-400" />{selected.cardNumber}</p>
                  ) : (
                    <button onClick={handleAssignCard} disabled={assigningCard}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center justify-center mx-auto py-1">
                      <CreditCard className="h-4 w-4 mr-1" />{assigningCard ? "..." : "Attribuer une carte"}
                    </button>
                  )}
                  <p className="text-[11px] text-gray-500 uppercase font-medium">Carte</p>
                </div>
              </div>

              {(selected.unlockedRewards?.length || 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-900 mb-2 flex items-center"><Gift className="h-4 w-4 mr-1.5" />Récompenses disponibles</p>
                  <div className="space-y-2">
                    {selected.unlockedRewards!.map(r => (
                      <div key={r.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
                        <span>{r.label} {r.value ? <span className="text-gray-400">({r.value})</span> : null}</span>
                        <button onClick={() => handleRedeem(r.id)} disabled={redeeming} className="text-amber-700 font-medium hover:underline disabled:opacity-50">Utiliser</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Multi-service cart */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-900 mb-3">Enregistrer une prestation</p>
                {services.length === 0 ? (
                  <p className="text-sm text-amber-600">Ajoutez d'abord des prestations.</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {cart.map((row, i) => {
                        const variants = row.serviceId ? (variantsByService[parseInt(row.serviceId)] || []) : [];
                        return (
                          <div key={i} className="flex flex-col sm:flex-row gap-2 bg-white rounded-lg p-2 border border-gray-100">
                            <select value={row.serviceId} onChange={e => updateCartRow(i, { serviceId: e.target.value, variantId: "" })} className="flex-1 text-sm border-gray-200 rounded-lg">
                              <option value="">Prestation...</option>
                              {services.map((s: any) => <option key={s.id} value={s.id}>{s.name} — {fmt(s.price / 100)} FCFA</option>)}
                            </select>
                            {variants.length > 0 && (
                              <select value={row.variantId} onChange={e => updateCartRow(i, { variantId: e.target.value })} className="text-sm border-gray-200 rounded-lg">
                                <option value="">Variante (défaut)</option>
                                {variants.map(v => <option key={v.id} value={v.id}>{v.name} — {fmt(v.price / 100)} FCFA</option>)}
                              </select>
                            )}
                            <select value={row.employeeId} onChange={e => updateCartRow(i, { employeeId: e.target.value })}
                              title="Employé qui réalise la prestation"
                              className={`text-sm rounded-lg ${row.employeeId ? "border-gray-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                              <option value="">Qui réalise ?</option>
                              {employeesList.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                            <select value={row.qty} onChange={e => updateCartRow(i, { qty: parseInt(e.target.value) })} title="Nombre de personnes / quantité" className="text-sm border-gray-200 rounded-lg w-16">
                              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>× {n}</option>)}
                            </select>
                            <label className="flex items-center text-xs text-gray-600 px-2 whitespace-nowrap" title="Offrir cette prestation">
                              <input type="checkbox" checked={row.offered} onChange={e => updateCartRow(i, { offered: e.target.checked })} className="mr-1 rounded" />
                              Offert
                            </label>
                            {cart.length > 1 && <button onClick={() => removeCartRow(i)} className="text-gray-300 hover:text-red-500 px-2"><Trash2 className="h-4 w-4" /></button>}
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={addCartRow} className="mt-2 text-sm text-indigo-600 font-medium hover:underline flex items-center"><Plus className="h-3.5 w-3.5 mr-1" />Ajouter une prestation</button>
                    <p className="text-[11px] text-gray-400 mt-1">Astuce : utilisez × 2, × 3... si plusieurs personnes prennent la même prestation ensemble.</p>

                    {cartLines.length > 0 && (
                      <>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Réduction (FCFA)</label>
                            <input type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" className="w-full text-sm border-gray-200 rounded-lg" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Pourboire (FCFA)</label>
                            <input type="number" min="0" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" className="w-full text-sm border-gray-200 rounded-lg" />
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-indigo-100 flex justify-between items-center text-sm">
                          <span className="text-gray-600">Total ({cartLines.reduce((s, l) => s + l.qty, 0)} prestation{cartLines.reduce((s, l) => s + l.qty, 0) > 1 ? "s" : ""})</span>
                          <span className="font-bold text-gray-900">{fmt(cartTotal / 100)} FCFA</span>
                        </div>
                      </>
                    )}
                    {missingEmployee && cartLines.length > 0 && <p className="text-xs text-amber-600 mt-2">Sélectionnez l'employé sur chaque prestation (« Qui réalise ? ») avant de valider.</p>}
                    {detailError && <p className="text-sm text-red-600 mt-2">{detailError}</p>}
                    {validateMsg && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 mt-2 flex items-start"><CheckCircle className="h-4 w-4 mr-1.5 mt-0.5 flex-shrink-0" />{validateMsg}</p>}
                    <button onClick={handleValidate} disabled={saving || cartLines.length === 0 || missingEmployee}
                      className="mt-3 w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
                      {saving ? "Enregistrement..." : "Enregistrer la prestation"}
                    </button>
                  </>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-gray-900">Historique</p>
                  <Link to={`/card/${selected.id}`} className="text-xs text-indigo-600 hover:underline">Voir la carte du client</Link>
                </div>
                {history.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucune visite enregistrée.</p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {history.map(v => (
                      <div key={v.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium text-gray-900">{v.serviceName || "Visite"}</p>
                          <p className="text-xs text-gray-400">{new Date(v.date).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                        <div className="text-right">
                          {v.amount ? <p className="text-sm font-medium text-gray-700">{fmt(v.amount)} FCFA</p> : null}
                          {v.points ? <p className="text-xs text-indigo-600 font-semibold">+{v.points} pts</p> : null}
                          {(v.tip || v.discount) ? (
                            <p className="text-[11px] text-gray-400">
                              {v.tip ? `+${fmt(v.tip)} pourboire` : ""}{v.tip && v.discount ? " · " : ""}{v.discount ? `-${fmt(v.discount)} réduction` : ""}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
