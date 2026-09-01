import { supabase } from "../lib/supabase";

export interface Business {
  id: number;
  name: string;
  ownerUid: string;
  createdAt: string; // or Date
}

export interface Program {
  id: number;
  businessId: number;
  name: string;
  visitsRequired: number;
  rewardDescription: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  businessId: number;
  code: string;
  name: string;
  phone: string;
  visits: number;
  points: number;
  stamps: number;
  cardNumber?: string;
  rewardStatus: "pending" | "available" | "redeemed";
  createdAt: string;
  lastVisitDate?: string | null;
  // Present only on responses that compute loyalty (getCustomer, visit validation)
  loyaltyMode?: "visits" | "points" | "stamps";
  progress?: number;
  unlockedRewards?: Reward[];
  tier?: string | null;
}

export interface Visit {
  id: number;
  customerId: string;
  businessId: number;
  serviceId?: number;
  serviceName?: string;
  amount?: number;
  points: number;
  tip?: number;
  discount?: number;
  offered?: boolean;
  date: string;
  validatedBy: string;
}

export interface Employee {
  id: number;
  businessId: number;
  name: string;
  role: string;
  phone: string;
  status: string;
  avatarUrl?: string;
  createdAt: string;
}

const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not authenticated");
  const token = data.session.access_token;

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  
  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }

  return response.json();
};

export const getBusiness = async (userId: string) => {
  return fetchApi('/business');
};

export const createBusiness = async (userId: string, name: string) => {
  return fetchApi('/business', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
};

export const getPrograms = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/programs`);
};

export const createProgram = async (businessId: number, data: Omit<Program, "id" | "businessId" | "createdAt">) => {
  return fetchApi(`/businesses/${businessId}/programs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const getCustomers = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/customers`);
};

// Recherche serveur d'un client par téléphone (utilisée par le staff, qui ne reçoit
// pas les numéros dans la liste). Renvoie le client trouvé (sans son numéro pour le
// staff) ou null.
export const lookupCustomerByPhone = async (businessId: number, phone: string): Promise<Customer | null> => {
  return fetchApi(`/businesses/${businessId}/customers/lookup?phone=${encodeURIComponent(phone)}`);
};

export const createCustomer = async (businessId: number, data: { name: string; phone: string; hasCard?: boolean }) => {
  return fetchApi(`/businesses/${businessId}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

// Attribue (ou remplace) une carte de fidélité à un client. Numéro auto si non fourni.
export const assignCard = async (customerId: string, cardNumber?: string): Promise<Customer> => {
  return fetchApi(`/customers/${customerId}/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cardNumber ? { cardNumber } : {}),
  });
};

export const getCustomer = async (customerId: string) => {
  const response = await fetch(`/api/customers/${customerId}`);
  if (!response.ok) throw new Error("Not found");
  return response.json();
};

export interface VisitItem { serviceId?: number; variantId?: number; productId?: number; employeeId?: number; offered?: boolean; }

export const recordVisit = async (customerId: string, items: VisitItem[], extras: { tip?: number; discount?: number } = {}) => {
  return fetchApi(`/customers/${customerId}/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, ...extras }),
  });
};

export const getVisits = async (customerId: string) => {
  const response = await fetch(`/api/customers/${customerId}/visits`);
  if (!response.ok) throw new Error("Not found");
  return response.json();
};

export interface SalesSummary {
  prestations: number;   // nombre de prestations réalisées (lignes)
  tickets: number;       // nombre de ventes (tickets)
  gross: number;         // chiffre d'affaires brut des prestations (FCFA)
  discounts: number;     // total des réductions
  tips: number;          // total des pourboires
  offeredCount: number;  // nombre de prestations offertes
  offeredValue: number;  // valeur des prestations offertes
  net: number;           // revenu net (brut - réductions)
  collected: number;     // total encaissé (net + pourboires)
  series: { date: string; total: number }[];
  topServices: { name: string; count: number; amount: number }[];
  topEmployees: { employeeId: number; name: string; count: number; amount: number }[]; // employé du mois
}

export interface Product {
  id: number;
  businessId: number;
  name: string;
  category?: string;
  unitLabel: string;      // ex: boîte, flacon
  usesPerUnit: number;    // ex: 1 boîte = 6 utilisations
  stockUses: number;      // stock restant, en utilisations
  lowStockUses: number;   // seuil d'alerte (en utilisations)
  price?: number;         // FCFA (centimes) — prix de vente à l'unité si vendable à la caisse
  createdAt: string;
}

export interface ServiceProduct {
  id: number;
  serviceId: number;
  productId: number;
  usesPerPrestation: number;
}

// Synthèse des ventes sur une période (source unique = ventes enregistrées).
export const getSalesSummary = async (businessId: number, from?: string, to?: string): Promise<SalesSummary> => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchApi(`/businesses/${businessId}/sales-summary${qs ? `?${qs}` : ""}`);
};

export const redeemReward = async (customerId: string, rewardId: number) => {
  return fetchApi(`/customers/${customerId}/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rewardId }),
  });
};

export const getEmployees = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/employees`);
};

// --- Inventaire / stocks (admin) ---
export const getProducts = async (businessId: number): Promise<Product[]> => {
  return fetchApi(`/businesses/${businessId}/products`);
};
export const createProduct = async (businessId: number, data: Partial<Product>): Promise<Product> => {
  return fetchApi(`/businesses/${businessId}/products`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
};
export const updateProduct = async (productId: number, data: Partial<Product>): Promise<Product> => {
  return fetchApi(`/products/${productId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
};
export const deleteProduct = async (productId: number) => {
  return fetchApi(`/products/${productId}`, { method: 'DELETE' });
};
// Mouvement de stock tracé (delta en utilisations : positif = réappro, négatif = vente
// directe/casse/perte) — accessible au staff. reason optionnel (sinon déduit du signe).
export const restockProduct = async (productId: number, delta: number, reason?: string): Promise<Product> => {
  return fetchApi(`/products/${productId}/restock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta, reason }),
  });
};
export interface StockMovement {
  id: number; productId: number; delta: number; reason: string; createdBy?: string; createdAt: string;
  productName?: string; unitLabel?: string; createdByName?: string | null;
}
export const getProductMovements = async (productId: number): Promise<StockMovement[]> => {
  return fetchApi(`/products/${productId}/movements`);
};
// Historique complet, tous produits confondus — réservé admin.
export const getStockMovements = async (businessId: number): Promise<StockMovement[]> => {
  return fetchApi(`/businesses/${businessId}/stock-movements`);
};
export const getServiceProducts = async (businessId: number): Promise<ServiceProduct[]> => {
  return fetchApi(`/businesses/${businessId}/service-products`);
};
export const linkServiceProduct = async (businessId: number, data: { serviceId: number; productId: number; usesPerPrestation?: number }): Promise<ServiceProduct> => {
  return fetchApi(`/businesses/${businessId}/service-products`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
};
export const unlinkServiceProduct = async (linkId: number) => {
  return fetchApi(`/service-products/${linkId}`, { method: 'DELETE' });
};

// --- Notifications in-app (cloche) ---
export interface AppNotifications {
  inactiveClients: { id: string; name: string; code: string; days: number }[];
  lowStock: { id: number; name: string; unitLabel: string; usesPerUnit: number; stockUses: number; unitsLeft: number }[];
}
export const getNotifications = async (businessId: number): Promise<AppNotifications> => {
  return fetchApi(`/businesses/${businessId}/notifications`);
};

// --- Site de réservation publique (backend prêt, désactivé en production tant
// que non validé — voir PUBLIC_BOOKING_ENABLED) ---
export interface PublicService {
  id: number; name: string; categoryId?: number; category?: string;
  price: number; duration: number; description?: string;
}
export interface PublicCatalog {
  categories: { id: number; name: string }[];
  services: PublicService[];
  hours: Record<number, { open: string; close: string } | null>;
}
export const getPublicCatalog = async (): Promise<PublicCatalog> => {
  const r = await fetch(`/api/public/catalog`);
  if (!r.ok) throw new Error("Catalogue indisponible.");
  return r.json();
};
export const getPublicEmployees = async (): Promise<{ id: number; name: string; role: string }[]> => {
  const r = await fetch(`/api/public/employees`);
  if (!r.ok) throw new Error("Liste des employés indisponible.");
  return r.json();
};
export const getPublicSlots = async (date: string, duration: number, employeeId?: number): Promise<{ slots: string[]; closed?: boolean }> => {
  const params = new URLSearchParams({ date, duration: String(duration) });
  if (employeeId) params.set("employeeId", String(employeeId));
  const r = await fetch(`/api/public/slots?${params.toString()}`);
  if (!r.ok) throw new Error("Créneaux indisponibles.");
  return r.json();
};
export const createPublicAppointment = async (data: {
  serviceIds: number[]; employeeId?: number; date: string; time: string; name: string; phone: string; notes?: string;
}): Promise<{ success: boolean; summary: { date: string; time: string; endTime: string; services: string[]; employeeName: string } }> => {
  const r = await fetch(`/api/public/appointments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || "Échec de la réservation.");
  return body;
};

// --- Avis clients (QR -> page publique -> panneau admin) ---
export interface Review {
  id: number;
  businessId: number;
  rating: number;
  comment?: string;
  customerName?: string;
  customerPhone?: string;
  createdAt: string;
}

// Public (page /avis, aucune session requise) : identifie l'unique entreprise.
export const getPublicBusiness = async (): Promise<{ id: number; name: string }> => {
  const response = await fetch(`/api/public/business`);
  if (!response.ok) throw new Error("Introuvable.");
  return response.json();
};

// Public : dépôt d'un avis, aucune session requise.
export const submitReview = async (businessId: number, data: { rating: number; comment?: string; customerName?: string; customerPhone?: string }): Promise<Review> => {
  const response = await fetch(`/api/businesses/${businessId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Échec de l'envoi.");
  }
  return response.json();
};

// Admin : liste des avis reçus.
export const getReviews = async (businessId: number): Promise<Review[]> => {
  return fetchApi(`/businesses/${businessId}/reviews`);
};

export const createEmployee = async (businessId: number, data: { name: string, role: string, phone: string, avatarUrl?: string }) => {
  return fetchApi(`/businesses/${businessId}/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getServices = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/services`);
};

export const createService = async (businessId: number, data: any) => {
  return fetchApi(`/businesses/${businessId}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const updateService = async (serviceId: number, data: any) => {
  return fetchApi(`/services/${serviceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const deleteService = async (serviceId: number) => {
  return fetchApi(`/services/${serviceId}`, { method: 'DELETE' });
};

export const deleteEmployee = async (employeeId: number) => {
  return fetchApi(`/employees/${employeeId}`, { method: 'DELETE' });
};

export const getTimeLogs = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/time-logs`);
};

export const clockIn = async (employeeId: number, data: { selfieUrl?: string; locationLat?: string; locationLng?: string; livenessConfirmed?: string }) => {
  return fetchApi(`/employees/${employeeId}/clock-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const clockOut = async (employeeId: number) => {
  return fetchApi(`/employees/${employeeId}/clock-out`, {
    method: 'POST',
  });
};

export const getEmployeeStatus = async (employeeId: number): Promise<{ clockedIn: boolean; clockInTime: string | null }> => {
  return fetchApi(`/employees/${employeeId}/current-status`);
};

export const getAppointments = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/appointments`);
};

export const createAppointment = async (businessId: number, data: any) => {
  return fetchApi(`/businesses/${businessId}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

// --- Categories ---
export interface Category { id: number; businessId: number; name: string; createdAt: string; }

export const getCategories = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/categories`);
};

export const createCategory = async (businessId: number, name: string) => {
  return fetchApi(`/businesses/${businessId}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
};

export const deleteCategory = async (categoryId: number) => {
  return fetchApi(`/categories/${categoryId}`, { method: 'DELETE' });
};

// --- Service variants ---
export interface ServiceVariant {
  id: number;
  serviceId: number;
  name: string;
  price: number; // cents
  duration?: number;
  createdAt: string;
}

export const getVariants = async (serviceId: number) => {
  return fetchApi(`/services/${serviceId}/variants`);
};

export const createVariant = async (serviceId: number, data: { name: string; price: number; duration?: number }) => {
  return fetchApi(`/services/${serviceId}/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const deleteVariant = async (variantId: number) => {
  return fetchApi(`/variants/${variantId}`, { method: 'DELETE' });
};

// --- Accounting / transactions ---
export interface Transaction {
  id: number;
  businessId: number;
  type: "credit" | "debit";
  amount: number; // FCFA
  category?: string;
  description?: string;
  date: string;
  createdAt: string;
}

export const getTransactions = async (businessId: number, from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchApi(`/businesses/${businessId}/transactions${qs ? `?${qs}` : ""}`);
};

export const createTransaction = async (businessId: number, data: Omit<Transaction, "id" | "businessId" | "createdAt">) => {
  return fetchApi(`/businesses/${businessId}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const updateTransaction = async (transactionId: number, data: Partial<Omit<Transaction, "id" | "businessId" | "createdAt">>) => {
  return fetchApi(`/transactions/${transactionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const deleteTransaction = async (transactionId: number) => {
  return fetchApi(`/transactions/${transactionId}`, { method: 'DELETE' });
};

// --- Staff / members ---
export interface Member {
  id: number;
  businessId: number;
  email: string;
  uid?: string;
  name?: string;
  role: "admin" | "staff" | "employee";
  employeeId?: number; // pour le rôle 'employee' : à quel employé du planning ce login correspond
  createdAt: string;
}

export const getMembers = async (businessId: number) => {
  return fetchApi(`/businesses/${businessId}/members`);
};

export const createMember = async (businessId: number, data: { email: string; password: string; name?: string; role?: "admin" | "staff" | "employee"; employeeId?: number }) => {
  return fetchApi(`/businesses/${businessId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const updateMemberRole = async (memberId: number, role: "admin" | "staff" | "employee", employeeId?: number) => {
  return fetchApi(`/members/${memberId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, employeeId }),
  });
};

export const deleteMember = async (memberId: number) => {
  return fetchApi(`/members/${memberId}`, { method: 'DELETE' });
};

// --- Loyalty engine: mode, rewards, tiers ---
export type LoyaltyMode = "visits" | "points" | "stamps";

export const getLoyaltySettings = async (businessId: number): Promise<{ mode: LoyaltyMode }> => {
  return fetchApi(`/businesses/${businessId}/loyalty-settings`);
};

export const updateLoyaltySettings = async (businessId: number, mode: LoyaltyMode) => {
  return fetchApi(`/businesses/${businessId}/loyalty-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
};

export interface Reward {
  id: number;
  businessId: number;
  label: string;
  threshold: number;
  type: "discount_amount" | "discount_percent" | "free_service" | "product" | "custom";
  value?: string;
  active: boolean;
  createdAt: string;
}

export const getRewards = async (businessId: number): Promise<Reward[]> => fetchApi(`/businesses/${businessId}/rewards`);

export const createReward = async (businessId: number, data: Omit<Reward, "id" | "businessId" | "active" | "createdAt">) => {
  return fetchApi(`/businesses/${businessId}/rewards`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
};

export const updateReward = async (rewardId: number, data: Partial<Reward>) => {
  return fetchApi(`/rewards/${rewardId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
};

export const deleteReward = async (rewardId: number) => fetchApi(`/rewards/${rewardId}`, { method: 'DELETE' });

export interface Tier {
  id: number;
  businessId: number;
  name: string;
  threshold: number;
  perks?: string;
  windowDays?: number;
  createdAt: string;
}

export const getTiers = async (businessId: number): Promise<Tier[]> => fetchApi(`/businesses/${businessId}/tiers`);

export const createTier = async (businessId: number, data: Omit<Tier, "id" | "businessId" | "createdAt">) => {
  return fetchApi(`/businesses/${businessId}/tiers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
};

export const deleteTier = async (tierId: number) => fetchApi(`/tiers/${tierId}`, { method: 'DELETE' });
