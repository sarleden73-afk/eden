import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { getBusiness } from "./services/db";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Programs from "./pages/Programs";
import Customers from "./pages/Customers";
import Scanner from "./pages/Scanner";
import CustomerView from "./pages/CustomerView";
import Employees from "./pages/Employees";
import Appointments from "./pages/Appointments";
import Services from "./pages/Services";
import Sale from "./pages/Sale";
import Categories from "./pages/Categories";
import Reports from "./pages/Reports";
import Accounting from "./pages/Accounting";
import Personnel from "./pages/Personnel";
import Inventory from "./pages/Inventory";
import Reviews from "./pages/Reviews";
import Avis from "./pages/Avis";
import PublicBooking from "./pages/PublicBooking";
import React, { useEffect, useState } from "react";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!user) { setRoleLoading(false); return; }
    setRoleLoading(true);
    getBusiness(user.id)
      .then(rest => setRole(rest?.role ?? null))
      .finally(() => setRoleLoading(false));
  }, [user]);

  if (loading || (user && roleLoading)) return <div className="flex justify-center items-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div></div>;

  if (!user) {
    return <Navigate to="/" />;
  }

  // Le rôle 'employee' n'a accès qu'à l'écran de pointage : toute autre page
  // redirige immédiatement (miroir du filtrage de nav dans Layout.tsx et du
  // blocage côté API dans requireOwnedBusiness).
  if (role === "employee" && location.pathname !== "/employees") {
    return <Navigate to="/employees" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/card/:id" element={<CustomerView />} />
          <Route path="/avis" element={<Avis />} />
          <Route path="/reserver" element={<PublicBooking />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/programs"
            element={
              <PrivateRoute>
                <Programs />
              </PrivateRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <PrivateRoute>
                <Customers />
              </PrivateRoute>
            }
          />
          <Route
            path="/scanner"
            element={
              <PrivateRoute>
                <Scanner />
              </PrivateRoute>
            }
          />
          <Route
            path="/employees"
            element={
              <PrivateRoute>
                <Employees />
              </PrivateRoute>
            }
          />
          <Route
            path="/appointments"
            element={
              <PrivateRoute>
                <Appointments />
              </PrivateRoute>
            }
          />
          <Route
            path="/services"
            element={
              <PrivateRoute>
                <Services />
              </PrivateRoute>
            }
          />
          <Route
            path="/vente"
            element={
              <PrivateRoute>
                <Sale />
              </PrivateRoute>
            }
          />
          <Route
            path="/categories"
            element={
              <PrivateRoute>
                <Categories />
              </PrivateRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <PrivateRoute>
                <Reports />
              </PrivateRoute>
            }
          />
          <Route
            path="/accounting"
            element={
              <PrivateRoute>
                <Accounting />
              </PrivateRoute>
            }
          />
          <Route
            path="/personnel"
            element={
              <PrivateRoute>
                <Personnel />
              </PrivateRoute>
            }
          />
          <Route
            path="/inventory"
            element={
              <PrivateRoute>
                <Inventory />
              </PrivateRoute>
            }
          />
          <Route
            path="/reviews"
            element={
              <PrivateRoute>
                <Reviews />
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </Router>
  );
}
