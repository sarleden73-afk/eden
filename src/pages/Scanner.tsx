import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCustomer, Customer } from "../services/db";
import Layout from "../components/Layout";
import QRScanner from "../components/QRScanner";
import { XCircle, CheckCircle } from "lucide-react";

// Le scan identifie le client puis ouvre directement sa fiche dans la caisse
// (panier multi-prestations, réductions, pourboire) — plus besoin de le rechercher
// par nom ou numéro de téléphone quand il se présente.
export default function Scanner() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [found, setFound] = useState<Customer | null>(null);
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);

  const extractCustomerId = (text: string) => {
    const marker = "/card/";
    const idx = text.indexOf(marker);
    if (idx === -1) return text.trim();
    return text.slice(idx + marker.length).split(/[?#]/)[0].trim();
  };

  const handleScan = async (decodedText: string) => {
    const customerId = extractCustomerId(decodedText);
    if (customerId === lastScannedId || found) return;
    setLastScannedId(customerId);
    setError("");
    try {
      const customer = await getCustomer(customerId);
      if (!customer) { setError("Client introuvable."); setTimeout(() => setLastScannedId(null), 2000); return; }
      setFound(customer);
      sessionStorage.setItem("fidely_pending_customer_id", customer.id);
      setTimeout(() => navigate("/vente"), 700);
    } catch (err: any) {
      setError(err.message || "Échec du scan.");
      setTimeout(() => setLastScannedId(null), 2000);
    }
  };

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">Scanner un client</h1>
        <p className="text-sm text-gray-500 text-center mb-6">Scannez sa carte : sa fiche s'ouvre directement dans la caisse.</p>

        {!found && (
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
            <QRScanner onScan={handleScan} onError={(err) => console.log(err)} />
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl border bg-red-50 border-red-200 flex items-start mb-4">
            <XCircle className="h-5 w-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {found && (
          <div className="p-5 rounded-xl border bg-green-50 border-green-200 flex items-center">
            <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0" />
            <p className="text-sm text-green-800">Client trouvé : <strong>{found.name}</strong> — ouverture de la caisse...</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
