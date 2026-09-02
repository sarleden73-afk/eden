import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Wallet, ReceiptText, Package, Boxes, Truck,
  CreditCard, Palette, UserCog, BarChart3, Calculator, History,
  Settings, LogOut, Menu, X, Sprout, AlertTriangle, Building2,
  PanelLeftClose, PanelLeftOpen, ScanFace, CalendarCheck, Trash2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { useEtablissement } from "../contexts/EtablissementContext";
import SelecteurEtablissement from "./SelecteurEtablissement";
import { getAlertesStock, getParametres } from "../services/db";
import { ROLE_LABELS, type EcranCle } from "../types";

interface Entree {
  nom: string;
  href: string;
  icone: typeof LayoutDashboard;
  /**
   * Écran commandé par cette entrée. C'est cette clé, et non le rôle, qui
   * décide de l'affichage : la direction peut retirer un écran à quelqu'un
   * sans avoir à changer son rôle. L'API applique la même table (src/api.ts),
   * le menu n'est qu'un miroir.
   */
  ecran: EcranCle;
  groupe: string;
}

const NAVIGATION: Entree[] = [
  { nom: "Tableau de bord", href: "/tableau-de-bord", icone: LayoutDashboard, ecran: "tableau-de-bord", groupe: "Pilotage" },

  { nom: "Vendre", href: "/vente", icone: ShoppingCart, ecran: "vente", groupe: "Exploitation" },
  { nom: "Caisse", href: "/caisse", icone: Wallet, ecran: "caisse", groupe: "Exploitation" },
  { nom: "Ventes", href: "/ventes", icone: ReceiptText, ecran: "ventes", groupe: "Exploitation" },
  { nom: "Commandes", href: "/commandes", icone: Palette, ecran: "commandes", groupe: "Exploitation" },
  { nom: "Pointage", href: "/pointage", icone: ScanFace, ecran: "pointage", groupe: "Exploitation" },

  { nom: "Catalogue", href: "/catalogue", icone: Package, ecran: "catalogue", groupe: "Gestion" },
  { nom: "Stocks", href: "/stocks", icone: Boxes, ecran: "stocks", groupe: "Gestion" },
  { nom: "Achats", href: "/achats", icone: Truck, ecran: "achats", groupe: "Gestion" },
  { nom: "Dépenses", href: "/depenses", icone: CreditCard, ecran: "depenses", groupe: "Gestion" },

  { nom: "Rapports", href: "/rapports", icone: BarChart3, ecran: "rapports", groupe: "Direction" },
  { nom: "Comptabilité", href: "/comptabilite", icone: Calculator, ecran: "comptabilite", groupe: "Direction" },
  { nom: "Personnel", href: "/personnel", icone: UserCog, ecran: "personnel", groupe: "Direction" },
  { nom: "Présence", href: "/presence", icone: CalendarCheck, ecran: "personnel", groupe: "Direction" },
  { nom: "Établissements", href: "/etablissements", icone: Building2, ecran: "etablissements", groupe: "Direction" },
  { nom: "Journal", href: "/journal", icone: History, ecran: "journal", groupe: "Direction" },
  { nom: "Corbeille", href: "/corbeille", icone: Trash2, ecran: "corbeille", groupe: "Direction" },
  { nom: "Paramètres", href: "/parametres", icone: Settings, ecran: "parametres", groupe: "Direction" },
];

const ORDRE_GROUPES = ["Pilotage", "Exploitation", "Gestion", "Direction"];

const CLE_MENU_REDUIT = "eden.menuReduit";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { profil, deconnexion } = useAuth();
  const { selection, courant } = useEtablissement();
  const location = useLocation();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [nbAlertes, setNbAlertes] = useState(0);
  const [marque, setMarque] = useState({ nom: "EDEN", logoUrl: "" });

  // Menu réductible : sur l'écran de vente, chaque pixel gagné va au panier.
  const [reduit, setReduit] = useState(() => {
    try { return window.localStorage.getItem(CLE_MENU_REDUIT) === "1"; } catch { return false; }
  });

  const basculerReduit = () => {
    setReduit((r) => {
      const suivant = !r;
      try { window.localStorage.setItem(CLE_MENU_REDUIT, suivant ? "1" : "0"); } catch { /* stockage refusé */ }
      return suivant;
    });
  };

  // Compteur d'alertes de stock (§5.5), suivant l'établissement sélectionné.
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

  // Identité de l.entreprise : chargée une fois, purement décorative.
  useEffect(() => {
    getParametres()
      .then((p) => setMarque({
        nom: p.entreprise?.nom || "EDEN",
        logoUrl: p.entreprise?.logoUrl || "",
      }))
      .catch(() => { /* le bandeau garde son icône par défaut */ });
  }, []);

  useEffect(() => { setMenuOuvert(false); }, [location.pathname]);

  const role = profil?.role ?? "caissier";
  // Tant que le profil n'est pas chargé, aucune entrée : afficher des liens
  // pour les retirer une seconde plus tard donne l'impression d'un menu qui
  // se dérobe.
  const autorises = profil?.ecrans ?? [];
  const visibles = NAVIGATION.filter((e) => autorises.includes(e.ecran));

  const barreLaterale = (
    <>
      <div className={cn(
        "h-16 flex items-center border-b border-gray-800 shrink-0",
        reduit ? "justify-center px-2" : "px-5"
      )}>
        {marque.logoUrl ? (
          <img
            src={marque.logoUrl}
            alt=""
            className={cn("h-7 w-7 rounded object-contain bg-white shrink-0", !reduit && "mr-2.5")}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <Sprout className={cn("h-6 w-6 text-indigo-500 shrink-0", !reduit && "mr-2.5")} />
        )}
        {!reduit && (
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide text-[#fff] truncate">{marque.nom}</div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">Groupe</div>
          </div>
        )}
        <button
          onClick={() => setMenuOuvert(false)}
          className="lg:hidden ml-auto p-1 rounded hover:bg-gray-800"
          aria-label="Fermer le menu"
        >
          <X className="h-5 w-5 text-gray-400" />
        </button>
      </div>

      {!reduit && (
        <div className="px-3 pt-3 pb-1 shrink-0">
          <SelecteurEtablissement />
        </div>
      )}

      {/* Seule cette zone défile : le logo, le sélecteur et le pied de menu
          restent en place quand on parcourt une longue liste. */}
      <nav className={cn("flex-1 min-h-0 overflow-y-auto py-3 space-y-5", reduit ? "px-2" : "px-3")}>
        {ORDRE_GROUPES.map((groupe) => {
          const entrees = visibles.filter((e) => e.groupe === groupe);
          if (!entrees.length) return null;

          return (
            <div key={groupe}>
              {!reduit && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                  {groupe}
                </div>
              )}
              <div className="space-y-0.5">
                {entrees.map((e) => {
                  const actif = location.pathname.startsWith(e.href);
                  return (
                    <Link
                      key={e.href}
                      to={e.href}
                      title={reduit ? e.nom : undefined}
                      className={cn(
                        "flex items-center py-2.5 text-sm font-medium rounded-lg transition-colors",
                        reduit ? "justify-center px-2" : "px-3",
                        actif
                          ? "bg-indigo-950 text-indigo-300"
                          : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                      )}
                    >
                      <e.icone
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          !reduit && "mr-3",
                          actif ? "text-indigo-400" : "text-gray-500"
                        )}
                      />
                      {!reduit && <span className="truncate">{e.nom}</span>}
                      {e.href === "/stocks" && nbAlertes > 0 && (
                        reduit ? (
                          <span className="absolute ml-6 -mt-4 h-1.5 w-1.5 rounded-full bg-amber-400" />
                        ) : (
                          <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {nbAlertes}
                          </span>
                        )
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={cn("shrink-0 border-t border-gray-800", reduit ? "p-2" : "p-3")}>
        {!reduit && (
          <div className="flex items-center gap-3 px-3 py-2.5 mb-2 bg-gray-900 rounded-lg">
            <div className="h-9 w-9 rounded-full bg-indigo-900 flex items-center justify-center text-indigo-300 font-semibold shrink-0">
              {profil?.fullName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-100 truncate">{profil?.fullName}</p>
              <p className="text-xs text-gray-500 truncate">{ROLE_LABELS[role]}</p>
            </div>
          </div>
        )}
        <button
          onClick={deconnexion}
          title={reduit ? "Déconnexion" : undefined}
          className={cn(
            "w-full flex items-center py-2.5 text-sm font-medium text-gray-400 rounded-lg",
            "hover:bg-gray-900 hover:text-red-400 transition-colors",
            reduit ? "justify-center px-2" : "px-3"
          )}
        >
          <LogOut className={cn("h-[18px] w-[18px]", !reduit && "mr-3")} />
          {!reduit && "Déconnexion"}
        </button>
      </div>
    </>
  );

  return (
    // h-screen + overflow-hidden : la fenêtre ne défile jamais dans son
    // ensemble. Le menu et le contenu ont chacun leur propre ascenseur, ce qui
    // évite de perdre la navigation en parcourant un long catalogue.
    <div className="h-screen overflow-hidden bg-gray-50 flex">
      {menuOuvert && (
        <div
          className="fixed inset-0 z-40 bg-gray-950/50 lg:hidden"
          onClick={() => setMenuOuvert(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-gray-950 flex flex-col shrink-0",
          "transform transition-all duration-200 lg:translate-x-0 lg:static sans-impression",
          reduit ? "w-64 lg:w-[68px]" : "w-64",
          menuOuvert ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {barreLaterale}
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header className="lg:hidden h-14 shrink-0 bg-gray-950 flex items-center px-2 gap-1 sans-impression">
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

        {/* Barre de repère : couleur de l'établissement + bouton de réduction
            du menu, disponible uniquement sur grand écran. */}
        <div className="hidden lg:flex items-center h-9 shrink-0 border-b border-gray-200 bg-white px-3 sans-impression">
          <button
            onClick={basculerReduit}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            title={reduit ? "Déployer le menu" : "Réduire le menu"}
            aria-label={reduit ? "Déployer le menu" : "Réduire le menu"}
          >
            {reduit ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          {courant && (
            <span className="ml-3 inline-flex items-center gap-2 text-xs text-gray-500">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: courant.couleur }}
                aria-hidden
              />
              {courant.nom}
            </span>
          )}
        </div>

        {courant && (
          <div className="h-1 shrink-0 sans-impression" style={{ backgroundColor: courant.couleur }} />
        )}

        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 lg:p-6">
          <div className="max-w-7xl mx-auto pb-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
