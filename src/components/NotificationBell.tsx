import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, UserX, PackageX, X } from "lucide-react";
import { getNotifications, AppNotifications } from "../services/db";

// Cloche de notifications affichée à l'ouverture de l'application :
// - clients inactifs depuis 60 jours et plus (relance)
// - produits en stock bas (réappro) — visible seulement pour l'admin (le serveur filtre)
export default function NotificationBell({ businessId }: { businessId: number | null }) {
  const [data, setData] = useState<AppNotifications | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!businessId) return;
    getNotifications(businessId).then(setData).catch(() => setData(null));
  }, [businessId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const inactive = data?.inactiveClients || [];
  const lowStock = data?.lowStock || [];
  const count = inactive.length + lowStock.length;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors" title="Notifications">
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <span className="text-sm font-bold text-gray-900">Notifications</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
            {count === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">Aucune notification. Tout est à jour ✅</p>}

            {lowStock.length > 0 && (
              <div className="px-4 py-2 bg-amber-50/50">
                <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1">Stock bas</p>
                {lowStock.map(p => (
                  <Link key={p.id} to="/inventory" onClick={() => setOpen(false)} className="flex items-start py-1.5 hover:bg-amber-50 rounded-lg px-1">
                    <PackageX className="h-4 w-4 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{p.name} — <strong className="text-amber-700">{p.unitsLeft} {p.unitLabel}{p.unitsLeft > 1 ? "s" : ""}</strong> restant. Réapprovisionner.</span>
                  </Link>
                ))}
              </div>
            )}

            {inactive.length > 0 && (
              <div className="px-4 py-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Clients inactifs (60 j+)</p>
                {inactive.slice(0, 30).map(c => (
                  <Link key={c.id} to={`/card/${c.id}`} onClick={() => setOpen(false)} className="flex items-start py-1.5 hover:bg-gray-50 rounded-lg px-1">
                    <UserX className="h-4 w-4 text-gray-400 mr-2 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{c.name} <span className="text-gray-400 font-mono text-xs">({c.code})</span> — pas venu depuis <strong>{c.days} jours</strong>.</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
