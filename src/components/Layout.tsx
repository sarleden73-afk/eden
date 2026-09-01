import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Wallet, ReceiptText, Package, Boxes, Truck,
  CreditCard, Palette, Users, UserCog, BarChart3, Calculator, History,
  Settings, LogOut, Menu, X, Sprout, AlertTriangle, Building2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { useEtablissement } from "../contexts/EtablissementContext";
import SelecteurEtablissement from "./SelecteurEtablissement";
import { getAlertesStock } from "../services/db";
import { ROLE_LABELS, type UserRole } from "../types";

interface Entree {
  nom: string;
  href: string;
  icone: typeof LayoutDashboard;
  /** Rôles autorisés — miroir des gardes de l'API (§5.1). */
  roles: UserRole[];
  groupe: string;
}

const TOUS: UserRole[] = ["admin", "responsable", "caissier", "technicien"];
const VALIDENT: UserRole[] = ["admin", "responsable"];
const ADMIN: UserRole[] = ["admin"];

const NAVIGATION: Entree[] = [
  { nom: "Tableau de bord", href: "/tableau-de-bord", icone: LayoutDashboard, roles: TOUS, groupe: "Pilotage" },

  { nom: "Vendre", href: "/vente", icone: ShoppingCart, roles: TOUS, groupe: "Exploitation" },
  { nom: "Caisse", href: "/caisse", icone: Wallet, roles: TOUS, groupe: "Exploitation" },
  { nom: "Ventes", href: "/ventes", icone: ReceiptText, roles: TOUS, groupe: "Exploitation" },
  { nom: "Commandes", href: "/commandes", icone: Palette, roles: TOUS, groupe: "Exploitation" },
  { nom: "Clients", href: "/clients", icone: Users, roles: TOUS, groupe: "Exploitation" },

  { nom: "Catalogue", href: "/catalogue", icone: Package, roles: TOUS, groupe: "Gestion" },
  { nom: "Stocks", href: "/stocks", icone: Boxes, roles: TOUS, groupe: "Gestion" },
  { nom: "Achats", href: "/achats", icone: Truck, roles: VALIDENT, groupe: "Gestion" },
  { nom: "Dépenses", href: "/depenses", icone: CreditCard, roles: TOUS, groupe: "Gestion" },

  { nom: "Rapports", href: "/rapports", icone: BarChart3, roles: VALIDENT, groupe: "Direction" },
  { nom: "Comptabilité", href: "/comptabilite", icone: Calculator, roles: ADMIN, groupe: "Direction" },
  { nom: "Personnel", href: "/personnel", icone: UserCog, roles: ADMIN, groupe: "Direction" },
  { nom: "Établissements", href: "/etablissements", icone: Building2, roles: ADMIN, groupe: "Direction" },
  { nom: "Journal", href: "/journal", icone: History, roles: VALIDENT, groupe: "Direction" },
  { nom: "Paramètres", href: "/parametres", icone: Settings, roles: ADMIN, groupe: "Direction" },
];

const ORDRE_GROUPES = ["Pilotage", "Exploitation", "Gestion", "Direction"];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { profil, deconnexion } = useAuth();
  const { selection, courant } = useEtablissement();
  const location = useLocation();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [nbAlertes, setNbAlertes] = useState(0);

  // Compteur d'alertes de stock (§5.5), suivant l'établissement sélectionné :
  // une rupture non vue est une vente perdue.
  useEffect(() => {
    let annule = false;
    const charger = () =>
      getAlertesStock(selection)
        .then((a) => { if (!annule) setNbAlertes(a.ruptures.length + a.bientotEnRupture.length); })
        .catch(() => { /* le badge est indicatif : son échec ne doit rien casser */ });

    charger();
    const timer = window.setInterval(charger, 120_000);
    return () => { annule = true; window.clearInterval(timer); };
  }, [location.pathname, selection]);

  // Ferme le tiroir mobile à chaque navigation.
  useEffect(() => { setMenuOuvert(false); }, [location.pathname]);

  const role = profil?.role ?? "caissier";
  const visibles = NAVIGATION.filter((e) => e.roles.includes(role));

  const barreLaterale = (
    <>
      <div className="h-16 flex items-center px-5 border-b border-gray-800 shrink-0">
        <Sprout className="h-6 w-6 text-indigo-500 mr-2.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-wide text-white truncate">EDEN</div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Groupe</div>
        </div>
        <button
          onClick={() => setMenuOuvert(false)}
          className="lg:hidden ml-auto p-1 rounded hover:bg-gray-800"
          aria-label="Fermer le menu"
        >
          <X className="h-5 w-5 text-gray-400" />
        </button>
      </div>

      {/* Sélecteur d'établissement : toujours visible, pour qu'on sache en
          permanence sur quelle entité on travaille. */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <SelecteurEtablissement />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {ORDRE_GROUPES.map((groupe) => {
          const entrees = visibles.filter((e) => e.groupe === groupe);
          if (!entrees.length) return null;

          return (
            <div key={groupe}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                {groupe}
              </div>
              <div className="space-y-0.5">
                {entrees.map((e) => {
                  const actif = location.pathname.startsWith(e.href);
                  return (
                    <Link
                      key={e.href}
                      to={e.href}
                      className={cn(
                        "flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors",
                        actif
                          ? "bg-indigo-950 text-indigo-300"
                          : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                      )}
                    >
                      <e.icone
                        className={cn("mr-3 h-[18px] w-[18px] shrink-0", actif ? "text-indigo-400" : "text-gray-500")}
                      />
                      <span className="truncate">{e.nom}</span>
                      {e.href === "/stocks" && nbAlertes > 0 && (
                        <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {nbAlertes}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 p-3 border-t border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-2 bg-gray-900 rounded-lg">
          <div className="h-9 w-9 rounded-full bg-indigo-900 flex items-center justify-center text-indigo-300 font-semibold shrink-0">
            {profil?.fullName?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-100 truncate">{profil?.fullName}</p>
            <p className="text-xs text-gray-500 truncate">{ROLE_LABELS[role]}</p>
          </div>
        </div>
        <button
          onClick={deconnexion}
          className="w-full flex items-center px-3 py-2.5 text-sm font-medium text-gray-400 rounded-lg hover:bg-gray-900 hover:text-red-400 transition-colors"
        >
          <LogOut className="mr-3 h-[18px] w-[18px]" />
          Déconnexion
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {menuOuvert && (
        <div
          className="fixed inset-0 z-40 bg-gray-950/50 lg:hidden"
          onClick={() => setMenuOuvert(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-gray-950 flex flex-col",
          "transform transition-transform duration-200 lg:translate-x-0 lg:static sans-impression",
          menuOuvert ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {barreLaterale}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-16 shrink-0 bg-gray-950 flex items-center px-2 gap-1 sans-impression">
          <button
            onClick={() => setMenuOuvert(true)}
            className="p-2 rounded-lg hover:bg-gray-900 shrink-0"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-6 w-6 text-gray-200" />
          </button>
          <Sprout className="h-5 w-5 text-indigo-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <SelecteurEtablissement compact />
          </div>
        </header>

        {/* Bandeau de couleur : rappel permanent de l'établissement actif, pour
            éviter de saisir une vente au mauvais endroit après une bascule. */}
        {courant && (
          <div className="h-1 shrink-0 sans-impression" style={{ backgroundColor: courant.couleur }} />
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
