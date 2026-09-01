import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  getBusiness, getCustomers, createCustomer, lookupCustomerByPhone,
  getServices, getCategories, getVariants, getEmployees, recordVisit, createService,
  getProducts,
  Customer, ServiceVariant, VisitItem, Product,
} from "../services/db";
import Layout from "../components/Layout";
import {
  Search, Plus, Minus, X, Trash2, ShoppingCart, UserPlus, Gift, CheckCircle,
  Phone, Percent, Wallet, ChevronRight, User, Scissors, Package, HelpCircle,
} from "lucide-react";

const fmt = (n: number) => Math.round(n ?? 0).toLocaleString("fr-FR");

// Une ligne du panier. La clé identifie le couple prestation/variante pour incrémenter
// la quantité au lieu d'ajouter des lignes en double.
interface CartLine {
  key: string;
  serviceId?: number;
  variantId?: number;
  productId?: number; // vente directe d'un produit d'inventaire (ex: une boisson), hors prestation
  name: string;
  unitPrice: number; // FCFA
  qty: number;
  offered: boolean;
  employeeId: string;
}

const unitsLeft = (p: Product) => Math.floor((p.stockUses || 0) / (p.usesPerUnit || 1));

export default function Sale() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [businessId, setBusinessId] = useState<number | null>(null);
  const [role, setRole] = useState("admin");
  const isAdmin = role === "admin";
  const [loading, setLoading] = useState(true);

  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [variantsByService, setVariantsByService] = useState<Record<number, ServiceVariant[]>>({});
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  const [activeCategory, setActiveCategory] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  // Produits vendables directement à la caisse (ceux avec un prix renseigné dans
  // l'Inventaire) — les consommables internes (sans prix) n'apparaissent pas ici.
  const sellableProducts = useMemo(() => products.filter(p => (p.price || 0) > 0), [products]);

  // Client
  const [selectedClient, setSelectedClient] = useState<Customer | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [serverMatch, setServerMatch] = useState<Customer | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newHasCard, setNewHasCard] = useState(true);
  const [creatingClient, setCreatingClient] = useState(false);
  const [clientError, setClientError] = useState("");

  // Panier
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountValue, setDiscountValue] = useState("");
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [tip, setTip] = useState("");

  // Création rapide d'une prestation absente du catalogue (depuis la caisse).
  // Elle est enregistrée durablement : disponible pour les prochaines fois.
  const [showNewService, setShowNewService] = useState(false);
  const [nsName, setNsName] = useState("");
  const [nsPrice, setNsPrice] = useState("");
  const [nsCategory, setNsCategory] = useState("");
  const [creatingService, setCreatingService] = useState(false);
  const [nsError, setNsError] = useState("");

  const [showRecap, setShowRecap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const pendingServiceId = useMemo(() => {
    const v = sessionStorage.getItem("fidely_pending_service");
    sessionStorage.removeItem("fidely_pending_service");
    return v ? parseInt(v) : null;
  }, []);

  // Client déjà identifié via le Scanner QR (évite de le rechercher par nom/téléphone).
  const pendingCustomerId = useMemo(() => {
    const v = sessionStorage.getItem("fidely_pending_customer_id");
    sessionStorage.removeItem("fidely_pending_customer_id");
    return v;
  }, []);

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    try {
      const rest = await getBusiness(user!.id);
      if (rest) {
        setBusinessId(rest.id);
        if (rest.role) setRole(rest.role);
        const [svc, cats, emps, custs, prods] = await Promise.all([
          getServices(rest.id), getCategories(rest.id), getEmployees(rest.id), getCustomers(rest.id),
          getProducts(rest.id).catch(() => []),
        ]);
        setServices(svc);
        setCategories(cats);
        setEmployees(emps);
        setCustomers(custs);
        setProducts(prods);
        const entries = await Promise.all(svc.map(async (s: any) => [s.id, await getVariants(s.id).catch(() => [])] as const));
        setVariantsByService(Object.fromEntries(entries));
        if (pendingServiceId) {
          const s = svc.find((x: any) => x.id === pendingServiceId);
          if (s) addToCart(s);
        }
        if (pendingCustomerId) {
          const c = custs.find((x: Customer) => x.id === pendingCustomerId);
          if (c) selectClient(c);
        }
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  // --- Recherche client ---
  const localResults = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return [];
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.code || "").toLowerCase().includes(q) ||
      (isAdmin && (c.phone || "").replace(/\s/g, "").includes(q.replace(/\s/g, "")))
    ).slice(0, 6);
  }, [clientQuery, customers, isAdmin]);

  useEffect(() => {
    // Staff : le numéro n'est pas chargé côté navigateur -> recherche serveur par numéro.
    if (isAdmin || !businessId) { setServerMatch(null); return; }
    const q = clientQuery.trim();
    if (q.length < 3 || !/\d/.test(q)) { setServerMatch(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try { const f = await lookupCustomerByPhone(businessId, q); if (!cancelled) setServerMatch(f); }
      catch { if (!cancelled) setServerMatch(null); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [clientQuery, isAdmin, businessId]);

  const clientResults = useMemo(() => {
    const list = [...localResults];
    if (serverMatch && !list.some(c => c.id === serverMatch.id)) list.unshift(serverMatch);
    return list;
  }, [localResults, serverMatch]);

  const selectClient = (c: Customer) => {
    setSelectedClient(c);
    setClientQuery("");
    setShowNewClient(false);
    setClientError("");
  };

  const handleCreateClient = async () => {
    if (!businessId || !newName.trim() || !newPhone.trim() || creatingClient) return;
    setCreatingClient(true);
    setClientError("");
    try {
      const c = await createCustomer(businessId, { name: newName.trim(), phone: newPhone.trim(), hasCard: newHasCard });
      setCustomers(prev => [...prev, c]);
      selectClient(c);
      setNewName(""); setNewPhone(""); setNewHasCard(true);
    } catch (e) {
      setClientError((e as Error).message || "Échec de la création.");
    } finally { setCreatingClient(false); }
  };

  // Crée la prestation dans le catalogue puis l'ajoute directement au panier.
  const handleCreateService = async () => {
    if (!businessId || creatingService || !nsName.trim()) return;
    const priceFcfa = parseInt(nsPrice) || 0;
    if (priceFcfa <= 0) { setNsError("Indiquez un prix."); return; }
    setCreatingService(true);
    setNsError("");
    try {
      // price est stocké en centimes côté base (comme tout le catalogue) ; durée par défaut 30 min.
      const created = await createService(businessId, {
        name: nsName.trim(),
        price: priceFcfa * 100,
        duration: 30,
        category: nsCategory || undefined,
      });
      setServices(prev => [...prev, created]);
      setVariantsByService(prev => ({ ...prev, [created.id]: [] }));
      addToCart(created);
      setNsName(""); setNsPrice(""); setNsCategory("");
      setShowNewService(false);
    } catch (e) {
      setNsError((e as Error).message || "Échec de la création.");
    } finally { setCreatingService(false); }
  };

  // --- Panier ---
  const addToCart = (service: any, variant?: ServiceVariant) => {
    const key = variant ? `v${variant.id}` : `s${service.id}`;
    setCart(prev => {
      const existing = prev.find(l => l.key === key);
      if (existing) return prev.map(l => l.key === key ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, {
        key,
        serviceId: variant ? undefined : service.id,
        variantId: variant ? variant.id : undefined,
        name: variant ? `${service.name} — ${variant.name}` : service.name,
        unitPrice: (variant ? variant.price : service.price) / 100,
        qty: 1,
        offered: false,
        employeeId: "",
      }];
    });
  };

  // Vente directe d'un produit (ex: une boisson) : pas de prestataire à choisir,
  // le stock se décompte tout seul à la validation.
  const addProductToCart = (product: Product) => {
    const key = `p${product.id}`;
    setCart(prev => {
      const existing = prev.find(l => l.key === key);
      if (existing) return prev.map(l => l.key === key ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, {
        key,
        productId: product.id,
        name: product.name,
        unitPrice: (product.price || 0) / 100,
        qty: 1,
        offered: false,
        employeeId: "",
      }];
    });
  };

  const setQty = (key: string, delta: number) =>
    setCart(prev => prev.flatMap(l => {
      if (l.key !== key) return [l];
      const qty = l.qty + delta;
      return qty <= 0 ? [] : [{ ...l, qty }];
    }));
  const updateLine = (key: string, patch: Partial<CartLine>) =>
    setCart(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key: string) => setCart(prev => prev.filter(l => l.key !== key));

  const subtotal = cart.filter(l => !l.offered).reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const offeredTotal = cart.filter(l => l.offered).reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const discountFcfa = Math.min(
    subtotal,
    discountMode === "percent"
      ? Math.round(subtotal * (parseFloat(discountValue) || 0) / 100)
      : (parseInt(discountValue) || 0)
  );
  const tipFcfa = parseInt(tip) || 0;
  const total = Math.max(0, subtotal - discountFcfa) + tipFcfa;
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  // Traçabilité obligatoire : chaque PRESTATION doit être liée à l'employé qui l'a
  // réalisée (aucune vente ne peut être enregistrée sans ça). Une ligne produit pure
  // (vente directe, ex: une boisson) n'a pas de prestataire — pas concernée.
  const missingEmployee = cart.some(l => (l.serviceId || l.variantId) && !l.employeeId);

  const filteredServices = services.filter(s =>
    (!activeCategory || s.category === activeCategory) &&
    (!serviceSearch || s.name.toLowerCase().includes(serviceSearch.toLowerCase()))
  );

  const resetSale = () => {
    setCart([]); setDiscountValue(""); setDiscountMode("amount"); setTip("");
    setSelectedClient(null); setShowRecap(false);
  };

  const handleValidate = async () => {
    if (!selectedClient || cart.length === 0 || saving) return;
    if (missingEmployee) { setError("Sélectionnez l'employé pour chaque prestation avant de valider."); return; }
    setSaving(true);
    setError("");
    try {
      // Chaque quantité devient N lignes identiques (comme « burger x2 » au restaurant).
      const items: VisitItem[] = cart.flatMap(l =>
        Array.from({ length: l.qty }, () => ({
          serviceId: l.variantId || l.productId ? undefined : l.serviceId,
          variantId: l.variantId ? l.variantId : undefined,
          productId: l.productId ? l.productId : undefined,
          employeeId: l.employeeId ? parseInt(l.employeeId) : undefined,
          offered: l.offered,
        }))
      );
      const res = await recordVisit(selectedClient.id, items, { tip: tipFcfa, discount: discountFcfa });
      const rewardMsg = res.unlockedRewards?.length ? ` · 🎁 ${res.unlockedRewards.length} récompense(s) débloquée(s) !` : "";
      setSuccess(`Vente enregistrée pour ${selectedClient.name} — ${fmt(res.amount)} FCFA encaissés, +${res.earnedPoints} pts.${rewardMsg}`);
      resetSale();
    } catch (e) {
      setError((e as Error).message || "Échec de la validation.");
      setShowRecap(false);
    } finally { setSaving(false); }
  };

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Caisse — Nouvelle vente</h1>
          <p className="text-sm text-gray-500 mt-1">Choisissez le client, cliquez les prestations ou produits, validez.</p>
        </div>
        <button onClick={() => setShowGuide(v => !v)}
          className="flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 shadow-sm flex-shrink-0">
          <HelpCircle className="h-4 w-4 mr-1.5" />Comment ça marche ?
        </button>
      </div>

      {showGuide && (
        <div className="mb-4 p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-sm text-indigo-900 space-y-1">
          <p><strong>1.</strong> Choisissez le client (nom, code ou téléphone), ou créez-le s'il n'existe pas.</p>
          <p><strong>2.</strong> Cliquez sur une <strong>prestation</strong> (coiffure, soin...) ou un <strong>produit</strong> (boisson...) pour l'ajouter au panier.</p>
          <p><strong>3.</strong> Pour une prestation, indiquez « Qui réalise ? ». Pour un produit, rien à faire — le stock se met à jour tout seul.</p>
          <p><strong>4.</strong> Vérifiez le panier à droite, puis cliquez « Valider la vente ».</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 rounded-xl bg-green-50 border border-green-200 flex items-start justify-between">
          <div className="flex items-start"><CheckCircle className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" /><p className="text-sm text-green-800">{success}</p></div>
          <button onClick={() => setSuccess(null)} className="text-green-600 hover:text-green-800"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Catalogue */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-5 w-5 text-gray-400" /></div>
            <input value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} placeholder="Rechercher une prestation..."
              className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm shadow-sm" />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setActiveCategory("")}
              className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${activeCategory === "" ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
              Toutes
            </button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setActiveCategory(c.name)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${activeCategory === c.name ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
                {c.name}
              </button>
            ))}
          </div>

          {/* Prestation absente du catalogue : on la crée en 2 champs, elle est enregistrée
              pour les prochaines fois et ajoutée au panier immédiatement. */}
          <div>
            <button onClick={() => { setShowNewService(v => !v); setNsError(""); setNsName(serviceSearch.trim()); }}
              className="text-sm text-indigo-600 font-medium hover:underline flex items-center">
              <Scissors className="h-4 w-4 mr-1.5" />Prestation absente ? Créer rapidement
            </button>
            {showNewService && (
              <div className="mt-2 bg-white border border-indigo-100 rounded-xl p-3 space-y-2 shadow-sm">
                {nsError && <p className="text-xs text-red-600">{nsError}</p>}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={nsName} onChange={e => setNsName(e.target.value)} placeholder="Nom de la prestation"
                    className="flex-1 border-gray-200 rounded-lg text-sm" />
                  <div className="flex items-center gap-1">
                    <input type="number" min="0" value={nsPrice} onChange={e => setNsPrice(e.target.value)} placeholder="Prix"
                      className="w-28 border-gray-200 rounded-lg text-sm" />
                    <span className="text-xs text-gray-500">FCFA</span>
                  </div>
                  <select value={nsCategory} onChange={e => setNsCategory(e.target.value)} className="text-sm border-gray-200 rounded-lg">
                    <option value="">Catégorie (optionnel)</option>
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  <button onClick={handleCreateService} disabled={creatingService || !nsName.trim() || !nsPrice}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                    {creatingService ? "..." : "Créer + ajouter"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">Elle sera enregistrée dans le catalogue : disponible avec son prix la prochaine fois.</p>
              </div>
            )}
          </div>

          {filteredServices.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-500">Aucune prestation ne correspond. Utilisez « Créer rapidement » ci-dessus.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredServices.map(s => {
                const variants = variantsByService[s.id] || [];
                return (
                  <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col shadow-sm">
                    <button onClick={() => addToCart(s)} className="text-left flex-1 group">
                      <p className="font-semibold text-gray-900 text-sm leading-tight group-hover:text-indigo-600">{s.name}</p>
                      <p className="text-indigo-600 font-bold mt-1">{fmt(s.price / 100)} <span className="text-[11px] text-gray-400 font-normal">FCFA</span></p>
                    </button>
                    {variants.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {variants.map(v => (
                          <button key={v.id} onClick={() => addToCart(s, v)}
                            className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
                            {v.name} · {fmt(v.price / 100)}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => addToCart(s)} className="mt-2 w-full py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 flex items-center justify-center">
                      <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Produits vendables directement (ex: boissons) : ajoutés au panier comme les
              prestations, mais sans prestataire — le stock se décompte à la validation. */}
          {sellableProducts.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center"><Package className="h-4 w-4 mr-1.5 text-gray-400" />Produits (vente directe)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sellableProducts.map(p => {
                  const left = unitsLeft(p);
                  const out = left <= 0;
                  return (
                    <div key={p.id} className={`bg-white rounded-xl border p-3 flex flex-col shadow-sm ${out ? "border-gray-100 opacity-50" : "border-gray-200"}`}>
                      <p className="font-semibold text-gray-900 text-sm leading-tight">{p.name}</p>
                      <p className="text-indigo-600 font-bold mt-1">{fmt((p.price || 0) / 100)} <span className="text-[11px] text-gray-400 font-normal">FCFA</span></p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{out ? "Rupture de stock" : `${left} ${p.unitLabel}${left > 1 ? "s" : ""} en stock`}</p>
                      <button onClick={() => addProductToCart(p)} disabled={out}
                        className="mt-2 w-full py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                        <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Ticket / panier */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm sticky top-4 flex flex-col max-h-[calc(100vh-2rem)]">
            {/* Client */}
            <div className="p-4 border-b border-gray-100">
              {selectedClient ? (
                <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-3 py-2">
                  <div className="flex items-center min-w-0">
                    <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold mr-2 flex-shrink-0">{selectedClient.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{selectedClient.name}</p>
                      <p className="text-[11px] text-gray-500 font-mono">{selectedClient.code}{isAdmin && selectedClient.phone ? ` · ${selectedClient.phone}` : ""}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedClient(null)} className="text-gray-400 hover:text-gray-600 text-xs font-medium">Changer</button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><User className="h-4 w-4 text-gray-400" /></div>
                    <input value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Client : nom, code ou téléphone"
                      className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  {clientQuery && (
                    <div className="mt-1 border border-gray-100 rounded-lg divide-y divide-gray-50 overflow-hidden">
                      {clientResults.length > 0 ? clientResults.map(c => (
                        <button key={c.id} onClick={() => selectClient(c)} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between">
                          <span className="text-sm text-gray-800">{c.name} <span className="text-[11px] text-gray-400 font-mono">{c.code}</span></span>
                          <ChevronRight className="h-4 w-4 text-gray-300" />
                        </button>
                      )) : <p className="px-3 py-2 text-xs text-gray-400">Aucun client trouvé.</p>}
                    </div>
                  )}
                  <button onClick={() => { setShowNewClient(v => !v); setNewName(clientQuery && !/\d/.test(clientQuery) ? clientQuery : ""); }}
                    className="mt-2 text-sm text-indigo-600 font-medium hover:underline flex items-center">
                    <UserPlus className="h-4 w-4 mr-1" />Nouveau client
                  </button>
                  {showNewClient && (
                    <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                      {clientError && <p className="text-xs text-red-600">{clientError}</p>}
                      <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom complet" className="w-full border-gray-200 rounded-lg text-sm" />
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Phone className="h-4 w-4 text-gray-400" /></div>
                        <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Téléphone" type="tel" className="w-full pl-9 border-gray-200 rounded-lg text-sm" />
                      </div>
                      <label className="flex items-center text-xs text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={newHasCard} onChange={e => setNewHasCard(e.target.checked)} className="mr-2 rounded" />
                        Attribuer une carte de fidélité
                      </label>
                      <button onClick={handleCreateClient} disabled={creatingClient || !newName.trim() || !newPhone.trim()}
                        className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                        {creatingClient ? "Création..." : "Créer et sélectionner"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Lignes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[120px]">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 py-8">
                  <ShoppingCart className="h-10 w-10 mb-2 text-gray-300" />
                  <p className="text-sm">Cliquez une prestation ou un produit pour l'ajouter.</p>
                </div>
              ) : cart.map(l => (
                <div key={l.key} className={`rounded-xl border p-2.5 ${l.offered ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50"}`}>
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-gray-900 leading-tight pr-2">{l.name}</p>
                    <button onClick={() => removeLine(l.key)} className="text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setQty(l.key, -1)} className="h-7 w-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                      <button onClick={() => setQty(l.key, 1)} className="h-7 w-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <span className={`text-sm font-bold ${l.offered ? "text-amber-600 line-through" : "text-gray-900"}`}>{fmt(l.unitPrice * l.qty)} FCFA</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    {l.productId ? (
                      <span className="flex-1 text-xs text-gray-500 flex items-center"><Package className="h-3.5 w-3.5 mr-1 text-gray-400" />Produit — pas de prestataire</span>
                    ) : (
                      /* Employé qui réalise la prestation : alimente le classement
                         "employé du mois" du tableau de bord. Mis en évidence tant
                         qu'il n'est pas renseigné (non bloquant). */
                      <select value={l.employeeId} onChange={e => updateLine(l.key, { employeeId: e.target.value })}
                        title="Employé qui réalise la prestation"
                        className={`flex-1 text-xs rounded-lg py-1 ${l.employeeId ? "border-gray-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                        <option value="">Qui réalise ?</option>
                        {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    )}
                    <label className="flex items-center text-xs text-gray-600 whitespace-nowrap" title="Offrir cet article">
                      <input type="checkbox" checked={l.offered} onChange={e => updateLine(l.key, { offered: e.target.checked })} className="mr-1 rounded" />
                      <Gift className="h-3.5 w-3.5 mr-0.5" />Offert
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {/* Totaux + validation */}
            {cart.length > 0 && (
              <div className="p-4 border-t border-gray-100 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Réduction</label>
                    <div className="flex">
                      <input type="number" min="0" value={discountValue} onChange={e => setDiscountValue(e.target.value)} placeholder="0"
                        className="w-full text-sm border-gray-200 rounded-l-lg" />
                      <button type="button" onClick={() => setDiscountMode(m => m === "amount" ? "percent" : "amount")}
                        title="Basculer FCFA / %" className="px-2 border border-l-0 border-gray-200 rounded-r-lg bg-gray-50 text-xs font-semibold text-gray-600 flex items-center">
                        {discountMode === "percent" ? <Percent className="h-3.5 w-3.5" /> : "FCFA"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Pourboire (FCFA)</label>
                    <input type="number" min="0" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" className="w-full text-sm border-gray-200 rounded-lg" />
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-gray-600"><span>Sous-total ({itemCount} article{itemCount > 1 ? "s" : ""})</span><span>{fmt(subtotal)} FCFA</span></div>
                  {discountFcfa > 0 && <div className="flex justify-between text-red-600"><span>Réduction</span><span>−{fmt(discountFcfa)} FCFA</span></div>}
                  {offeredTotal > 0 && <div className="flex justify-between text-amber-600"><span>Offert</span><span>−{fmt(offeredTotal)} FCFA</span></div>}
                  {tipFcfa > 0 && <div className="flex justify-between text-gray-600"><span>Pourboire</span><span>+{fmt(tipFcfa)} FCFA</span></div>}
                  <div className="flex justify-between text-lg font-bold text-gray-900 pt-1 border-t border-gray-100"><span>Total à payer</span><span>{fmt(total)} FCFA</span></div>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}
                {!selectedClient && <p className="text-xs text-amber-600">Sélectionnez d'abord un client.</p>}
                {selectedClient && missingEmployee && <p className="text-xs text-amber-600">Sélectionnez l'employé sur chaque prestation (« Qui réalise ? ») avant de valider.</p>}
                <button onClick={() => setShowRecap(true)} disabled={!selectedClient || cart.length === 0 || missingEmployee}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center">
                  <Wallet className="h-5 w-5 mr-2" />Valider la vente
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Récapitulatif avant validation */}
      {showRecap && selectedClient && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowRecap(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Récapitulatif</h3>
              <button onClick={() => setShowRecap(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center bg-indigo-50 rounded-xl px-3 py-2">
                <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold mr-2">{selectedClient.name.charAt(0).toUpperCase()}</div>
                <div><p className="font-semibold text-gray-900 text-sm">{selectedClient.name}</p><p className="text-[11px] text-gray-500 font-mono">{selectedClient.code}</p></div>
              </div>
              <div className="space-y-1.5">
                {cart.map(l => (
                  <div key={l.key} className="flex justify-between text-sm">
                    <span className="text-gray-700">
                      {l.name} <span className="text-gray-400">×{l.qty}</span>{l.offered && <span className="ml-1 text-amber-600 text-xs font-medium">(offert)</span>}
                      {!l.productId && (
                        <span className="block text-[11px] text-gray-400">{employees.find((e: any) => String(e.id) === l.employeeId)?.name || "—"}</span>
                      )}
                    </span>
                    <span className={`font-medium ${l.offered ? "text-amber-600 line-through" : "text-gray-900"}`}>{fmt(l.unitPrice * l.qty)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-sm border-t border-gray-100 pt-3">
                <div className="flex justify-between text-gray-600"><span>Sous-total</span><span>{fmt(subtotal)} FCFA</span></div>
                {discountFcfa > 0 && <div className="flex justify-between text-red-600"><span>Réduction{discountMode === "percent" ? ` (${discountValue}%)` : ""}</span><span>−{fmt(discountFcfa)} FCFA</span></div>}
                {offeredTotal > 0 && <div className="flex justify-between text-amber-600"><span>Prestations offertes</span><span>−{fmt(offeredTotal)} FCFA</span></div>}
                {tipFcfa > 0 && <div className="flex justify-between text-gray-600"><span>Pourboire</span><span>+{fmt(tipFcfa)} FCFA</span></div>}
                <div className="flex justify-between text-xl font-bold text-gray-900 pt-1 border-t border-gray-100"><span>Total</span><span>{fmt(total)} FCFA</span></div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowRecap(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200">Modifier</button>
                <button onClick={handleValidate} disabled={saving || missingEmployee} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? "Enregistrement..." : "Confirmer la vente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
