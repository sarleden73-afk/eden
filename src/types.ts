// Types partagés entre l'API Express et le frontend React.
// Les colonnes Postgres sont en snake_case ; ces types sont en camelCase, la
// conversion est faite par src/lib/caseConvert.ts aux frontières de l'API.

export type UserRole = "admin" | "responsable" | "caissier" | "technicien";
export type PaymentMethod = "especes" | "mobile_money" | "carte" | "virement" | "autre";
export type SaleStatus = "validee" | "annulee";
export type OrderStatus = "en_attente" | "en_cours" | "termine" | "livre" | "annule";
export type CashSessionStatus = "ouverte" | "fermee";
export type StockMovementType = "entree" | "sortie" | "ajustement";
export type CashMovementType =
  | "vente" | "entree" | "depense" | "remboursement" | "retrait" | "depot" | "autre";
export type ExpenseCategory =
  | "electricite" | "internet" | "loyer" | "salaires" | "transport" | "carburant"
  | "achat_marchandises" | "matieres_premieres" | "entretien" | "reparation"
  | "fournitures_bureau" | "autre";
export type ItemKind = "produit" | "prestation";

/**
 * Établissement de l'entreprise (papeterie, restaurant…).
 *
 * Chaque écriture — vente, caisse, stock, achat, dépense, commande — appartient
 * à un et un seul établissement. Ils ne sont jamais additionnés implicitement :
 * la vue consolidée est un choix explicite du propriétaire.
 */
export interface Establishment {
  id: number;
  nom: string;
  slug: string;
  activite: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  /** Couleur d'accent, pour repérer d'un coup d'œil où l'on travaille. */
  couleur: string;
  ordre: number;
  actif: boolean;
}

/**
 * Sélection courante dans l'interface : un établissement précis, ou la vue
 * consolidée. `"tous"` n'est proposé qu'aux profils qui y ont droit.
 */
export type SelectionEtablissement = number | "tous";

// --- Libellés d'affichage --------------------------------------------------
// Centralisés ici pour que l'API (rapports, exports) et l'UI ne divergent pas.

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Propriétaire",
  responsable: "Responsable",
  caissier: "Caissier / Agent",
  technicien: "Technicien",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  carte: "Carte bancaire",
  virement: "Virement bancaire",
  autre: "Autre",
};

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  electricite: "Électricité",
  internet: "Internet",
  loyer: "Loyer",
  salaires: "Salaires",
  transport: "Transport",
  carburant: "Carburant",
  achat_marchandises: "Achat de marchandises",
  matieres_premieres: "Matières premières",
  entretien: "Entretien",
  reparation: "Réparation",
  fournitures_bureau: "Fournitures de bureau",
  autre: "Autres dépenses",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  en_attente: "En attente",
  en_cours: "En cours",
  termine: "Terminé",
  livre: "Livré",
  annule: "Annulé",
};

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  vente: "Vente",
  entree: "Entrée d'argent",
  depense: "Dépense",
  remboursement: "Remboursement",
  retrait: "Retrait",
  depot: "Dépôt",
  autre: "Autre",
};

/** Les rôles autorisés à changer d'établissement (§5.1). */
export const ROLES_MULTI_ETABLISSEMENTS: UserRole[] = ["admin", "responsable"];

// --- Entités ---------------------------------------------------------------

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  /** null = accès à tous les établissements (propriétaire, responsable transversal). */
  establishmentId: number | null;
  etablissementNom?: string | null;
  poste: string | null;
  telephone: string | null;
  salaire: number | null;
  dateEntree: string | null;
  actif: boolean;
  createdAt: string;
}

export interface Supplier {
  id: number;
  nom: string;
  contact: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  notes: string | null;
  actif: boolean;
}

export interface Category {
  id: number;
  nom: string;
  establishmentId: number;
  kind: ItemKind;
  ordre: number;
  actif: boolean;
}

export interface Product {
  id: number;
  nom: string;
  description: string | null;
  categoryId: number | null;
  categorieNom?: string;
  establishmentId: number;
  kind: ItemKind;
  prixVente: number;
  prixAchat: number;
  unite: string;
  gereStock: boolean;
  quantite: number;
  seuilAlerte: number;
  supplierId: number | null;
  actif: boolean;
}

export interface PackItem {
  id: number;
  packId: number;
  productId: number;
  quantite: number;
  produitNom?: string;
  prixVente?: number;
}

export interface Pack {
  id: number;
  nom: string;
  description: string | null;
  establishmentId: number;
  prixVente: number;
  actif: boolean;
  items?: PackItem[];
}

/** Les clients sont communs à tous les établissements (§5.9). */
export interface Customer {
  id: number;
  nom: string;
  telephone: string | null;
  adresse: string | null;
  notes: string | null;
  createdAt: string;
  totalDepense?: number;
  nbAchats?: number;
}

export interface CashSession {
  id: number;
  establishmentId: number;
  etablissementNom?: string;
  statut: CashSessionStatus;
  fondsInitial: number;
  openedBy: string;
  openedByNom?: string;
  openedAt: string;
  closedBy: string | null;
  closedByNom?: string;
  closedAt: string | null;
  soldeTheorique: number | null;
  soldePhysique: number | null;
  ecart: number | null;
  notes: string | null;
}

export interface CashMovement {
  id: number;
  sessionId: number;
  type: CashMovementType;
  montant: number;
  motif: string | null;
  paymentMethod: PaymentMethod;
  saleId: number | null;
  expenseId: number | null;
  createdBy: string | null;
  createdByNom?: string;
  createdAt: string;
}

export interface SaleItem {
  id?: number;
  saleId?: number;
  productId: number | null;
  packId: number | null;
  libelle: string;
  quantite: number;
  prixUnitaire: number;
  prixAchatUnitaire?: number;
  montant: number;
}

export interface Sale {
  id: number;
  numeroRecu: string;
  establishmentId: number;
  etablissementNom?: string;
  sessionId: number | null;
  customerId: number | null;
  customerNom?: string;
  vendeurId: string;
  vendeurNom?: string;
  paymentMethod: PaymentMethod;
  numeroTransaction: string | null;
  sousTotal: number;
  remise: number;
  total: number;
  coutTotal: number;
  statut: SaleStatus;
  motifAnnulation: string | null;
  annulePar: string | null;
  annuleLe: string | null;
  createdAt: string;
  items?: SaleItem[];
}

export interface StockMovement {
  id: number;
  productId: number;
  produitNom?: string;
  type: StockMovementType;
  quantite: number;
  quantiteAvant: number;
  quantiteApres: number;
  motif: string | null;
  refType: string | null;
  refId: number | null;
  createdBy: string | null;
  createdByNom?: string;
  createdAt: string;
}

export interface PurchaseItem {
  id?: number;
  purchaseId?: number;
  productId: number | null;
  libelle: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

export interface Purchase {
  id: number;
  numero: string;
  supplierId: number | null;
  fournisseurNom?: string;
  establishmentId: number;
  etablissementNom?: string;
  dateAchat: string;
  montantTotal: number;
  montantPaye: number;
  montantRestant: number;
  paymentMethod: PaymentMethod;
  effectuePar: string | null;
  effectueParNom?: string;
  justificatif: string | null;
  notes: string | null;
  createdAt: string;
  items?: PurchaseItem[];
}

export interface Expense {
  id: number;
  establishmentId: number;
  etablissementNom?: string;
  categorie: ExpenseCategory;
  montant: number;
  motif: string;
  dateDepense: string;
  paymentMethod: PaymentMethod;
  effectuePar: string | null;
  effectueParNom?: string;
  validePar: string | null;
  valideParNom?: string;
  valideLe: string | null;
  justificatif: string | null;
  sessionId: number | null;
  createdAt: string;
}

export interface Order {
  id: number;
  numero: string;
  establishmentId: number;
  customerId: number | null;
  customerNom: string;
  customerTelephone: string | null;
  typePrestation: string;
  description: string | null;
  quantite: number;
  prixUnitaire: number;
  montantTotal: number;
  acompte: number;
  reste: number;
  dateCommande: string;
  dateLivraisonPrevue: string | null;
  statut: OrderStatus;
  technicienId: string | null;
  technicienNom?: string;
  createdAt: string;
}

/** Le journal de traçabilité est commun à tous les établissements (§5.10). */
export interface AuditEntry {
  id: number;
  userId: string | null;
  userNom: string | null;
  action: string;
  entite: string;
  entiteId: string | null;
  motif: string | null;
  avant: unknown;
  apres: unknown;
  createdAt: string;
}

export interface EntrepriseSettings {
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  niu: string;
  logoUrl: string;
  devise: string;
}

export interface CaisseSettings {
  fondsInitialParDefaut: number;
  inactiviteMinutes: number;
}

// --- Tableau de bord et rapports (§5.11, §5.12) ----------------------------

/** Chiffres d'un établissement sur la période. */
export interface LigneEtablissement {
  establishmentId: number;
  nom: string;
  couleur: string;
  ca: number;
  cout: number;
  marge: number;
  nbVentes: number;
  depenses: number;
  resultat: number;
}

export interface DashboardStats {
  /**
   * Vrai pour les rôles à consultation limitée (§5.1 : caissier, technicien).
   * Les chiffres portent alors sur leur seule activité, et marge, dépenses et
   * bénéfice ne sont pas transmis.
   */
  restreint: boolean;
  /** Établissement affiché ; null = vue consolidée, choisie explicitement. */
  etablissementId: number | null;
  /** Nom de l'établissement affiché, ou « Tous les établissements ». */
  etablissementNom: string;
  ca: number;
  nbVentes: number;
  depenses: number;
  margeBrute: number;
  beneficeEstimatif: number;
  /**
   * Détail par établissement. Une seule ligne quand un établissement est
   * sélectionné ; toutes en vue consolidée — jamais fondues ensemble.
   */
  parEtablissement: LigneEtablissement[];
  caisses: {
    establishmentId: number;
    etablissementNom: string;
    sessionId: number;
    ouvertePar: string;
    ouverteA: string;
    soldeTheorique: number;
  }[];
  ruptures: { id: number; nom: string; quantite: number; seuilAlerte: number }[];
  bientotEnRupture: { id: number; nom: string; quantite: number; seuilAlerte: number }[];
  /**
   * Série journalière. `valeurs` est indexé par identifiant d'établissement
   * (en chaîne), ce qui permet au graphique de tracer une barre par
   * établissement sans connaître leur nombre à l'avance.
   */
  serie: { date: string; depenses: number; valeurs: Record<string, number> }[];
}

export interface ReportData {
  periode: { debut: string; fin: string; libelle: string };
  etablissement: { id: number | null; nom: string };
  parEtablissement: LigneEtablissement[];
  caParProduit: { produit: string; etablissement: string; quantite: number; ca: number; marge: number }[];
  caParEmploye: { employe: string; role: UserRole; nbVentes: number; ca: number }[];
  caParPaiement: { methode: PaymentMethod; montant: number; nbVentes: number }[];
  depensesParCategorie: { categorie: ExpenseCategory; montant: number; nb: number }[];
  achats: { total: number; paye: number; restant: number; nb: number };
  totaux: {
    ca: number;
    coutMarchandises: number;
    margeBrute: number;
    depenses: number;
    resultat: number;
    nbVentes: number;
    panierMoyen: number;
  };
  meilleuresVentes: { produit: string; quantite: number; ca: number }[];
  faiblesVentes: { produit: string; quantite: number; ca: number }[];
  ecartsCaisse: {
    sessionId: number;
    etablissement: string;
    date: string;
    theorique: number;
    physique: number;
    ecart: number;
    responsable: string;
  }[];
}

/** Périodes proposées au tableau de bord et aux rapports (§5.11). */
export type PeriodKey = "jour" | "semaine" | "mois" | "annee" | "personnalise";
