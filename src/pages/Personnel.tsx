import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getMembers, createMember, updateMemberRole, deleteMember, getEmployees, Member, Employee } from "../services/db";
import { Plus, X, Trash2, Shield, User, Lock, Mail } from "lucide-react";

export default function Personnel() {
  const { user } = useAuth();
  const [business, setBusiness] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "staff" as "admin" | "staff" | "employee", employeeId: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    try {
      const rest = await getBusiness(user!.id);
      setBusiness(rest);
      if (rest && rest.role === "admin") {
        setMembers(await getMembers(rest.id));
        setEmployees(await getEmployees(rest.id));
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");
    try {
      await createMember(business.id, {
        email: form.email, password: form.password, name: form.name, role: form.role,
        employeeId: form.role === "employee" && form.employeeId ? parseInt(form.employeeId) : undefined,
      });
      setShowModal(false);
      setForm({ email: "", password: "", name: "", role: "staff", employeeId: "" });
      setMembers(await getMembers(business.id));
    } catch (err) {
      setFormError((err as Error).message || "Échec de l'ajout.");
    } finally { setSaving(false); }
  };

  const handleRole = async (id: number, role: "admin" | "staff" | "employee", employeeId?: number) => {
    try { await updateMemberRole(id, role, employeeId); setMembers(await getMembers(business.id)); } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteMember(id); setMembers(await getMembers(business.id)); } catch (e) { console.error(e); }
  };

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  if (business && business.role !== "admin") {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-16 bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
          <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-900">Accès réservé</h2>
          <p className="text-gray-500 mt-1">La gestion du personnel est réservée aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Personnel & Accès</h1>
          <p className="text-sm text-gray-500 mt-1">Gérez qui peut se connecter et avec quels droits</p>
        </div>
        <button onClick={() => { setFormError(""); setShowModal(true); }}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium">
          <Plus className="h-4 w-4 mr-2" /> Inviter un membre
        </button>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6 text-sm text-indigo-800">
        <strong>Comment ça marche :</strong> créez un accès avec un e-mail + un mot de passe (l'e-mail n'a pas besoin d'exister vraiment) et choisissez le rôle.
        Le membre se connecte sur la page de connexion de Fidely avec ces identifiants et accède automatiquement à votre établissement.
        Les <strong>administrateurs</strong> ont accès à tout. Le <strong>staff</strong> peut vendre, gérer les clients, pointer et modifier la comptabilité, mais ne peut ni supprimer une écriture comptable, ni supprimer un employé, ni gérer ce personnel (cette page) ni consulter les Rapports.
        Le rôle <strong>employé</strong> est le plus restreint : accès uniquement à l'écran de pointage (arrivée/départ), rien d'autre.
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center">
          <Shield className="h-4 w-4 text-indigo-500 mr-2" />
          <span className="text-sm font-medium text-gray-900">Propriétaire (administrateur)</span>
          <span className="ml-auto text-sm text-gray-500">{user?.email}</span>
        </div>
        {members.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aucun membre invité pour le moment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-6 py-3">Membre</th>
                  <th className="px-6 py-3">Rôle</th>
                  <th className="px-6 py-3">Statut</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold mr-3">
                          {(m.name || m.email)[0].toUpperCase()}
                        </div>
                        <div>
                          {m.name && <p className="text-sm font-medium text-gray-900">{m.name}</p>}
                          <p className="text-xs text-gray-500">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <select value={m.role} onChange={e => handleRole(m.id, e.target.value as any, m.employeeId)}
                          className="text-sm border-gray-300 rounded-lg shadow-sm">
                          <option value="admin">Administrateur</option>
                          <option value="staff">Staff</option>
                          <option value="employee">Employé (pointage uniquement)</option>
                        </select>
                        {m.role === "employee" && (
                          <select value={m.employeeId || ""} onChange={e => handleRole(m.id, "employee", e.target.value ? parseInt(e.target.value) : undefined)}
                            title="Lié à quel employé du planning ?"
                            className={`text-sm rounded-lg shadow-sm ${m.employeeId ? "border-gray-300" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                            <option value="">Lié à qui ?</option>
                            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${m.uid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                        {m.uid ? "Connecté" : "En attente"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleDelete(m.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
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
              <h3 className="text-lg font-bold text-gray-900">Inviter un membre</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm">{formError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Mail className="h-5 w-5 text-gray-400" /></div>
                  <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm" placeholder="employe@exemple.com" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Lock className="h-5 w-5 text-gray-400" /></div>
                  <input type="text" required minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm" placeholder="Au moins 6 caractères" />
                </div>
                <p className="text-xs text-gray-400 mt-1">Le membre se connectera avec cet e-mail + ce mot de passe.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom (optionnel)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><User className="h-5 w-5 text-gray-400" /></div>
                  <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm" placeholder="Prénom Nom" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as any })} className="w-full border-gray-300 rounded-lg shadow-sm">
                  <option value="staff">Staff (accès limité)</option>
                  <option value="admin">Administrateur (accès complet)</option>
                  <option value="employee">Employé (pointage uniquement)</option>
                </select>
              </div>
              {form.role === "employee" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lié à quel employé du planning ?</label>
                  <select value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} className="w-full border-gray-300 rounded-lg shadow-sm">
                    <option value="">Choisir...</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Son écran de pointage sera automatiquement le sien, sans liste à choisir.</p>
                </div>
              )}
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? "Création..." : "Créer le membre"}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
