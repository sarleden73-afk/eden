import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Client-side Supabase client, used only for auth (Google sign-in, session).
// Uses the publishable key, which is safe to expose in the browser.
// persistSession: false — volontaire : sur une tablette partagée au salon, on veut
// que l'écran de connexion s'affiche à chaque réouverture de l'app (personne ne doit
// hériter de la session encore ouverte d'un collègue qui aurait oublié de se déconnecter).
// Chacun se reconnecte avec ses propres identifiants à chaque fois.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false },
});
