import { supabase } from "../lib/supabase";
import type {
  Profile, Product, Category, Pack, Supplier, Sale, CashSession,
  CashMovement, StockMovement, Purchase, Expense, Order, AuditEntry,
  DashboardStats, ReportData, PeriodKey, EntrepriseSettings, CaisseSettings,
  Establishment, SelectionEtablissement, AgentConnexion, LivreComptable,
} from "../types";

// ============================================================================
// Client de l'API EDEN.
// Chaque appel joint le jeton Supabase courant ; le serveur le vérifie, puis
// applique les rôles ET le cloisonnement par établissement. Aucune requête ne
// part directement vers Postgres depuis le navigateur : RLS bloque tout accès
// avec la clé publishable.
//
// La sélection d'établissement est passée explicitement à chaque appel plutôt
// que gardée dans un état global : impossible pour un écran d'afficher les
// données d'un établissement en croyant montrer celles d'un autre.
// ============================================================================

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function appel<T>(chemin: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const reponse = await fetch(`/api${chemin}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!reponse.ok) {
    // Le corps d'erreur peut être vide (502, coupure réseau) : on retombe alors
    // sur un message générique plutôt que de lever une erreur de parsing.
    const corps = await reponse.json().catch(() => ({}));
    throw new ApiError(corps.error || `Erreur ${reponse.status}`, reponse.status);
  }

  if (reponse.status === 204) return undefined as T;
  return reponse.json();
}

const get = <T>(chemin: string) => appel<T>(chemin);
const post = <T>(chemin: string, corps?: unknown) =>
  appel<T>(chemin, { method: "POST", body: JSON.stringify(corps ?? {}) });
const patch = <T>(chemin: string, corps: unknown) =>
  appel<T>(chemin, { method: "PATCH", body: JSON.stringify(corps) });
const put = <T>(chemin: string, corps: unknown) =>
  appel<T>(chemin, { method: "PUT", body: JSON.stringify(corps) });

/** `"tous"` n'est pas envoyé : son absence signifie la vue consolidée. */
function paramEtab(p: URLSearchParams, etab?: SelectionEtablissement) {
  if (typeof etab === "number") p.set("establishmentId", String(etab));
  return p;
}

function requete(etab?: SelectionEtablissement, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  paramEtab(p, etab);
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** Construit `?periode=…&debut=…&fin=…&establishmentId=…`. */
export function parametresPeriode(
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
): string {
  const p = new URLSearchParams({ periode });
  if (periode === "personnalise" && options.debut && options.fin) {
    p.set("debut", options.debut);
    p.set("fin", options.fin);
  }
  paramEtab(p, options.etablissement);
  return `?${p.toString()}`;
}

// --- Connexion du personnel par nom + code ---------------------------------
// Ces trois appels précèdent toute session : ils ne joignent donc aucun jeton.
// Le serveur ne renvoie jamais l'adresse technique d'un compte à code, et
// s'authentifie lui-même auprès de Supabase avant de transmettre la session.

async function appelPublic<T>(chemin: string, options: RequestInit = {}): Promise<T> {
  const reponse = await fetch(`/api/auth${chemin}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => ({}));
    throw new ApiError(corps.error || `Erreur ${reponse.status}`, reponse.status);
  }
  return reponse.json();
}

export const getMarque = () =>
  appelPublic<{ nom: string; logoUrl: string }>("/marque");

export const getEtablissementsConnexion = () =>
  appelPublic<{ id: number; nom: string; couleur: string }[]>("/etablissements");

export const getPersonnelConnexion = (establishmentId?: number) =>
  appelPublic<AgentConnexion[]>(
    `/personnel${establishmentId ? `?establishmentId=${establishmentId}` : ""}`
  );

export const connexionParCode = (profileId: string, pin: string) =>
  appelPublic<{ accessToken: string; refreshToken: string }>("/pin", {
    method: "POST",
    body: JSON.stringify({ profileId, pin }),
  });

// --- Profil et utilisateurs (§5.1) -----------------------------------------

export type ProfilCourant = Profile & { peutChangerEtablissement: boolean };

export const getMonProfil = () => get<ProfilCourant>("/me");
export const getUtilisateurs = () => get<Profile[]>("/users");
export const creerUtilisateur = (corps: {
  fullName: string;
  role: string;
  establishmentId?: number | null;
  fonction?: string;
  dateEntree?: string;
  /** Encadrement uniquement. */
  email?: string;
  password?: string;
  /** Personnel de terrain uniquement : 6 chiffres. */
  pin?: string;
}) => post<Profile>("/users", corps);

/** Attribue un nouveau code à un compte de terrain. */
export const definirCodePin = (id: string, pin: string) =>
  post<{ ok: boolean }>(`/users/${id}/pin`, { pin });
export const modifierUtilisateur = (id: string, corps: Partial<Profile> & { motif?: string }) =>
  patch<Profile>(`/users/${id}`, corps);
export const reinitialiserMotDePasse = (id: string, password: string) =>
  post<{ ok: boolean }>(`/users/${id}/password`, { password });

// --- Établissements ---------------------------------------------------------

export const getEtablissements = () => get<Establishment[]>("/establishments");
export const creerEtablissement = (corps: Partial<Establishment>) =>
  post<Establishment>("/establishments", corps);
export const modifierEtablissement = (id: number, corps: Partial<Establishment>) =>
  patch<Establishment>(`/establishments/${id}`, corps);

// --- Catalogue (§2, §3, §5.5) ----------------------------------------------

export const getCategories = (etab?: SelectionEtablissement) =>
  get<Category[]>(`/categories${requete(etab)}`);
export const creerCategorie = (corps: Partial<Category>) => post<Category>("/categories", corps);
export const modifierCategorie = (id: number, corps: Partial<Category>) =>
  patch<Category>(`/categories/${id}`, corps);

export const getProduits = (etab?: SelectionEtablissement, options: { tous?: boolean } = {}) =>
  get<Product[]>(`/products${requete(etab, options.tous ? { actif: "tous" } : {})}`);
export const creerProduit = (corps: Partial<Product>) => post<Product>("/products", corps);
export const modifierProduit = (id: number, corps: Partial<Product> & { motif?: string }) =>
  patch<Product>(`/products/${id}`, corps);

export const getPacks = (etab?: SelectionEtablissement) => get<Pack[]>(`/packs${requete(etab)}`);
export const creerPack = (
  corps: Partial<Pack> & { items?: { productId: number; quantite: number }[] }
) => post<Pack>("/packs", corps);
export const modifierPack = (
  id: number,
  corps: Partial<Pack> & { items?: { productId: number; quantite: number }[] }
) => patch<Pack>(`/packs/${id}`, corps);

// --- Fournisseurs (communs aux établissements) -----------------------------

export const getFournisseurs = () => get<Supplier[]>("/suppliers");
export const creerFournisseur = (corps: Partial<Supplier>) => post<Supplier>("/suppliers", corps);
export const modifierFournisseur = (id: number, corps: Partial<Supplier>) =>
  patch<Supplier>(`/suppliers/${id}`, corps);


// --- Caisse (§5.3) ---------------------------------------------------------

export type CaisseCourante =
  (CashSession & { soldeTheorique: number; mouvements: CashMovement[] }) | null;

export const getCaisseCourante = (etablissementId: number) =>
  get<CaisseCourante>(`/cash/current?establishmentId=${etablissementId}`);
export const ouvrirCaisse = (corps: {
  establishmentId: number; fondsInitial: number; notes?: string;
}) => post<CashSession>("/cash/open", corps);
export const fermerCaisse = (corps: { sessionId: number; soldePhysique: number; notes?: string }) =>
  post<CashSession>("/cash/close", corps);
export const ajouterMouvementCaisse = (corps: {
  sessionId: number; type: string; montant: number; motif: string; paymentMethod?: string;
}) => post<CashMovement>("/cash/movements", corps);
export const getSessionsCaisse = (etab?: SelectionEtablissement) =>
  get<CashSession[]>(`/cash/sessions${requete(etab)}`);

// --- Ventes (§5.2) ---------------------------------------------------------

export const getVentes = (
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
) => get<Sale[]>(`/sales${parametresPeriode(periode, options)}`);
export const getVente = (id: number) => get<Sale>(`/sales/${id}`);
export const enregistrerVente = (corps: {
  establishmentId: number;
  items: { productId?: number; packId?: number; quantite: number }[];
  paymentMethod: string;
  numeroTransaction?: string;
  remise?: number;
}) => post<{ id: number; numeroRecu: string; total: number }>("/sales", corps);
export const annulerVente = (id: number, motif: string) =>
  post<Sale>(`/sales/${id}/cancel`, { motif });

// --- Stock (§5.5) ----------------------------------------------------------

export const getMouvementsStock = (etab?: SelectionEtablissement, productId?: number) =>
  get<StockMovement[]>(
    `/stock/movements${requete(etab, productId ? { productId: String(productId) } : {})}`
  );

export interface AlerteStock {
  id: number; nom: string; establishmentId: number;
  quantite: number; seuilAlerte: number; unite: string;
}
export const getAlertesStock = (etab?: SelectionEtablissement) =>
  get<{ ruptures: AlerteStock[]; bientotEnRupture: AlerteStock[] }>(`/stock/alerts${requete(etab)}`);

export const ajusterStock = (corps: { productId: number; quantiteReelle: number; motif: string }) =>
  post<{ ok: boolean; ecart: number }>("/stock/adjust", corps);

// --- Achats (§5.6) ---------------------------------------------------------

export const getAchats = (
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
) => get<Purchase[]>(`/purchases${parametresPeriode(periode, options)}`);
export const getAchat = (id: number) => get<Purchase>(`/purchases/${id}`);
export const creerAchat = (corps: {
  establishmentId: number; supplierId?: number | null; dateAchat?: string;
  montantPaye: number; paymentMethod: string; justificatif?: string; notes?: string;
  items: { productId?: number | null; libelle: string; quantite: number; prixUnitaire: number }[];
}) => post<{ id: number; numero: string; montantTotal: number }>("/purchases", corps);
export const reglerAchat = (id: number, montant: number) =>
  post<Purchase>(`/purchases/${id}/pay`, { montant });

// --- Dépenses (§5.7) -------------------------------------------------------

export const getDepenses = (
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
) => get<Expense[]>(`/expenses${parametresPeriode(periode, options)}`);
export const creerDepense = (corps: {
  establishmentId: number; categorie: string; montant: number; motif: string;
  dateDepense?: string; paymentMethod?: string; justificatif?: string;
}) => post<Expense>("/expenses", corps);
export const validerDepense = (id: number) => post<Expense>(`/expenses/${id}/validate`);

// --- Commandes (§5.8) ------------------------------------------------------

export const getCommandes = (etab?: SelectionEtablissement, statut?: string) =>
  get<Order[]>(`/orders${requete(etab, statut ? { statut } : {})}`);
export const creerCommande = (corps: {
  establishmentId: number; customerId?: number | null; customerNom: string;
  customerTelephone?: string; typePrestation: string; description?: string;
  quantite: number; prixUnitaire: number; acompte: number;
  dateLivraisonPrevue?: string; technicienId?: string | null;
}) => post<Order>("/orders", corps);
export const modifierCommande = (id: number, corps: Partial<Order> & { motif?: string }) =>
  patch<Order>(`/orders/${id}`, corps);

// --- Tableau de bord, rapports, journal (§5.10 à §5.13) --------------------

export const getTableauDeBord = (
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
) => get<DashboardStats>(`/dashboard${parametresPeriode(periode, options)}`);

export const getRapport = (
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
) => get<ReportData>(`/reports${parametresPeriode(periode, options)}`);

export const getLivreComptable = (
  periode: PeriodKey,
  options: { debut?: string; fin?: string; etablissement?: SelectionEtablissement } = {}
) => get<LivreComptable>(`/ledger${parametresPeriode(periode, options)}`);

export const getJournal = (filtres: { entite?: string; action?: string } = {}) => {
  const p = new URLSearchParams();
  if (filtres.entite) p.set("entite", filtres.entite);
  if (filtres.action) p.set("action", filtres.action);
  const q = p.toString();
  return get<AuditEntry[]>(`/audit${q ? `?${q}` : ""}`);
};

// --- Paramètres (§6) -------------------------------------------------------

export const getParametres = () =>
  get<{ entreprise?: EntrepriseSettings; caisse?: CaisseSettings }>("/settings");
export const enregistrerParametres = (cle: string, valeur: unknown) =>
  put<unknown>(`/settings/${cle}`, valeur);
