import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  getBusiness, getLoyaltySettings, updateLoyaltySettings, getRewards, createReward, deleteReward,
  getTiers, createTier, deleteTier, LoyaltyMode, Reward, Tier,
} from "../services/db";
import Layout from "../components/Layout";
import { Plus, Trash2, Gift, Award, X } from "lucide-react";

const MODES: { key: LoyaltyMode; label: string; desc: string }[] = [
  { key: "visits", label: "Par visites", desc: "Ex: 10 visites = récompense" },
  { key: "points", label: "Par points", desc: "Chaque prestation rapporte des points" },
  { key: "stamps", label: "Par tampons", desc: "Chaque visite ajoute un tampon" },
];

const REWARD_TYPES: { key: Reward["type"]; label: string }[] = [
  { key: "discount_amount", label: "Réduction (montant FCFA)" },
  { key: "discount_percent", label: "Réduction (%)" },
  { key: "free_service", label: "Prestation gratuite" },
  { key: "product", label: "Produit offert" },
  { key: "custom", label: "Autre / personnalisé" },
];

export default function Programs() {
  const { user } = useAuth();
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [mode, setMode] = useState<LoyaltyMode>("visits");
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  const [showRewardModal, setShowRewardModal] = useState(false);
  const [rewardForm, setRewardForm] = useState({ label: "", threshold: "", type: "custom" as Reward["type"], value: "" });
  const [rewardError, setRewardError] = useState("");
  const [savingReward, setSavingReward] = useState(false);

  const [showTierModal, setShowTierModal] = useState(false);
  const [tierForm, setTierForm] = useState({ name: "", threshold: "", perks: "", windowDays: "" });
  const [tierError, setTierError] = useState("");
  const [savingTier, setSavingTier] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    try {
      const rest = await getBusiness(user!.id);
      if (rest) {
        setBusinessId(rest.id);
        const [loyalty, r, t] = await Promise.all([
          getLoyaltySettings(rest.id).catch(() => ({ mode: "visits" as LoyaltyMode })),
          getRewards(rest.id), getTiers(rest.id),
        ]);
        setMode(loyalty.mode);
        setRewards(r);
        setTiers(t);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleModeChange = async (m: LoyaltyMode) => {
    if (!businessId || savingMode) return;
    setSavingMode(true);
    try { await updateLoyaltySettings(businessId, m); setMode(m); } catch (e) { console.error(e); } finally { setSavingMode(false); }
  };

  const handleAddReward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || savingReward) return;
    setSavingReward(true);
    setRewardError("");
    try {
      const r = await createReward(businessId, {
        label: rewardForm.label, threshold: parseInt(rewardForm.threshold), type: rewardForm.type, value: rewardForm.value || undefined,
      });
      setRewards([...rewards, r].sort((a, b) => a.threshold - b.threshold));
      setShowRewardModal(false);
      setRewardForm({ label: "", threshold: "", type: "custom", value: "" });
    } catch (err) { setRewardError((err as Error).message || "Échec de l'ajout."); } finally { setSavingReward(false); }
  };

  const handleDeleteReward = async (id: number) => {
    try { await deleteReward(id); setRewards(rewards.filter(r => r.id !== id)); } catch (e) { console.error(e); }
  };

  const handleAddTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || savingTier) return;
    setSavingTier(true);
    setTierError("");
    try {
      const t = await createTier(businessId, {
        name: tierForm.name, threshold: parseInt(tierForm.threshold), perks: tierForm.perks || undefined,
        windowDays: tierForm.windowDays ? parseInt(tierForm.windowDays) : undefined,
      });
      setTiers([...tiers, t].sort((a, b) => a.threshold - b.threshold));
      setShowTierModal(false);
      setTierForm({ name: "", threshold: "", perks: "", windowDays: "" });
    } catch (err) { setTierError((err as Error).message || "Échec de l'ajout."); } finally { setSavingTier(false); }
  };

  const handleDeleteTier = async (id: number) => {
    try { await deleteTier(id); setTiers(tiers.filter(t => t.id !== id)); } catch (e) { console.error(e); }
  };

  const unit = mode === "points" ? "points" : mode === "stamps" ? "tampons" : "visites";

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Programme de fidélité</h1>
        <p className="text-sm text-gray-500 mt-1">Configurez le mode, les récompenses et les niveaux</p>
      </div>

      {/* Mode selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Mode de fidélité</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MODES.map(m => (
            <button key={m.key} onClick={() => handleModeChange(m.key)} disabled={savingMode}
              className={`text-left p-4 rounded-xl border-2 transition-colors ${mode === m.key ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-gray-300"}`}>
              <p className="font-semibold text-gray-900">{m.label}</p>
              <p className="text-xs text-gray-500 mt-1">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Rewards */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-6">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center"><Gift className="h-4 w-4 mr-2 text-indigo-500" />Récompenses</h2>
          <button onClick={() => { setRewardError(""); setShowRewardModal(true); }} className="flex items-center px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"><Plus className="h-4 w-4 mr-1" />Ajouter</button>
        </div>
        {rewards.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aucune récompense configurée. Créez-en une pour activer le déblocage automatique.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rewards.map(r => (
              <div key={r.id} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{r.label}</p>
                  <p className="text-xs text-gray-500">À partir de <strong>{r.threshold}</strong> {unit}{r.value ? ` · ${r.value}` : ""}</p>
                </div>
                <button onClick={() => handleDeleteReward(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tiers */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center"><Award className="h-4 w-4 mr-2 text-indigo-500" />Niveaux de fidélité</h2>
          <button onClick={() => { setTierError(""); setShowTierModal(true); }} className="flex items-center px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"><Plus className="h-4 w-4 mr-1" />Ajouter</button>
        </div>
        {tiers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aucun niveau configuré (ex: Bronze, Silver, Gold...).</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {tiers.map(t => (
              <div key={t.id} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-500">
                    À partir de <strong>{t.threshold}</strong> {unit}{t.windowDays ? ` en ${t.windowDays} jours` : ""}{t.perks ? ` · ${t.perks}` : ""}
                  </p>
                </div>
                <button onClick={() => handleDeleteTier(t.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRewardModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Nouvelle récompense</h3>
              <button onClick={() => setShowRewardModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleAddReward} className="p-6 space-y-4">
              {rewardError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm">{rewardError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom de la récompense</label>
                <input required value={rewardForm.label} onChange={e => setRewardForm({ ...rewardForm, label: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: 5 000 FCFA de réduction" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seuil requis ({unit})</label>
                <input required type="number" min="1" value={rewardForm.threshold} onChange={e => setRewardForm({ ...rewardForm, threshold: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: 100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={rewardForm.type} onChange={e => setRewardForm({ ...rewardForm, type: e.target.value as Reward["type"] })} className="w-full border-gray-300 rounded-lg shadow-sm">
                  {REWARD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Détail (optionnel)</label>
                <input value={rewardForm.value} onChange={e => setRewardForm({ ...rewardForm, value: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: Pédicure offerte" />
              </div>
              <button type="submit" disabled={savingReward} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">{savingReward ? "..." : "Créer la récompense"}</button>
            </form>
          </div>
        </div>
      )}

      {showTierModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Nouveau niveau</h3>
              <button onClick={() => setShowTierModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleAddTier} className="p-6 space-y-4">
              {tierError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm">{tierError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du niveau</label>
                <input required value={tierForm.name} onChange={e => setTierForm({ ...tierForm, name: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: Gold" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seuil requis ({unit})</label>
                <input required type="number" min="0" value={tierForm.threshold} onChange={e => setTierForm({ ...tierForm, threshold: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: 4" />
              </div>
              {mode === "visits" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Délai (optionnel) — en jours</label>
                  <input type="number" min="1" value={tierForm.windowDays} onChange={e => setTierForm({ ...tierForm, windowDays: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: 60 = ces visites doivent être faites en 60 jours" />
                  <p className="text-xs text-gray-400 mt-1">Laissez vide pour un cumul sans limite de temps.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Avantages (optionnel)</label>
                <input value={tierForm.perks} onChange={e => setTierForm({ ...tierForm, perks: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm" placeholder="Ex: -10% de réduction permanente" />
              </div>
              <button type="submit" disabled={savingTier} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">{savingTier ? "..." : "Créer le niveau"}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
