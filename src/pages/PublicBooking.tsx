import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, User } from "lucide-react";
import {
  getPublicBusiness, getPublicCatalog, getPublicEmployees, getPublicSlots, createPublicAppointment,
  PublicCatalog, PublicService,
} from "../services/db";

const fmt = (n: number) => Math.round(n ?? 0).toLocaleString("fr-FR");
const todayStr = () => new Date().toISOString().split("T")[0];

// Page de réservation en ligne, publique (aucune connexion requise). Volontairement
// une seule page, un seul écran : choisir des prestations, un employé (optionnel),
// une date, un créneau, laisser ses coordonnées, valider. Le rendez-vous est créé en
// statut "en attente" — le salon le confirme depuis son Agenda habituel.
export default function PublicBooking() {
  const [businessName, setBusinessName] = useState("");
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [employees, setEmployees] = useState<{ id: number; name: string; role: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedServices, setSelectedServices] = useState<number[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{ date: string; time: string; endTime: string; services: string[]; employeeName: string } | null>(null);

  useEffect(() => {
    Promise.all([getPublicBusiness(), getPublicCatalog(), getPublicEmployees()])
      .then(([biz, cat, emps]) => { setBusinessName(biz.name); setCatalog(cat); setEmployees(emps); })
      .catch(() => setError("Page indisponible pour le moment."))
      .finally(() => setLoading(false));
  }, []);

  const servicesById = useMemo(() => new Map((catalog?.services || []).map(s => [s.id, s])), [catalog]);
  const totalDuration = useMemo(() => selectedServices.reduce((s, id) => s + (servicesById.get(id)?.duration || 30), 0), [selectedServices, servicesById]);
  const totalPrice = useMemo(() => selectedServices.reduce((s, id) => s + (servicesById.get(id)?.price || 0), 0), [selectedServices, servicesById]);

  const byCategory = useMemo(() => {
    const map = new Map<string, PublicService[]>();
    for (const s of catalog?.services || []) {
      const key = s.category || "Autres";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries());
  }, [catalog]);

  const toggleService = (id: number) => {
    setSelectedServices(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setTime(""); setSlots([]);
  };

  // Recharge les créneaux dès que la date, la durée totale ou l'employé changent.
  useEffect(() => {
    if (selectedServices.length === 0 || !date) { setSlots([]); return; }
    setSlotsLoading(true);
    setTime("");
    getPublicSlots(date, totalDuration, employeeId ? parseInt(employeeId) : undefined)
      .then(r => { setSlots(r.slots || []); setClosed(!!r.closed); })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [date, totalDuration, employeeId, selectedServices.length]);

  const canSubmit = selectedServices.length > 0 && time && name.trim() && phone.trim();

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await createPublicAppointment({
        serviceIds: selectedServices, employeeId: employeeId ? parseInt(employeeId) : undefined,
        date, time, name: name.trim(), phone: phone.trim(),
      });
      setConfirmation(res.summary);
    } catch (e) {
      setError((e as Error).message || "Échec de la réservation.");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;

  if (confirmation) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-5">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-1">Demande envoyée !</h1>
          <p className="text-gray-500 text-sm mb-5">Le salon va confirmer votre rendez-vous rapidement.</p>
          <div className="bg-gray-50 rounded-xl p-4 text-left text-sm space-y-1.5">
            <p><span className="text-gray-500">Date :</span> <strong>{new Date(confirmation.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</strong></p>
            <p><span className="text-gray-500">Heure :</span> <strong>{confirmation.time} - {confirmation.endTime}</strong></p>
            <p><span className="text-gray-500">Prestation(s) :</span> <strong>{confirmation.services.join(", ")}</strong></p>
            <p><span className="text-gray-500">Avec :</span> <strong>{confirmation.employeeName}</strong></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gray-950 px-6 py-10 text-center">
        <h1 className="text-2xl font-bold text-white">{businessName}</h1>
        <p className="text-gray-400 text-sm mt-1">Réservez votre rendez-vous en ligne</p>
      </div>

      <div className="max-w-lg mx-auto p-5 space-y-5 pb-28">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}

        {/* 1. Prestations */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-900 mb-3">1. Choisissez vos prestations</p>
          <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
            {byCategory.map(([cat, svcs]) => (
              <div key={cat}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{cat}</p>
                <div className="space-y-1.5">
                  {svcs.map(s => (
                    <label key={s.id} className={`flex items-center justify-between px-3 py-2 rounded-xl border cursor-pointer text-sm ${selectedServices.includes(s.id) ? "border-indigo-400 bg-indigo-50" : "border-gray-100"}`}>
                      <span className="flex items-center"><input type="checkbox" checked={selectedServices.includes(s.id)} onChange={() => toggleService(s.id)} className="mr-2 rounded" />{s.name}</span>
                      <span className="text-gray-500 whitespace-nowrap ml-2">{fmt(s.price)} FCFA</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {selectedServices.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm font-semibold text-gray-900">
              <span>Total ({selectedServices.length})</span><span>{fmt(totalPrice)} FCFA</span>
            </div>
          )}
        </div>

        {/* 2. Employé */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-900 mb-3">2. Avec qui ? <span className="font-normal text-gray-400">(facultatif)</span></p>
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full border-gray-200 rounded-xl text-sm">
            <option value="">Peu importe</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.role}</option>)}
          </select>
        </div>

        {/* 3. Date + créneau */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-900 mb-3">3. Quand ?</p>
          <input type="date" value={date} min={todayStr()} onChange={e => setDate(e.target.value)} className="w-full border-gray-200 rounded-xl text-sm mb-3" />
          {selectedServices.length === 0 ? (
            <p className="text-xs text-gray-400">Choisissez d'abord une prestation.</p>
          ) : slotsLoading ? (
            <p className="text-xs text-gray-400">Chargement des créneaux...</p>
          ) : closed ? (
            <p className="text-xs text-amber-600">Le salon est fermé ce jour-là.</p>
          ) : slots.length === 0 ? (
            <p className="text-xs text-amber-600">Plus de créneau disponible ce jour-là, essayez une autre date.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map(s => (
                <button key={s} onClick={() => setTime(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center ${time === s ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-700 hover:border-indigo-300"}`}>
                  <Clock className="h-3.5 w-3.5 mr-1" />{s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 4. Coordonnées */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-900 mb-3">4. Vos coordonnées</p>
          <div className="space-y-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom complet" className="w-full border-gray-200 rounded-xl text-sm" />
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Téléphone" type="tel" className="w-full border-gray-200 rounded-xl text-sm" />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4">
        <div className="max-w-lg mx-auto">
          <button onClick={handleSubmit} disabled={!canSubmit || saving}
            className="w-full py-3.5 bg-gray-950 text-white rounded-xl font-semibold hover:bg-gray-800 disabled:opacity-40 flex items-center justify-center">
            <User className="h-4 w-4 mr-2" />{saving ? "Envoi..." : "Confirmer la demande de rendez-vous"}
          </button>
        </div>
      </div>
    </div>
  );
}
