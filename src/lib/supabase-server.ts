import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabasePublishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables.");
}

/**
 * Client serveur avec la clé secrète : il contourne Row Level Security et ne
 * doit jamais être importé depuis du code client.
 *
 * Il est partagé par toutes les requêtes de l'instance. Ne JAMAIS appeler
 * `auth.signInWithPassword` dessus : le client mémoriserait la session de
 * l'utilisateur connecté et enverrait ensuite son jeton à la place de la clé
 * secrète. Comme RLS est actif sans policy, toutes les lectures suivantes
 * reviendraient vides — y compris celle du profil, ce qui déconnecterait
 * aussitôt la personne qui vient de s'authentifier. Utiliser
 * `creerClientAuth()` pour toute vérification d'identifiants.
 */
export const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Client jetable dédié à la vérification d'identifiants.
 *
 * Créé pour un seul appel puis abandonné : la session qu'il obtient ne
 * contamine rien. Il porte la clé publishable quand elle est disponible —
 * vérifier un mot de passe ne demande aucun privilège particulier, autant ne
 * pas mobiliser la clé secrète pour cela.
 */
export function creerClientAuth() {
  return createClient(supabaseUrl!, supabasePublishableKey || supabaseSecretKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
