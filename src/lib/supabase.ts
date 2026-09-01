import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY doivent être définies (voir .env.example)."
  );
}

// Client navigateur, utilisé uniquement pour l'authentification (connexion par
// identifiant/mot de passe et gestion de session). La clé publishable ne donne
// accès à aucune donnée : RLS est activé sans policy sur toutes les tables, et
// les lectures/écritures passent par l'API Express.
//
// persistSession: true — la session survit à un rafraîchissement de page, sinon
// le moindre F5 en pleine vente déconnecterait le caissier. La sécurité sur
// poste partagé est assurée autrement : déconnexion automatique après
// inactivité (§5.14), implémentée dans AuthContext.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
