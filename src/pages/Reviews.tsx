import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import QRCodeDisplay from "../components/QRCodeDisplay";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getReviews, Review } from "../services/db";
import { Star, Lock, MessageSquareText, QrCode } from "lucide-react";

const fmtDate = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function Reviews() {
  const { user } = useAuth();
  const [role, setRole] = useState("admin");
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    if (user) {
      getBusiness(user.id).then(rest => {
        if (rest) {
          if (rest.role) setRole(rest.role);
          if (rest.role === "admin") getReviews(rest.id).then(setReviews).catch(() => {});
        }
        setLoading(false);
      });
    }
  }, [user]);

  const avisUrl = `${window.location.origin}/avis`;
  const average = useMemo(() => reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0, [reviews]);

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  if (role !== "admin") {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-16 bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
          <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-900">Accès réservé</h2>
          <p className="text-gray-500 mt-1">Les avis clients sont réservés aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Avis clients</h1>
        <p className="text-sm text-gray-500 mt-1">Ce que vos clients pensent de leur visite</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center justify-center text-center">
          <p className="text-4xl font-bold text-gray-900">{average.toFixed(1)}</p>
          <div className="flex mt-1 mb-1">
            {[1, 2, 3, 4, 5].map(n => <Star key={n} className={`h-4 w-4 ${n <= Math.round(average) ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />)}
          </div>
          <p className="text-xs text-gray-500">{reviews.length} avis reçu{reviews.length > 1 ? "s" : ""}</p>
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col sm:flex-row items-center gap-5">
          <QRCodeDisplay value={avisUrl} size={140} />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-sm font-semibold text-gray-900 flex items-center justify-center sm:justify-start"><QrCode className="h-4 w-4 mr-1.5 text-indigo-500" />QR code à afficher au salon</p>
            <p className="text-xs text-gray-500 mt-1 mb-3">Vos clients le scannent avec l'appareil photo de leur téléphone et arrivent directement sur la page pour laisser un avis (ou réserver via WhatsApp).</p>
            <p className="text-[11px] text-gray-400 font-mono break-all">{avisUrl}</p>
            <button onClick={() => window.print()} className="mt-3 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
              Imprimer le QR code
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <span className="text-sm font-medium text-gray-900 flex items-center"><MessageSquareText className="h-4 w-4 text-indigo-500 mr-2" />Avis reçus</span>
        </div>
        {reviews.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Aucun avis pour le moment.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {reviews.map(r => (
              <div key={r.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map(n => <Star key={n} className={`h-3.5 w-3.5 ${n <= r.rating ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />)}
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{r.customerName || "Client anonyme"}</span>
                    {r.customerPhone && <span className="text-xs text-gray-400 font-mono">· {r.customerPhone}</span>}
                  </div>
                  <span className="text-xs text-gray-400">{fmtDate(r.createdAt)}</span>
                </div>
                {r.comment && <p className="text-sm text-gray-600 mt-1">{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
