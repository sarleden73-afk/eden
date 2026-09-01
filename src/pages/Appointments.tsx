import React, { useState, useEffect } from "react";
import Layout from "../components/Layout";
import { Calendar as CalendarIcon, Clock, User, Scissors, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getAppointments, getEmployees, getCustomers, getServices, createAppointment } from "../services/db";

export default function Appointments() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [formError, setFormError] = useState("");
  const [appointments, setAppointments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [businessId, setBusinessId] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    customerId: '',
    employeeId: '',
    serviceId: '',
    startTime: '',
    endTime: ''
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
        const [apts, emps, custs, svcs] = await Promise.all([
          getAppointments(rest.id),
          getEmployees(rest.id),
          getCustomers(rest.id),
          getServices(rest.id)
        ]);
        setAppointments(apts);
        setEmployees(emps);
        setCustomers(custs);
        setServices(svcs);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const [saving, setSaving] = useState(false);
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const newApt = await createAppointment(businessId, {
        customerId: formData.customerId,
        employeeId: parseInt(formData.employeeId),
        serviceId: parseInt(formData.serviceId),
        startTime: formData.startTime,
        endTime: formData.endTime,
        status: 'scheduled'
      });
      setAppointments([...appointments, newApt]);
      setShowModal(false);
      setFormData({ customerId: '', employeeId: '', serviceId: '', startTime: '', endTime: '' });
    } catch (error) {
      console.error("Error creating appointment:", error);
      setFormError((error as Error).message || "Échec de la création du rendez-vous.");
    } finally { setSaving(false); }
  };

  const getCustomerName = (id: string) => {
    const c = customers.find(c => c.id === id);
    return c ? c.name : 'Inconnu';
  };

  const getEmployeeName = (id: number) => {
    const e = employees.find(e => e.id === id);
    return e ? e.name : 'Inconnu';
  };

  const getServiceName = (id: number) => {
    const s = services.find(s => s.id === id);
    return s ? s.name : 'Inconnu';
  };

  return (
    <Layout>
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Agenda</h1>
          <p className="text-sm text-gray-500 mt-1">Gérez vos rendez-vous et plannings</p>
        </div>
        <button
          onClick={() => { setFormError(""); setShowModal(true); }}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium"
        >
          Nouveau Rendez-vous
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Aujourd'hui</h2>
          <div className="flex space-x-2">
            <span className="px-3 py-1 bg-white border border-gray-200 text-gray-600 text-xs font-medium rounded-lg">Jour</span>
            <span className="px-3 py-1 bg-gray-100 text-gray-400 text-xs font-medium rounded-lg cursor-not-allowed">Semaine</span>
          </div>
        </div>
        
        <div className="divide-y divide-gray-50">
          {appointments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Aucun rendez-vous pour aujourd'hui.
            </div>
          ) : (
            appointments.map((apt, i) => (
              <div key={i} className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-start sm:items-center mb-4 sm:mb-0">
                  <div className="w-16 flex-shrink-0 text-center mr-4">
                    <p className="text-lg font-bold text-gray-900">{new Date(apt.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                  </div>
                  <div className="h-10 w-1 bg-indigo-100 rounded-full mr-4 hidden sm:block"></div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 flex items-center">
                      <User className="h-4 w-4 mr-1 text-gray-400" /> {getCustomerName(apt.customerId)}
                    </h3>
                    <div className="flex items-center text-sm text-gray-500 mt-1">
                      <Scissors className="h-3 w-3 mr-1" /> {getServiceName(apt.serviceId)}
                      <span className="mx-2">•</span>
                      <Clock className="h-3 w-3 mr-1" /> par {getEmployeeName(apt.employeeId)}
                    </div>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  apt.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                  apt.status === 'in_progress' ? 'bg-indigo-50 text-indigo-700' :
                  apt.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                }`}>
                  {apt.status === 'scheduled' ? 'À venir' : apt.status === 'pending' ? 'Demande en ligne — à confirmer' : apt.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Nouveau Rendez-vous</h3>
              <button 
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateAppointment} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm" role="alert">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                <select required value={formData.customerId} onChange={e => setFormData({...formData, customerId: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm">
                  <option value="">Sélectionner un client...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employé</label>
                <select required value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm">
                  <option value="">Sélectionner un employé...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prestation</label>
                <select required value={formData.serviceId} onChange={e => setFormData({...formData, serviceId: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm">
                  <option value="">Sélectionner une prestation...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.price / 100} FCFA)</option>)}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Début</label>
                  <input type="datetime-local" required value={formData.startTime} onChange={e => setFormData({...formData, startTime: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fin</label>
                  <input type="datetime-local" required value={formData.endTime} onChange={e => setFormData({...formData, endTime: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm" />
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
