import { supabase } from "../lib/supabase";
import type {
  Profile, Product, Category, Pack, Supplier, Customer, Sale, CashSession,
  CashMovement, StockMovement, Purchase, Expense, Order, AuditEntry,
  DashboardStats, ReportData, Pole, PeriodKey, EntrepriseSettings, CaisseSettings,
} from "../types";

// ============================================================================
// Client de l'API EDEN.
// Chaque appel joint le jeton Supabase courant ; le serveur le vérifie puis
// applique les rôles. Aucune requête ne part directement vers Postgres depuis
// le navigateur : RLS bloque tout accès avec la clé publishable.
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

/** Construit `?periode=...&debut=...&fin=...&pole=...` en ignorant les vides. */
export function parametresPeriode(
  periode: PeriodKey,
  options: { debut?: string; fin?: string; pole?: Pole | "" } = {}
): string {
  const p = new URLSearchParams({ periode });
  if (periode === "personnalise" && options.debut && options.fin) {
    p.set("debut", options.debut);
    p.set("fin", options.fin);
  }
  if (options.pole) p.set("pole", options.pole);
  return `?${p.toString()}`;
}

// --- Profil et utilisateurs (§5.1) -----------------------------------------

export const getMonProfil = () => get<Profile>("/me");
export const getUtilisateurs = () => get<Profile[]>("/users");
export const creerUtilisateur = (corps: {
  email: string; password: string; fullName: string; role: string;
  pole?: Pole | null; poste?: string; telephone?: string; salaire?: number; dateEntree?: string;
}) => post<Profile>("/users", corps);
export const modifierUtilisateur = (id: string, corps: Partial<Profile> & { motif?: string }) =>
  patch<Profile>(`/users/${id}`, corps);
export const reinitialiserMotDePasse = (id: string, password: string) =>
  post<{ ok: boolean }>(`/users/${id}/password`, { password });

// --- Catalogue (§2, §3, §5.5) ----------------------------------------------

export const getCategories = () => get<Category[]>("/categories");
export const creerCategorie = (corps: Partial<Category>) => post<Category>("/categories", corps);
export const modifierCategorie = (id: number, corps: Partial<Category>) =>
  patch<Category>(`/categories/${id}`, corps);

export const getProduits = (options: { pole?: Pole | ""; tous?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (options.pole) p.set("pole", options.pole);
  if (options.tous) p.set("actif", "tous");
  const q = p.toString();
  return get<Product[]>(`/products${q ? `?${q}` : ""}`);
};
export const creerProduit = (corps: Partial<Product>) => post<Product>("/products", corps);
export const modifierProduit = (id: number, corps: Partial<Product> & { motif?: string }) =>
  patch<Product>(`/products/${id}`, corps);

export const getPacks = () => get<Pack[]>("/packs");
export const creerPack = (corps: Partial<Pack> & { items?: { productId: number; quantite: number }[] }) =>
  post<Pack>("/packs", corps);
export const modifierPack = (
  id: number,
  corps: Partial<Pack> & { items?: { productId: number; quantite: number }[] }
) => patch<Pack>(`/packs/${id}`, corps);

// --- Fournisseurs et clients (§5.6, §5.9) ----------------------------------

export const getFournisseurs = () => get<Supplier[]>("/suppliers");
export const creerFournisseur = (corps: Partial<Supplier>) => post<Supplier>("/suppliers", corps);
export const modifierFournisseur = (id: number, corps: Partial<Supplier>) =>
  patch<Supplier>(`/suppliers/${id}`, corps);

export const getClients = (recherche = "") =>
  get<Customer[]>(`/customers${recherche ? `?q=${encodeURIComponent(recherche)}` : ""}`);
export const getClient = (id: number) =>
  get<Customer & { ventes: Sale[]; commandes: Order[] }>(`/customers/${id}`);
export const creerClient = (corps: Partial<Customer>) => post<Customer>("/customers", corps);
export const modifierClient = (id: number, corps: Partial<Customer>) =>
  patch<Customer>(`/customers/${id}`, corps);

// --- Caisse (§5.3) ---------------------------------------------------------

export type CaisseCourante =
  (CashSession & { soldeTheorique: number; mouvements: CashMovement[] }) | null;

export const getCaisseCourante = (pole: Pole) => get<CaisseCourante>(`/cash/current?pole=${pole}`);
export const ouvrirCaisse = (corps: { pole: Pole; fondsInitial: number; notes?: string }) =>
  post<CashSession>("/cash/open", corps);
export const fermerCaisse = (corps: { sessionId: number; soldePhysique: number; notes?: string }) =>
  post<CashSession>("/cash/close", corps);
export const ajouterMouvementCaisse = (corps: {
  sessionId: number; type: string; montant: number; motif: string; paymentMethod?: string;
}) => post<CashMovement>("/cash/movements", corps);
export const getSessionsCaisse = (pole?: Pole) =>
  get<CashSession[]>(`/cash/sessions${pole ? `?pole=${pole}` : ""}`);

// --- Ventes (§5.2) ---------------------------------------------------------

export const getVentes = (periode: PeriodKey, options: { debut?: string; fin?: string; pole?: Pole | "" } = {}) =>
  get<Sale[]>(`/sales${parametresPeriode(periode, options)}`);
export const getVente = (id: number) => get<Sale>(`/sales/${id}`);
export const enregistrerVente = (corps: {
  pole: Pole;
  items: { productId?: number; packId?: number; quantite: number }[];
  paymentMethod: string;
  numeroTransaction?: string;
  remise?: number;
  customerId?: number | null;
}) => post<{ id: number; numeroRecu: string; total: number }>("/sales", corps);
export const annulerVente = (id: number, motif: string) =>
  post<Sale>(`/sales/${id}/cancel`, { motif });

// --- Stock (§5.5) ----------------------------------------------------------

export const getMouvementsStock = (productId?: number) =>
  get<StockMovement[]>(`/stock/movements${productId ? `?productId=${productId}` : ""}`);
export const getAlertesStock = () =>
  get<{
    ruptures: { id: number; nom: string; pole: Pole; quantite: number; seuilAlerte: number; unite: string }[];
    bientotEnRupture: { id: number; nom: string; pole: Pole; quantite: number; seuilAlerte: number; unite: string }[];
  }>("/stock/alerts");
export const ajusterStock = (corps: { productId: number; quantiteReelle: number; motif: string }) =>
  post<{ ok: boolean; ecart: number }>("/stock/adjust", corps);

// --- Achats (§5.6) ---------------------------------------------------------

export const getAchats = (periode: PeriodKey, options: { debut?: string; fin?: string } = {}) =>
  get<Purchase[]>(`/purchases${parametresPeriode(periode, options)}`);
export const getAchat = (id: number) => get<Purchase>(`/purchases/${id}`);
export const creerAchat = (corps: {
  supplierId?: number | null; pole: Pole; dateAchat?: string; montantPaye: number;
  paymentMethod: string; justificatif?: string; notes?: string;
  items: { productId?: number | null; libelle: string; quantite: number; prixUnitaire: number }[];
}) => post<{ id: number; numero: string; montantTotal: number }>("/purchases", corps);
export const reglerAchat = (id: number, montant: number) =>
  post<Purchase>(`/purchases/${id}/pay`, { montant });

// --- Dépenses (§5.7) -------------------------------------------------------

export const getDepenses = (periode: PeriodKey, options: { debut?: string; fin?: string; pole?: Pole | "" } = {}) =>
  get<Expense[]>(`/expenses${parametresPeriode(periode, options)}`);
export const creerDepense = (corps: {
  pole: Pole; categorie: string; montant: number; motif: string;
  dateDepense?: string; paymentMethod?: string; justificatif?: string;
}) => post<Expense>("/expenses", corps);
export const validerDepense = (id: number) => post<Expense>(`/expenses/${id}/validate`);

// --- Commandes infographie (§5.8) ------------------------------------------

export const getCommandes = (statut?: string) =>
  get<Order[]>(`/orders${statut ? `?statut=${statut}` : ""}`);
export const creerCommande = (corps: {
  customerId?: number | null; customerNom: string; customerTelephone?: string;
  typePrestation: string; description?: string; quantite: number; prixUnitaire: number;
  acompte: number; dateLivraisonPrevue?: string; technicienId?: string | null;
}) => post<Order>("/orders", corps);
export const modifierCommande = (id: number, corps: Partial<Order> & { motif?: string }) =>
  patch<Order>(`/orders/${id}`, corps);

// --- Tableau de bord, rapports, journal (§5.10 à §5.13) --------------------

export const getTableauDeBord = (periode: PeriodKey, options: { debut?: string; fin?: string } = {}) =>
  get<DashboardStats>(`/dashboard${parametresPeriode(periode, options)}`);
export const getRapport = (periode: PeriodKey, options: { debut?: string; fin?: string } = {}) =>
  get<ReportData>(`/reports${parametresPeriode(periode, options)}`);
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
