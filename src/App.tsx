import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { EtablissementProvider } from "./contexts/EtablissementContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import type { EcranCle } from "./types";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Vente from "./pages/Vente";
import Caisse from "./pages/Caisse";
import Ventes from "./pages/Ventes";
import Commandes from "./pages/Commandes";
import Catalogue from "./pages/Catalogue";
import Depenses from "./pages/Depenses";
import Rapports from "./pages/Rapports";
import Comptabilite from "./pages/Comptabilite";
import Personnel from "./pages/Personnel";
import Etablissements from "./pages/Etablissements";
import Journal from "./pages/Journal";
import Parametres from "./pages/Parametres";
import Pointage from "./pages/Pointage";
import Presence from "./pages/Presence";
import Corbeille from "./pages/Corbeille";
import Approvisionnement from "./pages/Approvisionnement";

function Ecran() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
    </div>
  );
}

/**
 * Garde de route, par écran.
 *
 * Ce filtrage n'est qu'un confort d'interface : la règle qui fait foi est
 * appliquée par l'API sur chaque appel (src/api.ts), y compris le
 * cloisonnement par établissement. Il évite simplement d'ouvrir une page qui
 * ne renverrait que des refus.
 *
 * Quelqu'un privé de tableau de bord serait renvoyé en boucle vers lui : on le
 * dirige alors vers le premier écran qui lui reste.
 */
function Protege({ ecran, children }: { ecran: EcranCle; children: React.ReactNode }) {
  const { session, profil, loading } = useAuth();

  if (loading) return <Ecran />;
  if (!session || !profil) return <Navigate to="/connexion" replace />;
  if (!profil.ecrans.includes(ecran)) {
    const repli = profil.ecrans[0];
    return <Navigate to={repli ? `/${repli}` : "/connexion"} replace />;
  }

  return <>{children}</>;
}

/** Point d'entrée après connexion : le tableau de bord, ou à défaut le premier écran autorisé. */
function Accueil() {
  const { profil, loading } = useAuth();
  if (loading) return <Ecran />;
  if (!profil) return <Navigate to="/connexion" replace />;
  const cible = profil.ecrans.includes("tableau-de-bord")
    ? "tableau-de-bord"
    : profil.ecrans[0];
  return <Navigate to={cible ? `/${cible}` : "/connexion"} replace />;
}

function ConnexionOuAccueil() {
  const { session, profil, loading } = useAuth();
  if (loading) return <Ecran />;
  if (session && profil) return <Accueil />;
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

            <Route path="/tableau-de-bord" element={<Protege ecran="tableau-de-bord"><Dashboard /></Protege>} />
            <Route path="/vente"          element={<Protege ecran="vente"><Vente /></Protege>} />
            <Route path="/caisse"         element={<Protege ecran="caisse"><Caisse /></Protege>} />
            <Route path="/ventes"         element={<Protege ecran="ventes"><Ventes /></Protege>} />
            <Route path="/commandes"      element={<Protege ecran="commandes"><Commandes /></Protege>} />
            <Route path="/pointage"       element={<Protege ecran="pointage"><Pointage /></Protege>} />
            <Route path="/catalogue"      element={<Protege ecran="catalogue"><Catalogue /></Protege>} />
            <Route path="/approvisionnement" element={<Protege ecran="stocks"><Approvisionnement /></Protege>} />
            {/* Anciennes adresses : les raccourcis et onglets ouverts continuent de marcher. */}
            <Route path="/stocks" element={<Navigate to="/approvisionnement" replace />} />
            <Route path="/achats" element={<Navigate to="/approvisionnement" replace />} />
            <Route path="/depenses"       element={<Protege ecran="depenses"><Depenses /></Protege>} />
            <Route path="/rapports"       element={<Protege ecran="rapports"><Rapports /></Protege>} />
            <Route path="/journal"        element={<Protege ecran="journal"><Journal /></Protege>} />

            <Route path="/comptabilite"   element={<Protege ecran="comptabilite"><Comptabilite /></Protege>} />
            <Route path="/personnel"      element={<Protege ecran="personnel"><Personnel /></Protege>} />
            <Route path="/presence"       element={<Protege ecran="personnel"><Presence /></Protege>} />
            <Route path="/etablissements" element={<Protege ecran="etablissements"><Etablissements /></Protege>} />
            <Route path="/corbeille"      element={<Protege ecran="corbeille"><Corbeille /></Protege>} />
            <Route path="/parametres"     element={<Protege ecran="parametres"><Parametres /></Protege>} />

            <Route path="/" element={<Accueil />} />
            <Route path="*" element={<Accueil />} />
          </Routes>
        </EtablissementProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
