import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getCategories, createCategory, deleteCategory, getServices, Category } from "../services/db";
import { Plus, Trash2, Tag, Scissors, X } from "lucide-react";
import { Link } from "react-router-dom";

export default function Categories() {
  const { user } = useAuth();
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formError, setFormError] = useState("");
  const [name, setName] = useState("");

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    try {
      const rest = await getBusiness(user!.id);
      if (rest) {
        setBusinessId(rest.id);
        const [cats, svcs] = await Promise.all([getCategories(rest.id), getServices(rest.id)]);
        setCategories(cats);
        setServices(svcs);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const [saving, setSaving] = useState(false);
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !name.trim() || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const cat = await createCategory(businessId, name.trim());
      setCategories([...categories, cat]);
      setName("");
      setShowModal(false);
    } catch (err) {
      setFormError((err as Error).message || "Échec de la création.");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteCategory(id); setCategories(categories.filter(c => c.id !== id)); } catch (e) { console.error(e); }
  };

  const countServices = (catName: string) => services.filter(s => s.category === catName).length;

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Catégories</h1>
          <p className="text-sm text-gray-500 mt-1">Organisez vos prestations par catégorie</p>
        </div>
        <button onClick={() => { setFormError(""); setShowModal(true); }}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium">
          <Plus className="h-4 w-4 mr-2" /> Nouvelle catégorie
        </button>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6 text-sm text-indigo-800">
        Créez d'abord vos catégories ici. Ensuite, dans <Link to="/services" className="font-semibold underline">Prestations</Link>,
        chaque prestation devra être rattachée à une catégorie, et pourra avoir ses propres variantes.
      </div>

      {categories.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <Tag className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Aucune catégorie</h3>
          <p className="text-gray-500 mt-1">Créez votre première catégorie pour commencer.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map(cat => (
            <div key={cat.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-between group">
              <div className="flex items-center">
                <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center mr-3">
                  <Tag className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{cat.name}</p>
                  <p className="text-xs text-gray-500 flex items-center mt-0.5">
                    <Scissors className="h-3 w-3 mr-1" /> {countServices(cat.name)} prestation(s)
                  </p>
                </div>
              </div>
              <button onClick={() => handleDelete(cat.id)} title="Supprimer"
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Nouvelle catégorie</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm">{formError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom de la catégorie</label>
                <input type="text" required autoFocus value={name} onChange={e => setName(e.target.value)}
                  className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: Coiffure, Réparation, Consultation..." />
              </div>
              <button type="submit" disabled={saving} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? "..." : "Créer la catégorie"}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
