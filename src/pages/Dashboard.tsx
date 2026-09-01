import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, createBusiness, getPrograms, getCustomers, getEmployees, getAppointments, getSalesSummary, getProducts, SalesSummary, Product } from "../services/db";
import Layout from "../components/Layout";
import StatCard from "../components/StatCard";
import { Users, CreditCard, Award, TrendingUp, Store, Clock, CalendarCheck, Package, Plus, ShoppingBag, AlertTriangle } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

// Bornes de la période sélectionnée (pour la synthèse des ventes).
function rangeFor(period: string, ref: string): { from?: string; to?: string } {
  const d = new Date(ref); d.setHours(0, 0, 0, 0);
  let start = new Date(d), end = new Date(d);
  if (period === "Jour") {
    end.setHours(23, 59, 59, 999);
  } else if (period === "Semaine") {
    start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
  } else if (period === "Mois") {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    start = new Date(d.getFullYear(), 0, 1);
    end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const fmtCA = (n: number) => Math.round(n ?? 0).toLocaleString("fr-FR");

function buildClientsData(customers: any[]) {
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const end = new Date();
    end.setDate(end.getDate() - (3 - i) * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { name: `S${i + 1}`, start, end };
  });
  return weeks.map(({ name, start, end }) => {
    const inWeek = customers.filter((c: any) => {
      const created = new Date(c.createdAt);
      return created >= start && created <= end;
    });
    const nouveaux = inWeek.length;
    const fideles = inWeek.filter((c: any) => c.visits > 0).length;
    return { name, nouveaux: nouveaux - fideles > 0 ? nouveaux - fideles : nouveaux, fideles };
  });
}

export default function Dashboard() {
  const { user } = useAuth();
  const [business, setBusiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    customers: 0,
    visits: 0,
    rewards: 0,
    programs: 0,
    employees: 0,
  });
  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [appointmentsData, setAppointmentsData] = useState<any[]>([]);
  const [period, setPeriod] = useState("Jour"); // Jour, Semaine, Mois, Année
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [newBusinessName, setNewBusinessName] = useState("");
  const [filteredAppointments, setFilteredAppointments] = useState<any[]>([]);
  const [dataSales, setDataSales] = useState<{ name: string; total: number }[]>([]);
  const [dataClients, setDataClients] = useState<{ name: string; nouveaux: number; fideles: number }[]>([]);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  // Synthèse des ventes de la période sélectionnée (source unique = ventes en caisse).
  useEffect(() => {
    if (!business) return;
    const { from, to } = rangeFor(period, selectedDate);
    getSalesSummary(business.id, from, to).then(sum => {
      setSales(sum);
      setDataSales((sum.series || []).map(p => ({
        name: new Date(p.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        total: p.total,
      })));
    }).catch(() => { setSales(null); setDataSales([]); });
  }, [business, period, selectedDate]);

  useEffect(() => {
    // Filter appointments based on period and selectedDate
    if (appointmentsData.length > 0) {
      const selected = new Date(selectedDate);
      let filtered = appointmentsData;
      
      if (period === 'Jour') {
        filtered = appointmentsData.filter(a => new Date(a.startTime).toDateString() === selected.toDateString());
      } else if (period === 'Semaine') {
        const startOfWeek = new Date(selected);
        startOfWeek.setDate(selected.getDate() - selected.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        filtered = appointmentsData.filter(a => {
          const d = new Date(a.startTime);
          return d >= startOfWeek && d <= endOfWeek;
        });
      } else if (period === 'Mois') {
        filtered = appointmentsData.filter(a => {
          const d = new Date(a.startTime);
          return d.getMonth() === selected.getMonth() && d.getFullYear() === selected.getFullYear();
        });
      } else if (period === 'Année') {
        filtered = appointmentsData.filter(a => new Date(a.startTime).getFullYear() === selected.getFullYear());
      }
      
      setFilteredAppointments(filtered);
    } else {
      setFilteredAppointments([]);
    }
  }, [appointmentsData, period, selectedDate]);

  const fetchData = async () => {
    try {
      const rest = await getBusiness(user!.id);
      setBusiness(rest);
      if (rest) {
        const programs = await getPrograms(rest.id);
        const customers = await getCustomers(rest.id);
        const employees = await getEmployees(rest.id);
        const appointments = await getAppointments(rest.id);
        const products = await getProducts(rest.id).catch(() => []);

        setEmployeesData(employees);
        setAppointmentsData(appointments);
        setDataClients(buildClientsData(customers));
        // Stock bas : produit dont il reste la moitié (ou moins) du seuil d'alerte fixé.
        // Affiché bien en évidence dès l'entrée dans l'application (pas seulement dans
        // l'Inventaire) pour ne jamais découvrir une rupture trop tard.
        setLowStockProducts((products || []).filter((p: Product) => (p.lowStockUses || 0) > 0 && p.stockUses <= p.lowStockUses));

        setStats({
          customers: customers.length,
          visits: customers.reduce((acc: number, curr: any) => acc + (curr.visits || 0), 0),
          rewards: customers.filter((c: any) => c.rewardStatus === "available").length,
          programs: programs.length,
          employees: employees.length,
        });
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBusinessName.trim()) return;
    try {
      await createBusiness(user!.id, newBusinessName);
      await fetchData();
    } catch (error) {
      console.error("Error creating business:", error);
    }
  };

  if (loading) return <div className="flex justify-center items-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div></div>;

  if (!business) {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-10 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-center mb-6">
            <Store className="h-12 w-12 text-indigo-500" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-center text-gray-900 tracking-tight">Bienvenue sur Fidely</h2>
          <p className="mb-8 text-center text-gray-500">Pour commencer, veuillez configurer votre établissement.</p>
          <form onSubmit={handleCreateBusiness} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-gray-900 mb-2">Nom de votre établissement</label>
              <input
                type="text"
                id="name"
                value={newBusinessName}
                onChange={(e) => setNewBusinessName(e.target.value)}
                className="block w-full rounded-xl border-gray-200 bg-gray-50 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:bg-white transition-colors sm:text-sm p-4 border"
                placeholder="Ex: Ma Boutique, Mon Salon, Mon Cabinet, Mon Restaurant..."
                required
              />
            </div>
            <button
              type="submit"
              className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-gray-950 bg-indigo-500 hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              Créer mon établissement
            </button>
          </form>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-gray-500 mt-1">Aperçu des performances pour <span className="font-semibold text-gray-900">{business.name}</span></p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            {['Jour', 'Semaine', 'Mois', 'Année'].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  period === p ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {p}
              </button>
            ))}
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded text-gray-500" 
            />
          </div>
          <Link to="/appointments" className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium">
            <Plus className="h-4 w-4 mr-2" /> Nouveau Rendez-vous
          </Link>
        </div>
      </div>

      {lowStockProducts.length > 0 && (
        <Link to="/inventory" className="mb-6 flex items-start sm:items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-300 hover:bg-amber-100 transition-colors block">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {lowStockProducts.length} produit{lowStockProducts.length > 1 ? "s" : ""} en stock bas — pensez à réapprovisionner
            </p>
            <p className="text-xs text-amber-700 mt-0.5 truncate">
              {lowStockProducts.map(p => p.name).join(", ")}
            </p>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {/* Clients */}
        <Link to="/customers" className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer">
          <div className="flex items-center justify-between mb-4">
            <div className="h-11 w-11 bg-indigo-50 rounded-xl flex items-center justify-center">
              <Users className="h-5 w-5 text-indigo-600" />
            </div>
            <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">Programme</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 tracking-tight">{stats.customers}</p>
          <p className="text-sm font-medium text-gray-500 mt-1">Clients fidèles</p>
        </Link>

        {/* Visites de la période — même période que le chiffre d'affaires, pour rester cohérent */}
        <Link to="/accounting" className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md hover:border-green-200 transition-all cursor-pointer">
          <div className="flex items-center justify-between mb-4">
            <div className="h-11 w-11 bg-green-50 rounded-xl flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full capitalize">{period}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 tracking-tight">{sales?.tickets || 0}</p>
          <p className="text-sm font-medium text-gray-500 mt-1">Visites sur la période</p>
        </Link>

        {/* Chiffre d'affaires de la période */}
        <Link to="/accounting" className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md hover:border-amber-200 transition-all cursor-pointer">
          <div className="flex items-center justify-between mb-4">
            <div className="h-11 w-11 bg-amber-50 rounded-xl flex items-center justify-center">
              <ShoppingBag className="h-5 w-5 text-amber-600" />
            </div>
            <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-full capitalize">{period}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 tracking-tight">{fmtCA(sales?.collected || 0)} <span className="text-base font-semibold text-gray-400">FCFA</span></p>
          <p className="text-sm font-medium text-gray-500 mt-1">
            {sales?.prestations || 0} prestation{(sales?.prestations || 0) > 1 ? "s" : ""} · {sales?.tickets || 0} vente{(sales?.tickets || 0) > 1 ? "s" : ""}
          </p>
        </Link>

        {/* Récompenses à remettre (carte mise en avant) */}
        <Link to="/customers" className="rounded-2xl p-6 shadow-sm bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 text-white relative overflow-hidden hover:shadow-md hover:border-[#d4af37]/40 transition-all cursor-pointer block">
          <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-[#d4af37]/10"></div>
          <div className="flex items-center justify-between mb-4 relative">
            <div className="h-11 w-11 bg-[#d4af37]/15 rounded-xl flex items-center justify-center">
              <Award className="h-5 w-5 text-[#d4af37]" />
            </div>
            {stats.rewards > 0 && (
              <span className="text-[11px] font-semibold text-gray-900 bg-[#d4af37] px-2 py-1 rounded-full animate-pulse">À remettre</span>
            )}
          </div>
          <p className="text-3xl font-bold tracking-tight relative">{stats.rewards}</p>
          <p className="text-sm font-medium text-gray-400 mt-1 relative">Récompenses débloquées</p>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Évolution CA */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">Évolution des ventes</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dataSales} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d4af37" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#d4af37" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a3a3a3', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#a3a3a3', fontSize: 12}} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="total" stroke="#d4af37" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Évolution Clients */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">Évolution de la clientèle</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataClients} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a3a3a3', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#a3a3a3', fontSize: 12}} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} cursor={{fill: '#f9fafb'}} />
                <Bar dataKey="fideles" name="Clients fidèles" stackId="a" fill="#1c1917" radius={[0, 0, 4, 4]} />
                <Bar dataKey="nouveaux" name="Nouveaux clients" stackId="a" fill="#d4af37" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">Prochains Rendez-vous</h3>
            <Link to="/appointments" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Voir tout</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {filteredAppointments.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">Aucun rendez-vous pour cette période.</div>
            ) : (
              filteredAppointments
                .slice()
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .slice(0, 5)
                .map((apt, i) => (
                  <div key={i} className="px-6 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {new Date(apt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      apt.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                      apt.status === 'in_progress' ? 'bg-indigo-50 text-indigo-700' : 'bg-green-50 text-green-700'
                    }`}>
                      {apt.status === 'scheduled' ? 'À venir' : apt.status}
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">Employé du mois</h3>
            <span className="text-xs text-gray-500 font-medium px-2 py-1 bg-gray-100 rounded-md capitalize">Prestations · {period}</span>
          </div>
          <div className="p-6 flex-1 flex flex-col justify-center">
            {(sales?.topEmployees?.length || 0) > 0 ? (
              <div className="space-y-4">
                {sales!.topEmployees.slice(0, 5).map((emp, i) => (
                  <div key={emp.employeeId} className="flex items-center justify-between">
                    <div className="flex items-center min-w-0">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs mr-3 ${i === 0 ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>
                        {emp.name.charAt(0).toUpperCase()}
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {i === 0 && <span className="mr-1">🏆</span>}{emp.name}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-sm font-bold text-gray-900">{emp.count} prestation{emp.count > 1 ? "s" : ""}</p>
                      <p className="text-[11px] text-gray-400">{fmtCA(emp.amount)} FCFA</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-500 text-sm">
                Aucune prestation attribuée sur cette période.<br />
                <span className="text-gray-400 text-xs">Assignez l'employé à chaque prestation dans la caisse.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
