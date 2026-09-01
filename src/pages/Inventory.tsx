import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import {
  getBusiness, getProducts, createProduct, updateProduct, deleteProduct, restockProduct, getProductMovements, getStockMovements,
  getServices, getServiceProducts, linkServiceProduct, unlinkServiceProduct,
  Product, ServiceProduct, StockMovement,
} from "../services/db";
import { Plus, Minus, Package, X, Trash2, Pencil, AlertTriangle, Boxes, Link2, History, ClipboardList } from "lucide-react";

const fmt = (n: number) => (n ?? 0).toLocaleString("fr-FR");
const unitsLeft = (p: Product) => Math.floor((p.stockUses || 0) / (p.usesPerUnit || 1));
const isLow = (p: Product) => (p.lowStockUses || 0) > 0 && (p.stockUses || 0) <= (p.lowStockUses || 0);

// Inventaire polyvalent : pas limité aux produits de salon (teintures, vernis...),
// fonctionne aussi pour des boissons, du matériel, tout consommable. La catégorie est
// libre pour rester adaptable, mais l'affichage regroupe/filtre par catégorie pour
// garder de la cohérence quand la liste grossit.
export default function Inventory() {
  const { user } = useAuth();
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [role, setRole] = useState("admin");
  const isAdmin = role === "admin";
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [links, setLinks] = useState<ServiceProduct[]>([]);
  const [activeCategory, setActiveCategory] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: "", category: "", unitLabel: "unité", usesPerUnit: "1", stockUnits: "0", lowStockUnits: "", price: "" });
  // Comment ce nouveau produit sort du stock : obligatoire à la création (pas à la
  // modification) pour qu'un produit ne puisse jamais rester "orphelin", jamais relié
  // à rien qui le décompte tout seul.
  const [linkMode, setLinkMode] = useState<"sale" | "service" | "">("");
  const [newLinkServiceId, setNewLinkServiceId] = useState("");
  const [newLinkUses, setNewLinkUses] = useState("1");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null); // produit dont on gère les liens
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  // Historique complet (admin) : traçabilité détaillée de tous les mouvements, tous
  // produits confondus — qui a fait quoi, quand, pourquoi.
  const [showGlobalHistory, setShowGlobalHistory] = useState(false);
  const [globalMovements, setGlobalMovements] = useState<StockMovement[]>([]);
  const [globalHistoryLoading, setGlobalHistoryLoading] = useState(false);

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    try {
      const rest = await getBusiness(user!.id);
      if (rest) {
        setBusinessId(rest.id);
        if (rest.role) setRole(rest.role);
        const [prods, svcs, lnks] = await Promise.all([
          getProducts(rest.id).catch(() => []), getServices(rest.id).catch(() => []), getServiceProducts(rest.id).catch(() => []),
        ]);
        setProducts(prods);
        setServices(svcs);
        setLinks(lnks);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const categories = useMemo(() => Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[], [products]);
  const filteredProducts = useMemo(
    () => activeCategory ? products.filter(p => p.category === activeCategory) : products,
    [products, activeCategory]
  );

  // Un produit est "relié" à une sortie de stock connue s'il a un prix (vente directe
  // à la caisse) ou au moins une prestation qui le consomme — sinon son stock ne
  // bougera jamais tout seul, et la personne qui gère l'inventaire "se perd".
  const isConnected = (p: Product) => (p.price || 0) > 0 || links.some(l => l.productId === p.id);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", category: activeCategory || "", unitLabel: "unité", usesPerUnit: "1", stockUnits: "0", lowStockUnits: "", price: "" });
    setLinkMode("");
    setNewLinkServiceId("");
    setNewLinkUses("1");
    setFormError("");
    setShowForm(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, category: p.category || "", unitLabel: p.unitLabel || "unité",
      usesPerUnit: String(p.usesPerUnit || 1),
      stockUnits: String(unitsLeft(p)),
      lowStockUnits: String(Math.floor((p.lowStockUses || 0) / (p.usesPerUnit || 1))),
      price: p.price ? String(Math.round(p.price / 100)) : "",
    });
    // Pas de choix imposé en modification : le produit peut déjà être relié (ou pas),
    // c'est le bandeau d'avertissement sur la fiche qui guide dans ce cas.
    setLinkMode("");
    setFormError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!businessId || saving || !form.name.trim()) return;
    // À la création (pas en modification), il faut avoir choisi comment ce produit
    // sort du stock — sinon impossible d'enregistrer un produit qui ne serait relié
    // à rien (ni vente directe, ni prestation).
    if (!editing) {
      if (!linkMode) { setFormError("Choisissez comment ce produit sort du stock (vente directe ou prestation) avant d'enregistrer."); return; }
      if (linkMode === "sale" && !(parseFloat(form.price) > 0)) { setFormError("Indiquez un prix de vente (vente directe à la caisse)."); return; }
      if (linkMode === "service" && !newLinkServiceId) { setFormError("Choisissez la prestation qui consomme ce produit."); return; }
    }
    setSaving(true);
    setFormError("");
    const upu = Math.max(1, parseInt(form.usesPerUnit) || 1);
    const stockUnits = parseInt(form.stockUnits) || 0;
    // Seuil d'alerte : si l'admin ne le renseigne pas, on le fixe par défaut à la
    // moitié du stock de départ (règle du salon : "stock bas" = plus de la moitié
    // du stock déjà consommé) — reste ajustable à tout moment en modification.
    const lowStockUnits = form.lowStockUnits.trim() ? parseInt(form.lowStockUnits) || 0 : Math.floor(stockUnits / 2);
    const payload: Partial<Product> = {
      name: form.name.trim(),
      category: form.category.trim() || undefined,
      unitLabel: form.unitLabel.trim() || "unité",
      usesPerUnit: upu,
      stockUses: stockUnits * upu,
      lowStockUses: lowStockUnits * upu,
      price: form.price.trim() ? Math.round(parseFloat(form.price) * 100) : undefined,
    };
    try {
      if (editing) {
        const updated = await updateProduct(editing.id, payload);
        setProducts(prev => prev.map(p => p.id === editing.id ? updated : p));
      } else {
        const created = await createProduct(businessId, payload);
        setProducts(prev => [...prev, created]);
        if (linkMode === "service" && newLinkServiceId) {
          const link = await linkServiceProduct(businessId, {
            serviceId: parseInt(newLinkServiceId), productId: created.id, usesPerPrestation: Math.max(1, parseInt(newLinkUses) || 1),
          });
          setLinks(prev => [...prev, link]);
        }
      }
      setShowForm(false);
    } catch (e) {
      setFormError((e as Error).message || "Échec de l'enregistrement.");
    } finally { setSaving(false); }
  };

  const handleRestock = async (p: Product, units: number) => {
    try {
      const updated = await restockProduct(p.id, units * (p.usesPerUnit || 1));
      setProducts(prev => prev.map(x => x.id === p.id ? updated : x));
      if (historyFor === p.id) loadMovements(p.id);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`Supprimer le produit "${p.name}" ? Ses liens avec les prestations seront aussi supprimés.`)) return;
    try {
      await deleteProduct(p.id);
      setProducts(prev => prev.filter(x => x.id !== p.id));
      setLinks(prev => prev.filter(l => l.productId !== p.id));
    } catch (e) { console.error(e); }
  };

  const loadMovements = async (productId: number) => {
    setMovementsLoading(true);
    try { setMovements(await getProductMovements(productId)); }
    catch { setMovements([]); }
    finally { setMovementsLoading(false); }
  };
  const loadGlobalHistory = async () => {
    if (!businessId) return;
    setGlobalHistoryLoading(true);
    try { setGlobalMovements(await getStockMovements(businessId)); }
    catch { setGlobalMovements([]); }
    finally { setGlobalHistoryLoading(false); }
  };
  const toggleGlobalHistory = () => {
    const next = !showGlobalHistory;
    setShowGlobalHistory(next);
    if (next) loadGlobalHistory();
  };

  const toggleHistory = (productId: number) => {
    if (historyFor === productId) { setHistoryFor(null); return; }
    setHistoryFor(productId);
    setExpanded(null);
    loadMovements(productId);
  };

  // --- Liens prestation <-> produit ---
  const [linkService, setLinkService] = useState("");
  const [linkUses, setLinkUses] = useState("1");
  const linksFor = (productId: number) => links.filter(l => l.productId === productId);
  const serviceName = (id: number) => services.find(s => s.id === id)?.name || `#${id}`;

  const handleAddLink = async (productId: number) => {
    if (!businessId || !linkService) return;
    try {
      const link = await linkServiceProduct(businessId, {
        serviceId: parseInt(linkService), productId, usesPerPrestation: Math.max(1, parseInt(linkUses) || 1),
      });
      setLinks(prev => [...prev.filter(l => !(l.serviceId === link.serviceId && l.productId === link.productId)), link]);
      setLinkService(""); setLinkUses("1");
    } catch (e) { console.error(e); }
  };
  const handleRemoveLink = async (linkId: number) => {
    try { await unlinkServiceProduct(linkId); setLinks(prev => prev.filter(l => l.id !== linkId)); }
    catch (e) { console.error(e); }
  };

  const lowCount = useMemo(() => products.filter(isLow).length, [products]);

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-6 flex flex-col sm:flex-row justify-between sm:items-end gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventaire</h1>
          <p className="text-sm text-gray-500 mt-1">
            Chaque produit est relié à sa sortie de stock : soit <strong>vendu directement à la Caisse</strong> (ex: une boisson — le stock se
            décompte tout seul à chaque vente ou cadeau), soit <strong>consommé par une prestation</strong> (ex: une teinture). Les boutons
            <strong> -1/-5</strong> ne servent qu'aux corrections manuelles (casse, produit périmé, erreur de comptage) — jamais à enregistrer une vente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={toggleGlobalHistory}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium shadow-sm border ${showGlobalHistory ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}>
              <ClipboardList className="h-4 w-4 mr-2" />Historique complet
            </button>
          )}
          <button onClick={openCreate} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium shadow-sm">
            <Plus className="h-4 w-4 mr-2" />Nouveau produit
          </button>
        </div>
      </div>

      {showGlobalHistory && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <span className="text-sm font-medium text-gray-900 flex items-center"><ClipboardList className="h-4 w-4 text-indigo-500 mr-2" />Historique complet de l'inventaire — tous produits confondus</span>
          </div>
          {globalHistoryLoading ? (
            <div className="p-8 text-center text-gray-400">Chargement...</div>
          ) : globalMovements.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Aucun mouvement enregistré pour le moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-6 py-3">Produit</th>
                    <th className="px-6 py-3">Opération</th>
                    <th className="px-6 py-3 text-right">Quantité</th>
                    <th className="px-6 py-3">Par</th>
                    <th className="px-6 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {globalMovements.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{m.productName}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{m.reason}</td>
                      <td className={`px-6 py-3 text-sm text-right font-semibold ${m.delta > 0 ? "text-green-600" : "text-red-500"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td>
                      <td className="px-6 py-3 text-xs text-gray-500">{m.createdByName || "—"}</td>
                      <td className="px-6 py-3 text-xs text-gray-400">{new Date(m.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          <button onClick={() => setActiveCategory("")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${activeCategory === "" ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
            Toutes
          </button>
          {categories.map(c => (
            <button key={c} onClick={() => setActiveCategory(c)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${activeCategory === c ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
              {c}
            </button>
          ))}
        </div>
      )}

      {lowCount > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center">
          <AlertTriangle className="h-4 w-4 mr-2 flex-shrink-0" />
          {lowCount} produit{lowCount > 1 ? "s" : ""} en stock bas — pensez à réapprovisionner.
        </div>
      )}

      {filteredProducts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <Boxes className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900">Aucun produit</h3>
          <p className="text-gray-500 mt-1">Ajoutez vos produits pour suivre les stocks et les lier aux prestations.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProducts.map(p => {
            const low = isLow(p);
            const remainder = (p.stockUses || 0) % (p.usesPerUnit || 1);
            return (
              <div key={p.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${low ? "border-amber-300" : "border-gray-100"}`}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Package className={`h-5 w-5 ${low ? "text-amber-500" : "text-indigo-500"}`} />
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      {p.category && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.category}</span>}
                      {p.price ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">En vente à la caisse · {fmt(Math.round(p.price / 100))} FCFA</span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-400">Interne (non vendu à la caisse)</span>
                      )}
                      {low && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium flex items-center"><AlertTriangle className="h-3 w-3 mr-1" />Stock bas</span>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Stock : <strong className={low ? "text-amber-700" : "text-gray-900"}>{unitsLeft(p)} {p.unitLabel}{unitsLeft(p) > 1 ? "s" : ""}</strong>
                      {remainder > 0 && <span className="text-gray-400"> + {remainder} util.</span>}
                      <span className="text-gray-400"> · {fmt(p.stockUses)} utilisations · 1 {p.unitLabel} = {p.usesPerUnit} util.</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button onClick={() => handleRestock(p, 1)} title={`+1 ${p.unitLabel} (réapprovisionnement)`} className="px-2.5 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100">+1</button>
                    <button onClick={() => handleRestock(p, 5)} title={`+5 ${p.unitLabel}s (réapprovisionnement)`} className="px-2.5 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100">+5</button>
                    <button onClick={() => handleRestock(p, -1)} disabled={unitsLeft(p) === 0} title={`-1 ${p.unitLabel} : correction manuelle (casse, périmé, erreur de comptage) — pas une vente`} className="px-2.5 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-40">-1</button>
                    <button onClick={() => handleRestock(p, -5)} disabled={unitsLeft(p) === 0} title={`-5 ${p.unitLabel}s : correction manuelle (casse, périmé, erreur de comptage) — pas une vente`} className="px-2.5 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-40">-5</button>
                    <button onClick={() => toggleHistory(p.id)} title="Historique des mouvements" className={`px-2.5 py-1.5 rounded-lg text-sm font-medium flex items-center ${historyFor === p.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      <History className="h-4 w-4" />
                    </button>
                    <button onClick={() => { setExpanded(expanded === p.id ? null : p.id); setHistoryFor(null); }} title="Prestations liées" className={`px-2.5 py-1.5 rounded-lg text-sm font-medium flex items-center ${expanded === p.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      <Link2 className="h-4 w-4 mr-1" />{linksFor(p.id).length}
                    </button>
                    <button onClick={() => openEdit(p)} title="Modifier" className="p-2 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
                    {isAdmin && <button onClick={() => handleDelete(p)} title="Supprimer" className="p-2 text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>

                {!isConnected(p) && (
                  <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <p className="text-xs text-amber-800 flex-1">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                      Ce produit n'est relié à aucune vente : son stock ne bougera jamais tout seul.
                    </p>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => openEdit(p)} className="text-xs font-medium px-2.5 py-1 bg-white border border-amber-200 rounded-lg text-amber-800 hover:bg-amber-100">Ajouter un prix</button>
                      <button onClick={() => { setExpanded(p.id); setHistoryFor(null); }} className="text-xs font-medium px-2.5 py-1 bg-white border border-amber-200 rounded-lg text-amber-800 hover:bg-amber-100">Lier une prestation</button>
                    </div>
                  </div>
                )}

                {historyFor === p.id && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-800 mb-2">Historique des mouvements</p>
                    {movementsLoading ? (
                      <p className="text-sm text-gray-400">Chargement...</p>
                    ) : movements.length === 0 ? (
                      <p className="text-sm text-gray-400">Aucun mouvement pour ce produit.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {movements.map(m => (
                          <div key={m.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm border border-gray-100">
                            <span className="text-gray-700">{m.reason}</span>
                            <span className="flex items-center gap-3">
                              <span className={`font-semibold ${m.delta > 0 ? "text-green-600" : "text-red-500"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</span>
                              <span className="text-xs text-gray-400">{new Date(m.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {expanded === p.id && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-800 mb-2">Prestations qui consomment ce produit</p>
                    {linksFor(p.id).length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">Aucune prestation liée. Liez une prestation ci-dessous : le stock se décomptera à chaque fois qu'elle est vendue.</p>
                    ) : (
                      <div className="space-y-1.5 mb-3">
                        {linksFor(p.id).map(l => (
                          <div key={l.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm border border-gray-100">
                            <span className="text-gray-800">{serviceName(l.serviceId)} <span className="text-gray-400">— {l.usesPerPrestation} util./prestation</span></span>
                            <button onClick={() => handleRemoveLink(l.id)} className="text-gray-300 hover:text-red-500"><X className="h-4 w-4" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select value={linkService} onChange={e => setLinkService(e.target.value)} className="flex-1 text-sm border-gray-200 rounded-lg">
                        <option value="">Choisir une prestation...</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" value={linkUses} onChange={e => setLinkUses(e.target.value)} title="Utilisations consommées par prestation" className="w-20 text-sm border-gray-200 rounded-lg" />
                        <span className="text-xs text-gray-500">util.</span>
                      </div>
                      <button onClick={() => handleAddLink(p.id)} disabled={!linkService} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">Lier</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Formulaire produit */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editing ? "Modifier le produit" : "Nouveau produit"}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-3">
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du produit</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Teinture noire, Coca-Cola, Gants..." className="w-full border-gray-200 rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                  <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Teinture, Boissons, Consommable..." list="inventory-categories" className="w-full border-gray-200 rounded-lg text-sm" />
                  <datalist id="inventory-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
                  <input value={form.unitLabel} onChange={e => setForm({ ...form, unitLabel: e.target.value })} placeholder="boîte, flacon, canette..." className="w-full border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Utilisations par {form.unitLabel || "unité"}</label>
                <input type="number" min="1" value={form.usesPerUnit} onChange={e => setForm({ ...form, usesPerUnit: e.target.value })} className="w-full border-gray-200 rounded-lg text-sm" />
                <p className="text-[11px] text-gray-400 mt-1">Ex : 1 boîte de teinture = 6 utilisations. Mettez 1 pour un produit qui se consomme entièrement à chaque fois (ex: une canette).</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock actuel ({form.unitLabel || "unité"}s)</label>
                  <input type="number" min="0" value={form.stockUnits} onChange={e => setForm({ ...form, stockUnits: e.target.value })} className="w-full border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Alerte sous ({form.unitLabel || "unité"}s)</label>
                  <input type="number" min="0" value={form.lowStockUnits} onChange={e => setForm({ ...form, lowStockUnits: e.target.value })}
                    placeholder={!editing ? `Auto : ${Math.floor((parseInt(form.stockUnits) || 0) / 2)} (moitié)` : undefined}
                    className="w-full border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              {editing ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix de vente à la caisse (FCFA, optionnel)</label>
                  <input type="number" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="Laisser vide si non vendu directement" className="w-full border-gray-200 rounded-lg text-sm" />
                  <p className="text-[11px] text-gray-400 mt-1">Renseigné = le produit apparaît à la Caisse pour une vente directe à l'unité (ex: une boisson), avec décompte automatique du stock. Vide = produit interne, utilisé seulement via une prestation liée (gérez le lien avec l'icône 🔗 sur sa fiche).</p>
                </div>
              ) : (
                <div className="border-t border-gray-100 pt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Comment ce produit sort-il du stock ? *</label>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button type="button" onClick={() => setLinkMode("sale")}
                      className={`p-3 rounded-xl border text-left text-sm ${linkMode === "sale" ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      <span className="font-semibold block">Vente directe</span>
                      <span className="text-[11px]">Ex: une boisson, vendue seule à la Caisse</span>
                    </button>
                    <button type="button" onClick={() => setLinkMode("service")}
                      className={`p-3 rounded-xl border text-left text-sm ${linkMode === "service" ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      <span className="font-semibold block">Utilisé pendant une prestation</span>
                      <span className="text-[11px]">Ex: une teinture, un vernis...</span>
                    </button>
                  </div>

                  {linkMode === "sale" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Prix de vente à la caisse (FCFA)</label>
                      <input type="number" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="Ex: 500" className="w-full border-gray-200 rounded-lg text-sm" />
                      <p className="text-[11px] text-gray-400 mt-1">Ce produit apparaîtra à la Caisse, prêt à être vendu à l'unité — le stock se décompte tout seul.</p>
                    </div>
                  )}
                  {linkMode === "service" && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select value={newLinkServiceId} onChange={e => setNewLinkServiceId(e.target.value)} className="flex-1 text-sm border-gray-200 rounded-lg">
                        <option value="">Choisir une prestation...</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" value={newLinkUses} onChange={e => setNewLinkUses(e.target.value)} title="Utilisations consommées par prestation" className="w-20 text-sm border-gray-200 rounded-lg" />
                        <span className="text-xs text-gray-500">util.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button onClick={handleSave} disabled={saving || !form.name.trim()} className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
                {saving ? "Enregistrement..." : editing ? "Enregistrer" : "Créer le produit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
