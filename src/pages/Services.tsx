import React, { useState, useEffect } from "react";
import Layout from "../components/Layout";
import { Plus, Search, Tag, Clock, X, Trash2, ChevronDown, ChevronUp, Layers, ShoppingBag, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getServices, createService, updateService, deleteService, getCategories, createCategory, deleteCategory, getVariants, createVariant, deleteVariant, Category, ServiceVariant } from "../services/db";

export default function Services() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [servicesList, setServicesList] = useState<any[]>([]);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [newCategory, setNewCategory] = useState("");
  const [search, setSearch] = useState("");

  const [variantsByService, setVariantsByService] = useState<Record<number, ServiceVariant[]>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [variantForm, setVariantForm] = useState({ name: '', price: '', duration: '' });

  const [formData, setFormData] = useState({
    name: '',
    category: '',
    price: '',
    duration: ''
  });

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      const rest = await getBusiness(user!.id);
      if (rest) {
        setBusinessId(rest.id);
        const [svcs, cats] = await Promise.all([getServices(rest.id), getCategories(rest.id)]);
        setServicesList(svcs);
        setCategoriesList(cats);
        // Load variants for all services in parallel
        const entries = await Promise.all(
          svcs.map(async (s: any) => [s.id, await getVariants(s.id).catch(() => [])] as const)
        );
        setVariantsByService(Object.fromEntries(entries));
      }
    } catch (error) {
      console.error("Error fetching services:", error);
    }
  };

  const handleAddVariant = async (e: React.FormEvent, serviceId: number) => {
    e.preventDefault();
    if (!variantForm.name.trim() || !variantForm.price) return;
    try {
      const v = await createVariant(serviceId, {
        name: variantForm.name.trim(),
        price: parseInt(variantForm.price) * 100,
        duration: variantForm.duration ? parseInt(variantForm.duration) : undefined,
      });
      setVariantsByService(prev => ({ ...prev, [serviceId]: [...(prev[serviceId] || []), v] }));
      setVariantForm({ name: '', price: '', duration: '' });
    } catch (error) { console.error(error); }
  };

  const handleDeleteVariant = async (serviceId: number, variantId: number) => {
    try {
      await deleteVariant(variantId);
      setVariantsByService(prev => ({ ...prev, [serviceId]: (prev[serviceId] || []).filter(v => v.id !== variantId) }));
    } catch (error) { console.error(error); }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !newCategory.trim()) return;
    try {
      const cat = await createCategory(businessId, newCategory.trim());
      setCategoriesList([...categoriesList, cat]);
      setNewCategory("");
    } catch (error) { console.error(error); }
  };

  const handleDeleteCategory = async (id: number) => {
    try { await deleteCategory(id); setCategoriesList(categoriesList.filter(c => c.id !== id)); } catch (error) { console.error(error); }
  };

  const filteredServices = servicesList.filter(s =>
    (!activeCategory || s.category === activeCategory) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: formData.name,
        category: formData.category,
        price: parseInt(formData.price) * 100, // store in cents
        duration: parseInt(formData.duration)
      };
      if (editingId) {
        const updated = await updateService(editingId, payload);
        setServicesList(servicesList.map(s => s.id === editingId ? updated : s));
      } else {
        const newSvc = await createService(businessId, payload);
        setServicesList([...servicesList, newSvc]);
      }
      setShowModal(false);
      setEditingId(null);
      setFormData({ name: '', category: categoriesList[0]?.name || '', price: '', duration: '' });
    } catch (error) {
      console.error("Error saving service:", error);
      setFormError((error as Error).message || "Échec de l'enregistrement de la prestation.");
    } finally { setSaving(false); }
  };

  const openEdit = (service: any) => {
    setEditingId(service.id);
    setFormData({ name: service.name, category: service.category || '', price: String(service.price / 100), duration: String(service.duration) });
    setFormError("");
    setShowModal(true);
  };

  const handleDeleteService = async (id: number) => {
    if (!confirm("Supprimer cette prestation et ses variantes ?")) return;
    try { await deleteService(id); setServicesList(servicesList.filter(s => s.id !== id)); } catch (e) { console.error(e); }
  };

  const handleSell = (serviceId: number) => {
    sessionStorage.setItem("fidely_pending_service", String(serviceId));
    navigate("/vente");
  };

  return (
    <Layout>
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Prestations</h1>
          <p className="text-sm text-gray-500 mt-1">Catalogue de vos services et tarifs</p>
        </div>
        <button
          onClick={() => { setEditingId(null); setFormData({ name: '', category: categoriesList[0]?.name || '', price: '', duration: '' }); setFormError(""); setShowModal(true); }}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium"
        >
          <Plus className="h-4 w-4 mr-2" /> Nouvelle Prestation
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar Categories */}
        <div className="w-full md:w-64 flex-shrink-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3 px-2">Catégories</h2>
            <nav className="space-y-1">
              <button onClick={() => setActiveCategory("")}
                className={`block w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeCategory === "" ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50"}`}>
                Toutes les prestations
              </button>
              {categoriesList.map((cat) => (
                <div key={cat.id} className="group flex items-center">
                  <button onClick={() => setActiveCategory(cat.name)}
                    className={`flex-1 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeCategory === cat.name ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50"}`}>
                    {cat.name}
                  </button>
                  <button onClick={() => handleDeleteCategory(cat.id)} title="Supprimer" className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 px-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </nav>
            <form onSubmit={handleAddCategory} className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
              <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Nouvelle catégorie"
                className="flex-1 min-w-0 text-sm border-gray-200 rounded-lg" />
              <button type="submit" className="px-2 bg-indigo-600 text-white rounded-lg"><Plus className="h-4 w-4" /></button>
            </form>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          <div className="mb-6 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm shadow-sm transition-shadow"
              placeholder="Rechercher une prestation..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredServices.length === 0 ? (
              <div className="col-span-full bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
                <p className="text-gray-500">Aucune prestation dans cette catégorie.</p>
              </div>
            ) : (
              filteredServices.map((service) => {
                const variants = variantsByService[service.id] || [];
                const isOpen = expandedId === service.id;
                return (
                  <div key={service.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-5">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="text-lg font-bold text-gray-900">{service.name}</h3>
                        <span className="text-lg font-bold text-gray-900 bg-gray-50 px-2 py-1 rounded-md">{service.price / 100} FCFA</span>
                      </div>
                      <div className="flex items-center text-sm text-gray-500 space-x-4 mt-3">
                        <div className="flex items-center"><Tag className="h-4 w-4 mr-1 text-gray-400" />{service.category}</div>
                        <div className="flex items-center"><Clock className="h-4 w-4 mr-1 text-gray-400" />{service.duration} min</div>
                      </div>
                      <div className="flex items-center justify-between mt-4">
                        <button
                          onClick={() => { setExpandedId(isOpen ? null : service.id); setVariantForm({ name: '', price: '', duration: '' }); }}
                          className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Layers className="h-4 w-4 mr-1.5" />
                          {variants.length > 0 ? `${variants.length} variante(s)` : "Ajouter des variantes"}
                          {isOpen ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
                        </button>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleSell(service.id)} title="Vendre cette prestation à un client" className="flex items-center px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100">
                            <ShoppingBag className="h-3.5 w-3.5 mr-1" /> Vendre
                          </button>
                          <button onClick={() => openEdit(service)} title="Modifier" className="p-1.5 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => handleDeleteService(service.id)} title="Supprimer" className="p-1.5 text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-gray-100 bg-gray-50 p-5">
                        {variants.length > 0 && (
                          <div className="space-y-2 mb-4">
                            {variants.map(v => (
                              <div key={v.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-100 px-3 py-2">
                                <div>
                                  <span className="text-sm font-medium text-gray-900">{v.name}</span>
                                  {v.duration ? <span className="text-xs text-gray-400 ml-2">{v.duration} min</span> : null}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-bold text-gray-900">{v.price / 100} FCFA</span>
                                  <button onClick={() => handleDeleteVariant(service.id, v.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <form onSubmit={(e) => handleAddVariant(e, service.id)} className="bg-white rounded-lg border border-gray-100 p-3">
                          <p className="text-xs font-semibold text-gray-700 mb-2">Ajouter une variante</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-1">Nom de la variante</label>
                              <input required value={variantForm.name} onChange={e => setVariantForm({ ...variantForm, name: e.target.value })}
                                placeholder="Ex: Homme, Enfant, Long..." className="w-full text-sm border-gray-200 rounded-lg" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-1">Prix (FCFA)</label>
                              <input required type="number" min="0" value={variantForm.price} onChange={e => setVariantForm({ ...variantForm, price: e.target.value })}
                                placeholder="Ex: 5000" className="w-full text-sm border-gray-200 rounded-lg" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-1">Durée (min) — optionnel</label>
                              <input type="number" min="1" value={variantForm.duration} onChange={e => setVariantForm({ ...variantForm, duration: e.target.value })}
                                placeholder="Ex: 30" className="w-full text-sm border-gray-200 rounded-lg" />
                            </div>
                          </div>
                          <button type="submit" className="mt-3 w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium flex items-center justify-center">
                            <Plus className="h-4 w-4 mr-1" /> Ajouter la variante
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editingId ? "Modifier la prestation" : "Nouvelle Prestation"}</h3>
              <button 
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateService} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm" role="alert">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                {categoriesList.length === 0 ? (
                  <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    Ajoutez d'abord une catégorie dans la colonne de gauche.
                  </p>
                ) : (
                  <select
                    required
                    value={formData.category}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                    className="w-full border-gray-300 rounded-lg shadow-sm"
                  >
                    <option value="">Sélectionner...</option>
                    {categoriesList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix (FCFA)</label>
                  <input type="number" required value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (min)</label>
                  <input type="number" required value={formData.duration} onChange={e => setFormData({...formData, duration: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm" />
                </div>
              </div>
              <div className="pt-4">
                <button type="submit" disabled={saving} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
                  {saving ? "..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
