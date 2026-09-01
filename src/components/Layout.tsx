import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LayoutDashboard, CreditCard, ScanLine, Users, LogOut, Menu, X, Briefcase, Calendar as CalendarIcon, Scissors, BarChart3, Diamond, Wallet, Shield, Tag, ShoppingCart, Boxes, Star } from "lucide-react";
import { useState, useEffect } from "react";
import React from "react";
import { cn } from "../lib/utils";
import { getBusiness } from "../services/db";
import NotificationBell from "./NotificationBell";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [businessName, setBusinessName] = useState("Fidely");
  const [role, setRole] = useState<string>("admin");
  const [businessId, setBusinessId] = useState<number | null>(null);

  useEffect(() => {
    if (user) {
      getBusiness(user.id).then(rest => {
        if (rest) {
          setBusinessName(rest.name);
          setBusinessId(rest.id);
          if (rest.role) setRole(rest.role);
        }
      });
    }
  }, [user]);

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "Utilisateur";

  // Staff voit : Agenda, Clients, Catégories, Prestations, Fidélité, Scanner, Comptabilité.
  // Admin voit tout (+ Tableau de bord, Employés, Personnel, Rapports).
  // Staff a accès à tout, sauf Personnel et Rapports (réservés admin).
  // Employee (pointage uniquement) ne voit que la page Employés — voir le filtre ci-dessous.
  const navItems = [
    { name: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard, adminOnly: false },
    { name: "Vendre (Caisse)", href: "/vente", icon: ShoppingCart, adminOnly: false },
    { name: "Agenda", href: "/appointments", icon: CalendarIcon, adminOnly: false },
    { name: "Clients", href: "/customers", icon: Users, adminOnly: false },
    { name: "Employés", href: "/employees", icon: Briefcase, adminOnly: false },
    { name: "Catégories", href: "/categories", icon: Tag, adminOnly: false },
    { name: "Prestations", href: "/services", icon: Scissors, adminOnly: false },
    { name: "Fidélité", href: "/programs", icon: CreditCard, adminOnly: false },
    { name: "Scanner", href: "/scanner", icon: ScanLine, adminOnly: false },
    { name: "Comptabilité", href: "/accounting", icon: Wallet, adminOnly: false },
    { name: "Inventaire", href: "/inventory", icon: Boxes, adminOnly: false },
    { name: "Avis clients", href: "/reviews", icon: Star, adminOnly: true },
    { name: "Personnel", href: "/personnel", icon: Shield, adminOnly: true },
    { name: "Rapports", href: "/reports", icon: BarChart3, adminOnly: true },
  ]
    .filter(item => !item.adminOnly || role === "admin")
    .filter(item => role !== "employee" || item.href === "/employees");

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-gray-950 border-r border-gray-900 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0 flex flex-col",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-16 flex items-center px-6 border-b border-gray-900 shrink-0">
          <Diamond className="h-6 w-6 text-indigo-500 mr-2" />
          <span className="text-xl font-bold tracking-widest text-indigo-500 uppercase truncate" title={businessName}>{businessName}</span>
          <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden ml-auto">
            <X className="h-6 w-6 text-gray-500" />
          </button>
        </div>

        <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200",
                  isActive
                    ? "bg-indigo-900/40 text-indigo-400 border border-indigo-900/50"
                    : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                )}
              >
                <item.icon className={cn("mr-3 h-5 w-5", isActive ? "text-indigo-400" : "text-gray-500")} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 p-4 border-t border-gray-900">
          <div className="flex items-center mb-4 px-3 py-2 bg-gray-900 rounded-lg">
            <div className="h-8 w-8 rounded-full bg-indigo-900 flex items-center justify-center text-indigo-400 font-bold shrink-0">
              {displayName[0]?.toUpperCase() || "U"}
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-gray-200 truncate">{displayName}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center px-4 py-2 text-sm font-medium text-gray-400 rounded-lg hover:bg-gray-900 hover:text-red-400 transition-colors"
          >
            <LogOut className="mr-3 h-5 w-5" />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="lg:hidden bg-gray-950 border-b border-gray-900 h-16 flex items-center px-4 justify-between">
          <div className="flex items-center min-w-0 flex-1 mr-2">
            <Diamond className="h-6 w-6 text-indigo-500 mr-2 flex-shrink-0" />
            <span className="text-xl font-bold tracking-widest text-indigo-500 uppercase truncate" title={businessName}>{businessName}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <NotificationBell businessId={businessId} />
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -mr-2 rounded-lg hover:bg-gray-900 active:bg-gray-800" aria-label="Ouvrir le menu">
              <Menu className="h-7 w-7 text-gray-200" />
            </button>
          </div>
        </header>

        {/* Barre supérieure (desktop) : cloche de notifications */}
        <div className="hidden lg:flex items-center justify-end h-14 px-8 border-b border-gray-100 bg-white">
          <NotificationBell businessId={businessId} />
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
