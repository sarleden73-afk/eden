import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getCustomer, getVisits, Customer, Visit } from "../services/db";
import QRCodeDisplay from "../components/QRCodeDisplay";
import { CreditCard, CheckCircle, Gift, Calendar, Star, Award } from "lucide-react";

const unitLabel = (mode?: string) => mode === "points" ? "points" : mode === "stamps" ? "tampons" : "visites";
const progressValue = (c: Customer) => c.progress ?? (c.loyaltyMode === "points" ? c.points : c.loyaltyMode === "stamps" ? c.stamps : c.visits) ?? 0;

export default function CustomerView() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id) fetchData(id);
  }, [id]);

  const fetchData = async (customerId: string) => {
    try {
      const cust = await getCustomer(customerId);
      if (cust) {
        setCustomer(cust);
        const visitsData = await getVisits(customerId);
        visitsData.sort((a: Visit, b: Visit) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setVisits(visitsData);
      } else {
        setError("Carte introuvable.");
      }
    } catch (err) {
      setError("Échec du chargement de la carte.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>;
  if (error || !customer) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-red-600 font-medium">{error || "Carte introuvable"}</div>;

  const progress = progressValue(customer);
  const unit = unitLabel(customer.loyaltyMode);
  const hasRewards = (customer.unlockedRewards?.length || 0) > 0;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-gray-100">
        <div className="bg-indigo-600 p-8 text-center relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-32 h-32 bg-indigo-500 rounded-full opacity-50"></div>
          <div className="absolute -left-10 -bottom-10 w-24 h-24 bg-indigo-500 rounded-full opacity-50"></div>

          <CreditCard className="h-14 w-14 text-white mx-auto mb-3 relative z-10" />
          <h1 className="text-2xl font-bold text-white relative z-10">Carte FIDELY</h1>
          <p className="text-indigo-100 mt-1 font-medium relative z-10 text-lg">{customer.name}</p>
          {customer.code && <p className="text-indigo-200 text-xs font-mono mt-1 relative z-10">{customer.code}</p>}
        </div>

        <div className="p-8 flex flex-col items-center">
          {/* Le QR encode le lien complet de la carte : n'importe quel appareil photo
              (pas seulement le scanner du salon) peut l'ouvrir après partage WhatsApp/Facebook. */}
          <QRCodeDisplay value={`${window.location.origin}/card/${customer.id}`} size={220} />
          {customer.cardNumber && (
            <p className="mt-3 text-sm font-mono font-bold text-gray-700 tracking-widest">N° {customer.cardNumber}</p>
          )}

          <div className="mt-4 w-full bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-4 flex items-center justify-between text-white shadow-sm">
            <div className="flex items-center">
              <Star className="h-7 w-7 text-amber-300 mr-3" />
              <div>
                <p className="text-xs text-indigo-100 capitalize">Vos {unit}</p>
                <p className="text-2xl font-bold leading-tight">{progress.toLocaleString("fr-FR")}</p>
              </div>
            </div>
            {customer.tier && (
              <div className="text-right">
                <p className="text-[11px] text-indigo-100 flex items-center justify-end"><Award className="h-3 w-3 mr-1" />Niveau</p>
                <p className="text-sm font-semibold">{customer.tier}</p>
              </div>
            )}
          </div>

          <div className="w-full mt-6 flex justify-center space-x-3">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors shadow-sm"
            >
              Télécharger PDF
            </button>
            <button
              onClick={() => {
                const url = window.location.href;
                window.open(`https://wa.me/?text=${encodeURIComponent('Voici votre carte de fidélité: ' + url)}`, '_blank');
              }}
              className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors shadow-sm flex items-center"
            >
              WhatsApp
            </button>
          </div>

          {hasRewards && (
            <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-xl w-full shadow-sm animate-pulse">
              <div className="flex items-center mb-2">
                <Gift className="h-7 w-7 text-green-600 mr-3" />
                <h3 className="text-lg font-bold text-green-800">Récompense{customer.unlockedRewards!.length > 1 ? "s" : ""} débloquée{customer.unlockedRewards!.length > 1 ? "s" : ""} !</h3>
              </div>
              <ul className="text-sm text-green-700 font-medium space-y-1">
                {customer.unlockedRewards!.map(r => <li key={r.id}>• {r.label}{r.value ? ` (${r.value})` : ""}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Recent Visits */}
        <div className="bg-gray-50 p-6 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center uppercase tracking-wide">
            <Calendar className="h-4 w-4 mr-2 text-indigo-500" />
            Dernières visites
          </h3>
          <div className="space-y-3">
            {visits.length === 0 ? (
              <p className="text-sm text-gray-500 italic text-center py-2">Aucune visite pour le moment.</p>
            ) : (
              visits.slice(0, 5).map((visit) => (
                <div key={visit.id} className="flex justify-between items-center text-sm p-2.5 bg-white rounded-lg border border-gray-100 shadow-sm">
                  <div>
                    <p className="text-gray-800 font-medium">{visit.serviceName || "Visite"}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(visit.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                  {visit.points ? (
                    <span className="text-indigo-600 font-semibold flex items-center text-xs bg-indigo-50 px-2 py-1 rounded">
                      <Star className="h-3 w-3 mr-1 text-amber-400" />+{visit.points} pts
                    </span>
                  ) : (
                    <span className="text-green-600 font-medium flex items-center text-xs bg-green-50 px-2 py-1 rounded">
                      <CheckCircle className="h-3 w-3 mr-1" />Vérifié
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <p className="mt-8 text-gray-400 text-sm font-medium">Propulsé par FIDELY</p>
    </div>
  );
}
