import React, { useEffect, useState } from "react";
import { Star, CheckCircle } from "lucide-react";
import { getPublicBusiness, submitReview } from "../services/db";

// Numéro WhatsApp du salon pour la réservation directe depuis la page d'avis.
// Numéro complet confirmé par le client : +242 069570399 (Congo-Brazzaville).
const SALON_WHATSAPP = "242069570399";
const WHATSAPP_MESSAGE = "Bonjour, je souhaite réserver un rendez-vous chez JEANNY EMPIRE BEAUTY.";
const GOLD = "#d4af37";

// Page publique, accessible sans connexion, ouverte en scannant le QR code affiché
// au salon. Volontairement très simple : logo, étoiles, commentaire optionnel, envoi.
export default function Avis() {
  const [business, setBusiness] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logoOk, setLogoOk] = useState(true); // masque proprement si le logo n'est pas encore déposé

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    getPublicBusiness().then(setBusiness).catch(() => setError("Page indisponible pour le moment.")).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async () => {
    if (!business || rating === 0 || sending) return;
    setSending(true);
    setError("");
    try {
      await submitReview(business.id, {
        rating, comment: comment.trim() || undefined,
        customerName: name.trim() || undefined, customerPhone: phone.trim() || undefined,
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message || "Échec de l'envoi. Réessayez.");
    } finally { setSending(false); }
  };

  const waLink = `https://wa.me/${SALON_WHATSAPP}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-950"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: GOLD }} /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-5">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-gray-950 px-6 pt-8 pb-7 text-center border-b" style={{ borderColor: "rgba(212,175,55,0.25)" }}>
          {logoOk && (
            <img src="/logo.jpg" alt={business?.name || "JEANNY EMPIRE BEAUTY"} onError={() => setLogoOk(false)}
              className="h-16 w-auto mx-auto mb-4 object-contain" />
          )}
          <h1 className="text-2xl font-bold text-white tracking-wide" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            {!logoOk && (business?.name || "JEANNY EMPIRE BEAUTY")}
          </h1>
          <p className="text-sm mt-2 font-medium" style={{ color: GOLD }}>Laissez votre avis</p>
          <p className="text-gray-400 text-xs mt-1">Votre avis compte pour nous, pour nous améliorer</p>
        </div>

        <div className="p-6">
          {sent ? (
            <div className="text-center py-6">
              <CheckCircle className="h-16 w-16 mx-auto mb-4" style={{ color: GOLD }} />
              <h2 className="text-xl font-bold text-gray-900 mb-1">Merci pour votre avis !</h2>
              <p className="text-gray-500 text-sm">Nous sommes ravis de vous avoir accueilli(e).</p>
            </div>
          ) : (
            <>
              <p className="text-center text-gray-700 font-medium mb-4">Comment évaluez-vous votre visite ?</p>
              <div className="flex justify-center gap-2 mb-6">
                {[1, 2, 3, 4, 5].map(n => {
                  const active = n <= (hoverRating || rating);
                  return (
                    <button key={n} onClick={() => setRating(n)} onMouseEnter={() => setHoverRating(n)} onMouseLeave={() => setHoverRating(0)}
                      className="p-1" aria-label={`${n} étoile${n > 1 ? "s" : ""}`}>
                      <Star className={`h-10 w-10 transition-colors ${active ? "" : "text-gray-200"}`} style={active ? { fill: GOLD, color: GOLD } : undefined} />
                    </button>
                  );
                })}
              </div>

              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Un mot sur votre expérience (facultatif)"
                rows={3} className="w-full border-gray-200 rounded-xl text-sm mb-3 resize-none" maxLength={1000} />
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Votre nom (facultatif)"
                className="w-full border-gray-200 rounded-xl text-sm mb-3" maxLength={200} />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Votre téléphone (facultatif)" type="tel"
                className="w-full border-gray-200 rounded-xl text-sm mb-4" maxLength={30} />

              {error && <p className="text-sm text-red-600 mb-3 text-center">{error}</p>}

              <button onClick={handleSubmit} disabled={rating === 0 || sending}
                className="w-full py-3.5 rounded-xl font-semibold text-white disabled:opacity-40 transition-colors"
                style={{ backgroundColor: "#0a0a0a" }}>
                {sending ? "Envoi..." : "Envoyer mon avis"}
              </button>
            </>
          )}

          <a href={waLink} target="_blank" rel="noreferrer"
            className="mt-4 w-full py-3.5 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors flex items-center justify-center">
            📱 Faire ma prochaine réservation
          </a>
        </div>
      </div>
      <p className="mt-6 text-xs" style={{ color: "rgba(212,175,55,0.6)" }}>Propulsé par FIDELY</p>
    </div>
  );
}
