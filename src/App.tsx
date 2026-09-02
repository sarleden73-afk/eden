import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { EtablissementProvider } from "./contexts/EtablissementContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import type { UserRole } from "./types";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Vente from "./pages/Vente";
import Caisse from "./pages/Caisse";
import Ventes from "./pages/Ventes";
import Commandes from "./pages/Commandes";
import Catalogue from "./pages/Catalogue";
import Stocks from "./pages/Stocks";
import Achats from "./pages/Achats";
import Depenses from "./pages/Depenses";
import Rapports from "./pages/Rapports";
import Comptabilite from "./pages/Comptabilite";
import Personnel from "./pages/Personnel";
import Etablissements from "./pages/Etablissements";
import Journal from "./pages/Journal";
import Parametres from "./pages/Parametres";

const TOUS: UserRole[] = ["admin", "responsable", "caissier", "technicien"];
const VALIDENT: UserRole[] = ["admin", "responsable"];
const ADMIN: UserRole[] = ["admin"];

function Ecran() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
    </div>
  );
}

/**
 * Garde de route. Le filtrage par rôle ici n'est qu'un confort d'interface :
 * la règle qui fait foi est appliquée par l'API sur chaque appel (src/api.ts),
 * y compris le cloisonnement par établissement.
 */
function Protege({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { session, profil, loading } = useAuth();

  if (loading) return <Ecran />;
  if (!session || !profil) return <Navigate to="/connexion" replace />;
  if (!roles.includes(profil.role)) return <Navigate to="/tableau-de-bord" replace />;

  return <>{children}</>;
}

function ConnexionOuAccueil() {
  const { session, profil, loading } = useAuth();
  if (loading) return <Ecran />;
  if (session && profil) return <Navigate to="/tableau-de-bord" replace />;
  return <Login />;
}

export default function App() {
  return (
    <BrowserRouter>
      {/* L.apparence ne dépend d.aucune donnée : elle enveloppe tout, pour que
          le thème s.applique aussi à l.écran de connexion. */}
      <ThemeProvider>
      <AuthProvider>
        {/* Le contexte d'établissement dépend du profil : il est monté à
            l'intérieur de l'authentification. */}
        <EtablissementProvider>
          <Routes>
            <Route path="/connexion" element={<ConnexionOuAccueil />} />

            <Route path="/tableau-de-bord" element={<Protege roles={TOUS}><Dashboard /></Protege>} />
            <Route path="/vente"          element={<Protege roles={TOUS}><Vente /></Protege>} />
            <Route path="/caisse"         element={<Protege roles={TOUS}><Caisse /></Protege>} />
            <Route path="/ventes"         element={<Protege roles={TOUS}><Ventes /></Protege>} />
            <Route path="/commandes"      element={<Protege roles={TOUS}><Commandes /></Protege>} />
            <Route path="/catalogue"      element={<Protege roles={TOUS}><Catalogue /></Protege>} />
            <Route path="/stocks"         element={<Protege roles={TOUS}><Stocks /></Protege>} />

            <Route path="/achats"         element={<Protege roles={VALIDENT}><Achats /></Protege>} />
            <Route path="/depenses"       element={<Protege roles={TOUS}><Depenses /></Protege>} />
            <Route path="/rapports"       element={<Protege roles={VALIDENT}><Rapports /></Protege>} />
            <Route path="/journal"        element={<Protege roles={VALIDENT}><Journal /></Protege>} />

            <Route path="/comptabilite"   element={<Protege roles={ADMIN}><Comptabilite /></Protege>} />
            <Route path="/personnel"      element={<Protege roles={ADMIN}><Personnel /></Protege>} />
            <Route path="/etablissements" element={<Protege roles={ADMIN}><Etablissements /></Protege>} />
            <Route path="/parametres"     element={<Protege roles={ADMIN}><Parametres /></Protege>} />

            <Route path="/" element={<Navigate to="/tableau-de-bord" replace />} />
            <Route path="*" element={<Navigate to="/tableau-de-bord" replace />} />
          </Routes>
        </EtablissementProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
