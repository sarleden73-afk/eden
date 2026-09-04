import { randomUUID } from "node:crypto";
import express, { Response } from "express";
import { supabase, creerClientAuth } from "./lib/supabase-server.js";
import { requireAuth, AuthRequest } from "./middleware/auth.js";
import { toCamelCase, toCamelCaseArray, toSnakeCase } from "./lib/caseConvert.js";
import type {
  UserRole, PaymentMethod, DashboardStats, ReportData, ExpenseCategory,
  LigneEtablissement,
} from "./types.js";

// ============================================================================
// API EDEN — plateforme multi-établissements
// ----------------------------------------------------------------------------
// Toutes les routes sont montées sous /api et exigent une session Supabase
// valide (requireAuth), puis un profil actif (loadProfile). Les autorisations
// du §5.1 sont appliquées ici, côté serveur : le frontend masque les écrans
// interdits, mais c'est cette couche qui fait foi.
//
// Cloisonnement par établissement
// -------------------------------
// Chaque écriture appartient à un établissement. Un profil rattaché à un
// établissement (caissier, technicien) ne peut ni lire ni écrire ailleurs, et
// ne peut pas demander la vue consolidée. Un profil sans rattachement
// (propriétaire, responsable transversal) accède à tous les établissements et
// choisit explicitement d'en voir un seul ou le cumul.
// ============================================================================

// Libellés dupliqués côté serveur : le module de types est partagé avec le
// navigateur, mais l'importer ici pour deux tables de correspondance ferait
// entrer du code d'interface dans la fonction serverless.
const EXPENSE_LABELS_SERVEUR: Record<string, string> = {
  electricite: "Électricité", internet: "Internet", loyer: "Loyer",
  salaires: "Salaires", transport: "Transport", carburant: "Carburant",
  achat_marchandises: "Achat de marchandises", matieres_premieres: "Matières premières",
  entretien: "Entretien", reparation: "Réparation",
  fournitures_bureau: "Fournitures de bureau", autre: "Autres dépenses",
};

const CASH_MOVEMENT_LABELS_SERVEUR: Record<string, string> = {
  entree: "Entrée d'argent", retrait: "Retrait", depot: "Dépôt",
  remboursement: "Remboursement", autre: "Autre mouvement",
};

const TOUS: UserRole[] = ["admin", "responsable", "caissier", "technicien"];
const ENCAISSENT: UserRole[] = ["admin", "responsable", "caissier", "technicien"];
const VALIDENT: UserRole[] = ["admin", "responsable"];
const ADMIN: UserRole[] = ["admin"];

interface Profil {
  id: string;
  fullName: string;
  role: UserRole;
  /** null = accès à tous les établissements. */
  establishmentId: number | null;
  /** Écrans autorisés ; null = ceux du rôle. */
  permissions: string[] | null;
  actif: boolean;
}

interface Req extends AuthRequest {
  profil?: Profil;
}

async function loadProfile(req: Req, res: Response, next: express.NextFunction) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, establishment_id, permissions, actif")
    .eq("id", req.user!.uid)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res.status(403).json({
      error: "Aucun profil n'est associé à ce compte. Contactez l'administrateur.",
    });
  }
  if (!data.actif) return res.status(403).json({ error: "Ce compte a été désactivé." });

  req.profil = {
    id: data.id,
    fullName: data.full_name,
    role: data.role as UserRole,
    establishmentId: data.establishment_id as number | null,
    permissions: (data.permissions as string[] | null) ?? null,
    actif: data.actif,
  };
  next();
}

function requireRole(...roles: UserRole[]) {
  return (req: Req, res: Response, next: express.NextFunction) => {
    if (!roles.includes(req.profil!.role)) {
      return res.status(403).json({ error: "Votre rôle ne vous autorise pas cette opération." });
    }
    next();
  };
}

// --- Droits par écran -------------------------------------------------------
// Le rôle donne une base, que l'administrateur affine personne par personne.
// Caissier et technicien partagent exactement les mêmes accès : dans les faits
// ils se remplacent l'un l'autre à la caisse, et leur donner des droits
// différents empêcherait cette souplesse.

export const ECRANS = [
  "tableau-de-bord", "vente", "caisse", "ventes", "commandes", "pointage",
  "catalogue", "stocks", "achats", "depenses",
  "rapports", "comptabilite", "personnel", "etablissements", "journal",
  "corbeille", "parametres",
] as const;
type EcranCle = (typeof ECRANS)[number];

/**
 * Base du personnel de terrain.
 *
 * « achats » y figure sur décision de la direction : le stock et les achats
 * forment un seul écran, et celui qui constate une rupture est aussi celui qui
 * passe la commande au fournisseur. Cela lui donne accès aux prix d'achat et
 * aux dettes fournisseurs — c'est assumé, et retirable personne par personne
 * depuis la grille « Écrans autorisés » de l'écran Personnel.
 */
const ECRANS_TERRAIN: EcranCle[] = [
  "tableau-de-bord", "vente", "caisse", "ventes", "commandes", "pointage",
  "catalogue", "stocks", "achats", "depenses",
];

const ECRANS_PAR_ROLE: Record<UserRole, EcranCle[]> = {
  admin: [...ECRANS],
  responsable: [
    "tableau-de-bord", "vente", "caisse", "ventes", "commandes", "pointage",
    "catalogue", "stocks", "achats", "depenses", "rapports", "journal", "personnel",
  ],
  caissier: ECRANS_TERRAIN,
  technicien: ECRANS_TERRAIN,
};

/**
 * Personnel de terrain : caissier et technicien.
 *
 * Les deux se remplacent l'un l'autre au comptoir et ont donc exactement les
 * mêmes droits. Ils ne consultent que leurs propres opérations, et ni marge ni
 * résultat ne leur sont transmis — ces chiffres ne quittent pas le serveur,
 * plutôt que d'être seulement masqués à l'écran.
 */
const personnelDeTerrain = (p: Profil) => p.role === "caissier" || p.role === "technicien";

/** Écrans réellement accessibles : liste personnalisée, sinon base du rôle. */
function ecransDe(profil: Profil): EcranCle[] {
  const base = ECRANS_PAR_ROLE[profil.role];
  if (!Array.isArray(profil.permissions) || profil.permissions.length === 0) return base;

  // Une liste personnalisée peut restreindre, jamais promouvoir : on
  // l'intersecte toujours avec ce que le rôle permet.
  const autorises = new Set(base);
  return (profil.permissions as EcranCle[]).filter((e) => autorises.has(e));
}

/**
 * Correspondance chemin → écran, appliquée à toutes les routes d'un coup.
 *
 * Vérifier à un seul endroit vaut mieux que parsemer des gardes : une route
 * ajoutée plus tard sans garde resterait ouverte à tous sans que personne ne
 * s'en aperçoive. Les entrées sans `methodes` couvrent toutes les méthodes ;
 * les lectures partagées (liste des employés pour assigner une commande, liste
 * des établissements pour le sélecteur) restent volontairement ouvertes.
 */
const ECRAN_PAR_CHEMIN: { motif: RegExp; ecran: EcranCle; methodes?: string[] }[] = [
  { motif: /^\/sales$/, ecran: "vente", methodes: ["POST"] },
  { motif: /^\/sales/, ecran: "ventes" },
  { motif: /^\/cash/, ecran: "caisse" },
  { motif: /^\/(products|packs|categories)/, ecran: "catalogue" },
  { motif: /^\/stock/, ecran: "stocks" },
  { motif: /^\/(purchases|suppliers)/, ecran: "achats" },
  { motif: /^\/expenses/, ecran: "depenses" },
  { motif: /^\/orders/, ecran: "commandes" },
  { motif: /^\/reports/, ecran: "rapports" },
  { motif: /^\/ledger/, ecran: "comptabilite" },
  { motif: /^\/pointages/, ecran: "personnel" },
  { motif: /^\/pointage/, ecran: "pointage" },
  { motif: /^\/users/, ecran: "personnel", methodes: ["POST", "PATCH", "DELETE"] },
  { motif: /^\/establishments/, ecran: "etablissements", methodes: ["POST", "PATCH"] },
  { motif: /^\/settings/, ecran: "parametres", methodes: ["PUT"] },
  { motif: /^\/audit/, ecran: "journal" },
  { motif: /^\/corbeille/, ecran: "corbeille" },
  { motif: /^\/dashboard/, ecran: "tableau-de-bord" },
];

function verifierEcran(req: Req, res: Response, next: express.NextFunction) {
  const regle = ECRAN_PAR_CHEMIN.find(
    (r) => r.motif.test(req.path) && (!r.methodes || r.methodes.includes(req.method))
  );
  if (!regle) return next();

  if (!ecransDe(req.profil!).includes(regle.ecran)) {
    return res.status(403).json({
      error: "Cet écran ne vous est pas accessible. Demandez l'accès à l'administrateur.",
    });
  }
  next();
}

// --- Portée par établissement ----------------------------------------------

/** Le profil peut-il voir plusieurs établissements et le cumul ? */
const estTransversal = (p: Profil) => p.establishmentId === null;

/**
 * Résout l'établissement demandé en le confrontant à la portée du profil.
 *
 * Retourne `null` pour la vue consolidée, un identifiant sinon. Un profil
 * rattaché est ramené de force à son établissement, quelle que soit la valeur
 * envoyée : c'est ce qui empêche un caissier de lire les ventes du restaurant
 * en modifiant simplement l'URL.
 */
// Les deux helpers renvoient toujours les mêmes champs plutôt qu'une union
// discriminée : le projet ne compile pas en mode `strict`, et sans
// `strictNullChecks` TypeScript ne sait pas restreindre `{ok: true} | {ok: false}`.
// Une forme unique évite ce piège et se lit aussi bien.

interface Portee {
  /** Établissement retenu ; null = vue consolidée. */
  id: number | null;
  /** Message à renvoyer au client, ou null si la demande est recevable. */
  erreur: string | null;
}

function etablissementDemande(profil: Profil, valeur: unknown): Portee {
  if (!estTransversal(profil)) return { id: profil.establishmentId, erreur: null };
  if (valeur === undefined || valeur === "" || valeur === "tous") return { id: null, erreur: null };

  const id = Number(valeur);
  if (!Number.isInteger(id) || id <= 0) {
    return { id: null, erreur: "Établissement invalide." };
  }
  return { id, erreur: null };
}

/** Variante pour les écritures : un établissement précis est obligatoire. */
function etablissementEcriture(
  profil: Profil,
  valeur: unknown
): { id: number; erreur: string | null } {
  if (!estTransversal(profil)) return { id: profil.establishmentId as number, erreur: null };

  const id = Number(valeur);
  if (!Number.isInteger(id) || id <= 0) {
    return { id: 0, erreur: "L'établissement doit être précisé pour cette opération." };
  }
  return { id, erreur: null };
}

/** Applique le filtre d'établissement à une requête, sauf en vue consolidée. */
function filtrerEtablissement<T extends { eq: (c: string, v: unknown) => T }>(
  requete: T,
  id: number | null,
  colonne = "establishment_id"
): T {
  return id === null ? requete : requete.eq(colonne, id);
}

// --- Protection contre les essais de code en série --------------------------
// Un code à six chiffres se devine en un million d'essais ; sans limite, un
// script y arriverait en quelques heures. Le compteur est en mémoire du
// processus : sur une plateforme sans état comme Vercel il ne couvre pas
// toutes les instances, mais il rend l'attaque bien plus lente et coûteuse.
// Une limitation côté base serait le complément naturel si le besoin s'en fait
// sentir.

const MAX_TENTATIVES = 5;
const FENETRE_MS = 15 * 60_000;

const tentatives = new Map<string, { nb: number; depuis: number }>();

function verifierTentatives(cle: string): string | null {
  const t = tentatives.get(cle);
  if (!t) return null;
  if (Date.now() - t.depuis > FENETRE_MS) {
    tentatives.delete(cle);
    return null;
  }
  if (t.nb >= MAX_TENTATIVES) {
    const minutes = Math.ceil((FENETRE_MS - (Date.now() - t.depuis)) / 60_000);
    return `Trop d'essais. Réessayez dans ${minutes} minute(s) ou demandez un nouveau code.`;
  }
  return null;
}

function enregistrerEchec(cle: string) {
  const t = tentatives.get(cle);
  if (!t || Date.now() - t.depuis > FENETRE_MS) {
    tentatives.set(cle, { nb: 1, depuis: Date.now() });
  } else {
    t.nb += 1;
  }
}

const reinitialiserTentatives = (cle: string) => tentatives.delete(cle);

/** Adresse technique d'un compte à code PIN : jamais montrée à l'utilisateur. */
const adresseTechnique = () => `agent-${randomUUID().slice(0, 12)}@staff.eden.local`;

// --- Reconnaissance du visage ----------------------------------------------

/**
 * Distance entre deux empreintes : 0 = identique, 1 = sans rapport.
 * Même calcul que côté navigateur, volontairement dupliqué plutôt qu'importé :
 * ce module ne doit rien tirer du code d'interface.
 */
function distanceEmpreinte(a: number[], b: number[]): number {
  let somme = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    somme += d * d;
  }
  return Math.sqrt(somme);
}

/**
 * Seuil de décision, un cran plus strict que l'usage courant (0,6) : au
 * pointage, reconnaître la mauvaise personne coûte plus cher que redemander
 * une photo.
 */
const SEUIL_VISAGE = 0.55;

interface CandidatVisage {
  id: string;
  full_name: string;
  email: string;
  establishment_id: number;
  visage_empreinte: unknown;
}

function meilleureCorrespondance(
  empreinte: number[],
  candidats: CandidatVisage[]
): CandidatVisage | null {
  let meilleur: CandidatVisage | null = null;
  let meilleureDistance = Number.POSITIVE_INFINITY;

  for (const c of candidats) {
    const reference = c.visage_empreinte as number[] | null;
    if (!Array.isArray(reference) || reference.length !== empreinte.length) continue;

    const d = distanceEmpreinte(empreinte, reference);
    if (d < meilleureDistance) {
      meilleureDistance = d;
      meilleur = c;
    }
  }

  return meilleureDistance <= SEUIL_VISAGE ? meilleur : null;
}

/**
 * Enregistre l'arrivée du jour.
 *
 * Une seule ligne par personne et par jour : les connexions suivantes ne
 * créent rien, l'index unique en base le garantit même si deux requêtes
 * arrivent en même temps. Renvoie le pointage s'il vient d'être créé, null
 * sinon — l'écran peut ainsi dire « pointage enregistré » ou rester discret.
 */
async function enregistrerPointage(
  profileId: string,
  establishmentId: number,
  methode: "visage" | "code",
  verifie: boolean,
  note?: string | null
): Promise<{ jour: string; arriveA: string; methode: string; verifie: boolean } | null> {
  const jour = jourLocal(new Date());

  const { data, error } = await supabase
    .from("pointages")
    .insert({
      profile_id: profileId, establishment_id: establishmentId,
      jour, methode, verifie, note: note ?? null,
    })
    .select().single();

  // Conflit d'unicité = la personne avait déjà pointé aujourd'hui.
  if (error) return null;

  return {
    jour: data.jour,
    arriveA: data.arrive_a,
    methode: data.methode,
    verifie: data.verifie,
  };
}

/** La personne a-t-elle déjà une arrivée enregistrée aujourd'hui ? */
async function aPointeAujourdHui(profileId: string): Promise<boolean> {
  const { count } = await supabase
    .from("pointages").select("id", { count: "exact", head: true })
    .eq("profile_id", profileId).eq("jour", jourLocal(new Date()));
  return (count ?? 0) > 0;
}

// --- Traçabilité (§5.10) ----------------------------------------------------

function journaliser(
  profil: Profil,
  action: string,
  entite: string,
  entiteId: string | number | null,
  details?: { motif?: string; avant?: unknown; apres?: unknown }
) {
  supabase
    .from("audit_log")
    .insert({
      user_id: profil.id,
      user_nom: profil.fullName,
      action,
      entite,
      entite_id: entiteId === null ? null : String(entiteId),
      motif: details?.motif ?? null,
      avant: details?.avant ?? null,
      apres: details?.apres ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[audit] écriture échouée:", error.message, { action, entite });
    });
}

// --- Utilitaires ------------------------------------------------------------

const route =
  (fn: (req: Req, res: Response) => Promise<unknown>) =>
  (req: Req, res: Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

/** Caches courts : évitent un aller-retour par ligne affichée. */
let cacheProfils: { at: number; map: Map<string, string> } | null = null;
async function nomsEmployes(): Promise<Map<string, string>> {
  if (cacheProfils && Date.now() - cacheProfils.at < 30_000) return cacheProfils.map;
  const { data } = await supabase.from("profiles").select("id, full_name");
  const map = new Map<string, string>((data ?? []).map((p) => [p.id, p.full_name]));
  cacheProfils = { at: Date.now(), map };
  return map;
}
const invaliderProfils = () => { cacheProfils = null; };

interface EtabResume { id: number; nom: string; couleur: string; ordre: number; actif: boolean }

let cacheEtabs: { at: number; liste: EtabResume[] } | null = null;
async function etablissements(): Promise<EtabResume[]> {
  if (cacheEtabs && Date.now() - cacheEtabs.at < 30_000) return cacheEtabs.liste;
  const { data } = await supabase
    .from("establishments").select("id, nom, couleur, ordre, actif").order("ordre");
  const liste = (data ?? []) as EtabResume[];
  cacheEtabs = { at: Date.now(), liste };
  return liste;
}
const invaliderEtabs = () => { cacheEtabs = null; };

async function nomsEtablissements(): Promise<Map<number, EtabResume>> {
  return new Map((await etablissements()).map((e) => [e.id, e]));
}

async function nomEtablissement(id: number | null): Promise<string> {
  if (id === null) return "Tous les établissements";
  return (await nomsEtablissements()).get(id)?.nom ?? "Établissement inconnu";
}

async function prochainNumero(prefix: string, table: string, colonne: string): Promise<string> {
  const jour = versLocal(new Date());
  const cle = jour.toISOString().slice(0, 10).replace(/-/g, "");
  const { count } = await supabase
    .from(table)
    .select(colonne, { count: "exact", head: true })
    .like(colonne, `${prefix}-${cle}-%`);
  return `${prefix}-${cle}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

const CODE_CONFLIT_UNICITE = "23505";

async function insertionAvecNumero<T>(
  prefix: string,
  table: string,
  colonne: string,
  construire: (numero: string) => Record<string, unknown>
): Promise<T> {
  for (let essai = 0; essai < 5; essai++) {
    const numero = await prochainNumero(prefix, table, colonne);
    const { data, error } = await supabase.from(table).insert(construire(numero)).select().single();
    if (!error) return data as T;
    if (error.code !== CODE_CONFLIT_UNICITE) throw new Error(error.message);
  }
  throw new Error("Impossible de générer un numéro unique après 5 tentatives.");
}

// --- Périodes et fuseau horaire --------------------------------------------
// L'entreprise est à Brazzaville : UTC+1 toute l'année, sans heure d'été. Ce
// décalage est appliqué explicitement au lieu de se fier au fuseau du serveur,
// qui est en UTC sur Vercel : sinon « aujourd'hui » commencerait à 23 h la
// veille, et les ventes de début de soirée tomberaient dans le mauvais jour.

const DECALAGE_MINUTES = 60;

function versLocal(instant: Date): Date {
  return new Date(instant.getTime() + DECALAGE_MINUTES * 60_000);
}
function versInstant(local: Date): Date {
  return new Date(local.getTime() - DECALAGE_MINUTES * 60_000);
}
function jourLocal(instant: Date): string {
  return versLocal(instant).toISOString().slice(0, 10);
}

interface Bornes {
  debut: Date;
  fin: Date;
  debutJour: string;
  finJour: string;
  libelle: string;
}

function bornesPeriode(query: Record<string, unknown>): Bornes {
  const periode = String(query.periode ?? "jour");
  const maintenant = new Date();
  const local = versLocal(maintenant);
  const minuit = (a: number, m: number, j: number) => versInstant(new Date(Date.UTC(a, m, j)));

  if (periode === "personnalise" && query.debut && query.fin) {
    const debutJour = String(query.debut);
    const finJour = String(query.fin);
    return {
      debut: versInstant(new Date(`${debutJour}T00:00:00.000Z`)),
      fin: versInstant(new Date(Date.parse(`${finJour}T00:00:00.000Z`) + 86_400_000)),
      debutJour,
      finJour,
      libelle: "Période personnalisée",
    };
  }

  const annee = local.getUTCFullYear();
  const mois = local.getUTCMonth();
  const jour = local.getUTCDate();
  const finJour = jourLocal(maintenant);

  switch (periode) {
    case "semaine": {
      const decalage = (local.getUTCDay() + 6) % 7;
      const debut = minuit(annee, mois, jour - decalage);
      return { debut, fin: maintenant, debutJour: jourLocal(debut), finJour, libelle: "Cette semaine" };
    }
    case "mois": {
      const debut = minuit(annee, mois, 1);
      return { debut, fin: maintenant, debutJour: jourLocal(debut), finJour, libelle: "Ce mois-ci" };
    }
    case "annee": {
      const debut = minuit(annee, 0, 1);
      return { debut, fin: maintenant, debutJour: jourLocal(debut), finJour, libelle: "Cette année" };
    }
    default: {
      const debut = minuit(annee, mois, jour);
      return { debut, fin: maintenant, debutJour: finJour, finJour, libelle: "Aujourd'hui" };
    }
  }
}

// ============================================================================
// Application
// ============================================================================

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // -------------------------------------------------------------------------
  // Connexion du personnel par nom + code PIN
  // -------------------------------------------------------------------------
  // Ces trois routes précèdent volontairement requireAuth : on ne peut pas
  // exiger une session pour afficher l'écran qui sert à en obtenir une.
  // Elles n'exposent que ce que l'écran de connexion doit afficher — un nom et
  // un établissement — et jamais l'adresse technique du compte.

  const publique = express.Router();

  publique.get("/etablissements", route(async (_req, res) => {
    const { data, error } = await supabase
      .from("establishments").select("id, nom, couleur").eq("actif", true).order("ordre");
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  /** Nom et logo de l.entreprise, pour habiller l.écran de connexion. */
  publique.get("/marque", route(async (_req, res) => {
    const { data } = await supabase
      .from("settings").select("value").eq("key", "entreprise").maybeSingle();
    const v = (data?.value ?? {}) as { nom?: string; logoUrl?: string };
    res.json({ nom: v.nom ?? "EDEN MULTI-SERVICES", logoUrl: v.logoUrl ?? "" });
  }));

  publique.get("/personnel", route(async (req, res) => {
    let q = supabase
      .from("profiles")
      .select("id, full_name, fonction, role, establishment_id, visage_empreinte")
      .eq("mode_connexion", "pin").eq("actif", true).order("full_name");

    const etab = Number(req.query.establishmentId);
    if (Number.isInteger(etab) && etab > 0) q = q.eq("establishment_id", etab);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // On expose seulement l'EXISTENCE d'une empreinte, jamais sa valeur :
    // l'écran de connexion doit savoir s'il faut ouvrir la caméra, pas de quoi
    // reconnaître qui que ce soit.
    res.json((data ?? []).map(({ visage_empreinte, ...reste }) => ({
      ...toCamelCase(reste),
      visageEnregistre: Array.isArray(visage_empreinte) && visage_empreinte.length === 128,
    })));
  }));

  /**
   * Échange nom + PIN contre une session.
   *
   * L'adresse technique du compte n'est jamais renvoyée au navigateur : c'est
   * le serveur qui la retrouve et s'authentifie auprès de Supabase, puis
   * transmet la session obtenue. Le PIN ne peut donc pas être essayé
   * directement contre l'API d'authentification depuis l'extérieur.
   */
  /**
   * Identification par le visage — première connexion de la journée.
   *
   * Le navigateur calcule l'empreinte et l'envoie ; c'est le serveur qui la
   * compare aux empreintes enregistrées. Les empreintes ne sortent donc jamais
   * de la base : les publier pour laisser le client faire la comparaison
   * reviendrait à distribuer des données biométriques à qui ouvre la page de
   * connexion.
   */
  publique.post("/visage", route(async (req, res) => {
    const { establishmentId, empreinte } = req.body;

    if (!Array.isArray(empreinte) || empreinte.length !== 128) {
      return res.status(400).json({ error: "Image inexploitable. Réessayez." });
    }

    let q = supabase
      .from("profiles")
      .select("id, full_name, email, visage_empreinte, establishment_id")
      .eq("mode_connexion", "pin").eq("actif", true).not("visage_empreinte", "is", null);

    const etab = Number(establishmentId);
    if (Number.isInteger(etab) && etab > 0) q = q.eq("establishment_id", etab);

    const { data: candidats, error } = await q;
    if (error) throw new Error(error.message);

    const trouve = meilleureCorrespondance(empreinte as number[], candidats ?? []);
    if (!trouve) {
      return res.status(401).json({
        error: "Visage non reconnu. Placez-vous face à la caméra, dans un bon éclairage.",
      });
    }

    // Le visage vaut identification : on ouvre la session sans code. Le mot de
    // passe technique n'est jamais connu du navigateur, c'est le serveur qui
    // délivre la session au nom de la personne reconnue.
    const { data: lien, error: errLien } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: trouve.email,
    });
    if (errLien || !lien?.properties?.hashed_token) {
      throw new Error("Session impossible à ouvrir. Réessayez.");
    }

    const { data: session, error: errSession } = await creerClientAuth().auth.verifyOtp({
      type: "magiclink",
      token_hash: lien.properties.hashed_token,
    });
    if (errSession || !session.session) {
      throw new Error("Session impossible à ouvrir. Réessayez.");
    }

    const pointage = await enregistrerPointage(trouve.id, trouve.establishment_id, "visage", true);

    res.json({
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
      nom: trouve.full_name,
      pointage,
    });
  }));

  publique.post("/pin", route(async (req, res) => {
    const { profileId, pin } = req.body;
    if (!profileId || !pin) {
      return res.status(400).json({ error: "Sélectionnez votre nom et saisissez votre code." });
    }

    const blocage = verifierTentatives(String(profileId));
    if (blocage) return res.status(429).json({ error: blocage });

    const { data: profil } = await supabase
      .from("profiles")
      .select("email, actif, mode_connexion, establishment_id, visage_empreinte")
      .eq("id", profileId).maybeSingle();

    // Message identique dans tous les cas d'échec : distinguer « compte
    // inconnu » de « code erroné » aiderait qui essaierait des codes au hasard.
    const echec = () => {
      enregistrerEchec(String(profileId));
      return res.status(401).json({ error: "Code incorrect." });
    };

    if (!profil || !profil.actif || profil.mode_connexion !== "pin") return echec();

    // Client jetable : signer avec le client partagé lui installerait la
    // session de l.agent, et toutes les requêtes suivantes de cette instance
    // partiraient avec son jeton au lieu de la clé secrète.
    const { data, error } = await creerClientAuth().auth.signInWithPassword({
      email: profil.email,
      password: String(pin),
    });
    if (error || !data.session) return echec();

    reinitialiserTentatives(String(profileId));

    /*
     * Le code ouvre les connexions de la journée, pas la première.
     *
     * L'arrivée est ce qui atteste la ponctualité : si le code suffisait à
     * l'enregistrer, chacun déclarerait sa propre heure d'arrivée et le suivi
     * de présence ne vaudrait plus rien. La première identification du jour
     * passe donc par la caméra.
     *
     * La vérification n'a lieu qu'une fois le code reconnu : répondre « vous
     * n'avez pas encore pointé » à qui n'a pas le bon code reviendrait à
     * annoncer publiquement qui est déjà au travail.
     *
     * Reste le cas où la caméra ne peut pas servir — appareil sans objectif,
     * autorisation refusée, panne. Refuser l'accès enfermerait quelqu'un
     * dehors de son propre lieu de travail : la porte de secours existe, mais
     * elle est explicite, elle exige un motif, et elle marque l'arrivée comme
     * non vérifiée pour que la direction la voie.
     */
    const dejaPointe = await aPointeAujourdHui(String(profileId));
    const secours = req.body.secours as { raison?: string } | undefined;

    if (!dejaPointe && profil.visage_empreinte && !secours) {
      return res.status(409).json({
        code: "pointage_requis",
        error: "Première connexion de la journée : votre arrivée doit être enregistrée par la caméra.",
      });
    }

    const pointage = dejaPointe
      ? null
      : await enregistrerPointage(
          String(profileId), profil.establishment_id as number, "code", false,
          secours?.raison
            ? `Secours : ${String(secours.raison).slice(0, 200)}`
            : profil.visage_empreinte
              ? "Entrée au code, sans reconnaissance"
              : "Aucun visage enregistré pour ce compte"
        );

    res.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      pointage,
    });
  }));

  app.use("/api/auth", publique);

  const api = express.Router();
  api.use(requireAuth, loadProfile, verifierEcran);

  // -------------------------------------------------------------------------
  // Profil courant
  // -------------------------------------------------------------------------

  api.get("/me", route(async (req, res) => {
    const { data, error } = await supabase
      .from("profiles").select("*").eq("id", req.profil!.id).single();
    if (error) throw new Error(error.message);

    const etabs = await nomsEtablissements();
    res.json({
      ...toCamelCase(data),
      etablissementNom: data.establishment_id
        ? etabs.get(data.establishment_id)?.nom ?? null
        : null,
      /** Le frontend s.en sert pour afficher ou non le sélecteur. */
      peutChangerEtablissement: data.establishment_id === null,
      /** Écrans autorisés : la navigation s.y conforme, l.API les vérifie. */
      ecrans: ecransDe(req.profil!),
    });
  }));

  // -------------------------------------------------------------------------
  // Établissements
  // -------------------------------------------------------------------------

  /** Liste des établissements accessibles au profil connecté. */
  api.get("/establishments", route(async (req, res) => {
    const liste = await etablissements();
    const visibles = estTransversal(req.profil!)
      ? liste.filter((e) => e.actif)
      : liste.filter((e) => e.id === req.profil!.establishmentId);

    const { data } = await supabase
      .from("establishments").select("*").in("id", visibles.map((e) => e.id)).order("ordre");
    res.json(toCamelCaseArray(data ?? []));
  }));

  api.post("/establishments", requireRole(...ADMIN), route(async (req, res) => {
    const { nom, slug, activite, adresse, telephone, email, couleur, ordre } = req.body;
    if (!nom || !slug) {
      return res.status(400).json({ error: "Le nom et l'identifiant court sont obligatoires." });
    }

    const { data, error } = await supabase
      .from("establishments")
      .insert({
        nom, slug: String(slug).trim().toLowerCase(),
        activite: activite ?? null, adresse: adresse ?? null,
        telephone: telephone ?? null, email: email ?? null,
        couleur: couleur ?? "#1fa066", ordre: ordre ?? 99,
      })
      .select().single();

    if (error?.code === CODE_CONFLIT_UNICITE) {
      return res.status(409).json({ error: "Un établissement porte déjà ce nom ou cet identifiant." });
    }
    if (error) throw new Error(error.message);

    invaliderEtabs();
    journaliser(req.profil!, "creation_etablissement", "establishments", data.id, { apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  api.patch("/establishments/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { data: avant } = await supabase
      .from("establishments").select("*").eq("id", req.params.id).single();

    const champs = ["nom", "activite", "adresse", "telephone", "email", "couleur", "ordre", "actif"];
    const maj = toSnakeCase(
      Object.fromEntries(Object.entries(req.body).filter(([k]) => champs.includes(k)))
    );

    const { data, error } = await supabase
      .from("establishments").update(maj).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    invaliderEtabs();
    journaliser(req.profil!, "modification_etablissement", "establishments", req.params.id, {
      avant, apres: data,
    });
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.1 Gestion des utilisateurs
  // -------------------------------------------------------------------------

  api.get("/users", requireRole(...TOUS), route(async (req, res) => {
    let q = supabase.from("profiles").select("*").order("full_name");
    // Un responsable rattaché ne voit que l'équipe de son établissement.
    if (!estTransversal(req.profil!)) q = q.eq("establishment_id", req.profil!.establishmentId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const etabs = await nomsEtablissements();
    res.json(
      (data ?? []).map((u) => ({
        ...toCamelCase(u),
        etablissementNom: u.establishment_id ? etabs.get(u.establishment_id)?.nom ?? null : null,
      }))
    );
  }));

  /**
   * Crée un compte. Le mode de connexion découle du rôle :
   *  - propriétaire et responsable saisissent une adresse et un mot de passe ;
   *    ils accèdent à la comptabilité et aux comptes, cela le justifie ;
   *  - le personnel de terrain reçoit un code à 6 chiffres et une adresse
   *    technique générée, qu'il ne verra jamais. Il se connecte en choisissant
   *    son nom dans une liste.
   */
  api.post("/users", requireRole(...ADMIN), route(async (req, res) => {
    const {
      email, password, pin, fullName, role, establishmentId, fonction, dateEntree,
      visageEmpreinte, photoUrl,
    } = req.body;

    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: "Le nom complet est obligatoire." });
    }

    const roleFinal: UserRole = role ?? "caissier";
    const parPin = roleFinal === "caissier" || roleFinal === "technicien";

    // Un profil de terrain travaille dans un établissement précis : sans
    // rattachement, il aurait accès à tous, ce que le §5.1 exclut.
    const rattachement = establishmentId ? Number(establishmentId) : null;
    if (parPin && !rattachement) {
      return res.status(400).json({ error: "Ce rôle doit être rattaché à un établissement." });
    }

    let identifiant: string;
    let secret: string;

    if (parPin) {
      if (!/^\d{6}$/.test(String(pin ?? ""))) {
        return res.status(400).json({ error: "Le code doit comporter exactement 6 chiffres." });
      }
      identifiant = adresseTechnique();
      secret = String(pin);
    } else {
      if (!email || !password) {
        return res.status(400).json({ error: "Adresse e-mail et mot de passe sont obligatoires." });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères." });
      }
      identifiant = String(email).trim();
      secret = String(password);
    }

    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email: identifiant, password: secret, email_confirm: true,
    });
    if (authErr) return res.status(400).json({ error: authErr.message });

    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: auth.user.id,
        full_name: String(fullName).trim(),
        email: identifiant,
        role: roleFinal,
        mode_connexion: parPin ? "pin" : "email",
        establishment_id: rattachement,
        fonction: fonction?.trim() || null,
        date_entree: dateEntree || null,
        visage_empreinte: Array.isArray(visageEmpreinte) && visageEmpreinte.length === 128
          ? visageEmpreinte : null,
        photo_url: photoUrl || null,
      })
      .select().single();

    if (error) {
      // Ne pas laisser un compte capable de se connecter sans profil.
      await supabase.auth.admin.deleteUser(auth.user.id);
      throw new Error(error.message);
    }

    invaliderProfils();
    journaliser(req.profil!, "creation_utilisateur", "profiles", data.id, {
      apres: { role: roleFinal, mode: parPin ? "pin" : "email", establishmentId: rattachement },
    });
    res.status(201).json(toCamelCase(data));
  }));

  /** Attribue un nouveau code à un compte de terrain. */
  api.post("/users/:id/pin", requireRole(...ADMIN), route(async (req, res) => {
    const { pin } = req.body;
    if (!/^\d{6}$/.test(String(pin ?? ""))) {
      return res.status(400).json({ error: "Le code doit comporter exactement 6 chiffres." });
    }

    const { data: profil } = await supabase
      .from("profiles").select("mode_connexion").eq("id", req.params.id).maybeSingle();
    if (!profil) return res.status(404).json({ error: "Compte introuvable." });
    if (profil.mode_connexion !== "pin") {
      return res.status(400).json({ error: "Ce compte se connecte par e-mail et mot de passe." });
    }

    const { error } = await supabase.auth.admin.updateUserById(req.params.id, {
      password: String(pin),
    });
    if (error) return res.status(400).json({ error: error.message });

    reinitialiserTentatives(String(req.params.id));
    journaliser(req.profil!, "reinitialisation_code", "profiles", req.params.id);
    res.json({ ok: true });
  }));

  api.patch("/users/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { data: avant } = await supabase
      .from("profiles").select("*").eq("id", req.params.id).single();

    const champs = [
      "fullName", "role", "establishmentId", "fonction", "dateEntree", "actif",
      "permissions", "visageEmpreinte", "photoUrl",
    ];
    const corps = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => champs.includes(k))
    ) as Record<string, unknown>;

    const roleFinal = (corps.role ?? avant.role) as UserRole;
    const etabFinal =
      corps.establishmentId !== undefined
        ? (corps.establishmentId ? Number(corps.establishmentId) : null)
        : (avant.establishment_id as number | null);

    if ((roleFinal === "caissier" || roleFinal === "technicien") && etabFinal === null) {
      return res.status(400).json({
        error: "Un caissier ou un technicien doit être rattaché à un établissement.",
      });
    }
    if (corps.establishmentId !== undefined) corps.establishmentId = etabFinal;

    const { data, error } = await supabase
      .from("profiles").update(toSnakeCase(corps)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    invaliderProfils();
    journaliser(req.profil!, "modification_utilisateur", "profiles", req.params.id, {
      avant, apres: data, motif: req.body.motif,
    });
    res.json(toCamelCase(data));
  }));

  api.post("/users/:id/password", requireRole(...ADMIN), route(async (req, res) => {
    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères." });
    }
    const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password });
    if (error) return res.status(400).json({ error: error.message });

    journaliser(req.profil!, "reinitialisation_mot_de_passe", "profiles", req.params.id);
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------------------
  // Catégories
  // -------------------------------------------------------------------------

  api.get("/categories", route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("categories").select("*").order("ordre");
    q = filtrerEtablissement(q, portee.id);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  api.post("/categories", requireRole(...ADMIN), route(async (req, res) => {
    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });

    const { data, error } = await supabase
      .from("categories")
      .insert({ ...toSnakeCase(req.body), establishment_id: cible.id })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(toCamelCase(data));
  }));

  api.patch("/categories/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { data, error } = await supabase
      .from("categories").update(toSnakeCase(req.body)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // Catalogue (§2, §3, §5.5)
  // -------------------------------------------------------------------------

  api.get("/products", route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("products").select("*, categories(nom)").order("nom");
    q = filtrerEtablissement(q, portee.id);
    if (req.query.actif !== "tous") q = q.eq("actif", true);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    res.json(
      (data ?? []).map((row: Record<string, unknown>) => {
        const { categories, ...reste } = row as { categories?: { nom: string } };
        return { ...toCamelCase(reste), categorieNom: categories?.nom ?? null };
      })
    );
  }));

  api.post("/products", requireRole(...ADMIN), route(async (req, res) => {
    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });

    const { data, error } = await supabase
      .from("products")
      .insert({ ...toSnakeCase(req.body), establishment_id: cible.id })
      .select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "creation_produit", "products", data.id, { apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  /**
   * §5.1 « Modification des prix » est réservée à l'administrateur, et §5.10
   * impose d'en garder trace : tout changement de prix est journalisé avec
   * l'ancienne et la nouvelle valeur.
   */
  api.patch("/products/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { data: avant, error: errAvant } = await supabase
      .from("products").select("*").eq("id", req.params.id).single();
    if (errAvant) throw new Error(errAvant.message);

    // La quantité ne se modifie jamais directement : elle passe par un
    // mouvement de stock, sinon l'historique du §5.5 devient faux.
    const { quantite: _ignore, establishmentId: _fige, ...corps } = req.body;

    const { data, error } = await supabase
      .from("products").update(toSnakeCase(corps)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    const prixChange = avant.prix_vente !== data.prix_vente || avant.prix_achat !== data.prix_achat;
    journaliser(
      req.profil!,
      prixChange ? "modification_prix" : "modification_produit",
      "products", req.params.id,
      { avant, apres: data, motif: req.body.motif }
    );
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §2.4 Packs
  // -------------------------------------------------------------------------

  api.get("/packs", route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase
      .from("packs")
      .select("*, pack_items(id, pack_id, product_id, quantite, products(nom, prix_vente))")
      .order("nom");
    q = filtrerEtablissement(q, portee.id);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    res.json(
      (data ?? []).map((row: Record<string, unknown>) => {
        const { pack_items, ...reste } = row as {
          pack_items?: {
            id: number; pack_id: number; product_id: number; quantite: number;
            products?: { nom: string; prix_vente: number };
          }[];
        };
        return {
          ...toCamelCase(reste),
          items: (pack_items ?? []).map((it) => ({
            id: it.id,
            packId: it.pack_id,
            productId: it.product_id,
            quantite: Number(it.quantite),
            produitNom: it.products?.nom,
            prixVente: it.products?.prix_vente,
          })),
        };
      })
    );
  }));

  api.post("/packs", requireRole(...ADMIN), route(async (req, res) => {
    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });

    const { items, ...pack } = req.body;
    const { data, error } = await supabase
      .from("packs")
      .insert({ ...toSnakeCase(pack), establishment_id: cible.id })
      .select().single();
    if (error) throw new Error(error.message);

    if (Array.isArray(items) && items.length) {
      const { error: errItems } = await supabase.from("pack_items").insert(
        items.map((it: { productId: number; quantite: number }) => ({
          pack_id: data.id, product_id: it.productId, quantite: it.quantite,
        }))
      );
      if (errItems) throw new Error(errItems.message);
    }

    journaliser(req.profil!, "creation_pack", "packs", data.id, { apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  /** Remplace intégralement la composition : plus simple et sans état orphelin. */
  api.patch("/packs/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { items, establishmentId: _fige, ...pack } = req.body;
    const { data: avant } = await supabase
      .from("packs").select("*").eq("id", req.params.id).single();

    const { data, error } = await supabase
      .from("packs").update(toSnakeCase(pack)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    if (Array.isArray(items)) {
      await supabase.from("pack_items").delete().eq("pack_id", req.params.id);
      if (items.length) {
        const { error: errItems } = await supabase.from("pack_items").insert(
          items.map((it: { productId: number; quantite: number }) => ({
            pack_id: Number(req.params.id), product_id: it.productId, quantite: it.quantite,
          }))
        );
        if (errItems) throw new Error(errItems.message);
      }
    }

    journaliser(req.profil!, "modification_pack", "packs", req.params.id, { avant, apres: data });
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.6 Fournisseurs — communs à tous les établissements
  // -------------------------------------------------------------------------

  api.get("/suppliers", route(async (_req, res) => {
    const { data, error } = await supabase.from("suppliers").select("*").order("nom");
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  api.post("/suppliers", requireRole(...TOUS), route(async (req, res) => {
    const { data, error } = await supabase
      .from("suppliers").insert(toSnakeCase(req.body)).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(toCamelCase(data));
  }));

  api.patch("/suppliers/:id", requireRole(...TOUS), route(async (req, res) => {
    const { data, error } = await supabase
      .from("suppliers").update(toSnakeCase(req.body)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.9 Clients — communs à tous les établissements
  // -------------------------------------------------------------------------

  api.get("/customers", route(async (req, res) => {
    let q = supabase.from("customers").select("*").order("nom");
    const recherche = req.query.q ? String(req.query.q).trim() : "";
    if (recherche) q = q.or(`nom.ilike.%${recherche}%,telephone.ilike.%${recherche}%`);

    const { data, error } = await q.limit(200);
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  api.post("/customers", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { data, error } = await supabase
      .from("customers").insert(toSnakeCase(req.body)).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(toCamelCase(data));
  }));

  api.patch("/customers/:id", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { data, error } = await supabase
      .from("customers").update(toSnakeCase(req.body)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json(toCamelCase(data));
  }));

  /**
   * §5.9 : fiche client avec historique d'achats et commandes en cours.
   * Le client est commun aux établissements, mais son historique reste filtré
   * par la portée de celui qui consulte.
   */
  api.get("/customers/:id", route(async (req, res) => {
    const id = Number(req.params.id);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let qVentes = supabase.from("sales").select("*").eq("customer_id", id)
      .order("created_at", { ascending: false }).limit(100);
    qVentes = filtrerEtablissement(qVentes, portee.id);

    let qCommandes = supabase.from("orders").select("*").eq("customer_id", id)
      .order("date_commande", { ascending: false });
    qCommandes = filtrerEtablissement(qCommandes, portee.id);

    const [{ data: client }, { data: ventes }, { data: commandes }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      qVentes,
      qCommandes,
    ]);

    if (!client) return res.status(404).json({ error: "Client introuvable." });

    const validees = (ventes ?? []).filter((v) => v.statut === "validee");
    const [noms, etabs] = await Promise.all([nomsEmployes(), nomsEtablissements()]);

    res.json({
      ...toCamelCase(client),
      totalDepense: validees.reduce((s, v) => s + Number(v.total), 0),
      nbAchats: validees.length,
      ventes: (ventes ?? []).map((v) => ({
        ...toCamelCase(v),
        vendeurNom: noms.get(v.vendeur_id) ?? null,
        etablissementNom: etabs.get(v.establishment_id)?.nom ?? null,
      })),
      commandes: toCamelCaseArray(commandes ?? []),
    });
  }));

  // -------------------------------------------------------------------------
  // §5.3 Caisse
  // -------------------------------------------------------------------------

  /**
   * Solde théorique = fonds initial + mouvements en espèces.
   * Seules les espèces comptent : le Mobile Money et les virements n'entrent
   * jamais dans le tiroir, les inclure fausserait l'écart de caisse.
   */
  async function soldeTheorique(sessionId: number, fondsInitial: number): Promise<number> {
    const { data, error } = await supabase
      .from("cash_movements").select("montant, payment_method").eq("session_id", sessionId);
    if (error) throw new Error(error.message);

    return (data ?? [])
      .filter((m) => m.payment_method === "especes")
      .reduce((total, m) => total + Number(m.montant), fondsInitial);
  }

  async function sessionOuverte(establishmentId: number) {
    const { data, error } = await supabase
      .from("cash_sessions").select("*")
      .eq("establishment_id", establishmentId).eq("statut", "ouverte").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  api.get("/cash/current", route(async (req, res) => {
    const cible = etablissementEcriture(req.profil!, req.query.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });

    const session = await sessionOuverte(cible.id);
    if (!session) return res.json(null);

    const [noms, etabs, theorique, { data: mouvements }] = await Promise.all([
      nomsEmployes(),
      nomsEtablissements(),
      soldeTheorique(session.id, Number(session.fonds_initial)),
      supabase.from("cash_movements").select("*").eq("session_id", session.id)
        .order("created_at", { ascending: false }),
    ]);

    res.json({
      ...toCamelCase(session),
      etablissementNom: etabs.get(session.establishment_id)?.nom ?? null,
      openedByNom: noms.get(session.opened_by) ?? null,
      soldeTheorique: theorique,
      mouvements: (mouvements ?? []).map((m) => ({
        ...toCamelCase(m),
        createdByNom: m.created_by ? noms.get(m.created_by) ?? null : null,
      })),
    });
  }));

  api.post("/cash/open", requireRole(...ENCAISSENT), route(async (req, res) => {
    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });

    if (await sessionOuverte(cible.id)) {
      return res.status(409).json({
        error: "Une caisse est déjà ouverte pour cet établissement. Fermez-la avant d'en ouvrir une nouvelle.",
      });
    }

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        establishment_id: cible.id,
        fonds_initial: Number(req.body.fondsInitial) || 0,
        opened_by: req.profil!.id,
        notes: req.body.notes ?? null,
      })
      .select().single();

    if (error?.code === CODE_CONFLIT_UNICITE) {
      return res.status(409).json({ error: "Une caisse vient d'être ouverte pour cet établissement." });
    }
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "ouverture_caisse", "cash_sessions", data.id, { apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  api.post("/cash/close", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { sessionId, soldePhysique, notes } = req.body;

    const { data: session, error: errSession } = await supabase
      .from("cash_sessions").select("*").eq("id", sessionId).single();
    if (errSession) throw new Error(errSession.message);

    if (!estTransversal(req.profil!) && session.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cette caisse ne relève pas de votre établissement." });
    }
    if (session.statut === "fermee") {
      return res.status(409).json({ error: "Cette caisse est déjà fermée." });
    }

    const theorique = await soldeTheorique(session.id, Number(session.fonds_initial));
    const physique = Number(soldePhysique) || 0;

    const { data, error } = await supabase
      .from("cash_sessions")
      .update({
        statut: "fermee",
        closed_by: req.profil!.id,
        closed_at: new Date().toISOString(),
        solde_theorique: theorique,
        solde_physique: physique,
        ecart: physique - theorique,
        notes: notes ?? session.notes,
      })
      .eq("id", sessionId).eq("statut", "ouverte")
      .select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "fermeture_caisse", "cash_sessions", sessionId, {
      apres: { theorique, physique, ecart: physique - theorique }, motif: notes,
    });
    res.json(toCamelCase(data));
  }));

  api.post("/cash/movements", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { sessionId, type, montant, motif, paymentMethod } = req.body;

    if (!motif || !String(motif).trim()) {
      return res.status(400).json({ error: "Un motif est obligatoire pour tout mouvement de caisse." });
    }

    const { data: session } = await supabase
      .from("cash_sessions").select("establishment_id, statut").eq("id", sessionId).maybeSingle();
    if (!session) return res.status(404).json({ error: "Caisse introuvable." });
    if (!estTransversal(req.profil!) && session.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cette caisse ne relève pas de votre établissement." });
    }

    // Le signe est imposé par le type : l'utilisateur saisit toujours un
    // montant positif, impossible de se tromper de sens.
    const sortie = ["retrait", "depense", "remboursement"].includes(type);
    const valeur = Math.abs(Number(montant)) * (sortie ? -1 : 1);

    const { data, error } = await supabase
      .from("cash_movements")
      .insert({
        session_id: sessionId, type, montant: valeur, motif,
        payment_method: paymentMethod ?? "especes", created_by: req.profil!.id,
      })
      .select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "mouvement_caisse", "cash_movements", data.id, { motif, apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  api.get("/cash/sessions", requireRole(...VALIDENT), route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("cash_sessions").select("*").order("opened_at", { ascending: false });
    q = filtrerEtablissement(q, portee.id);

    const { data, error } = await q.limit(200);
    if (error) throw new Error(error.message);

    const [noms, etabs] = await Promise.all([nomsEmployes(), nomsEtablissements()]);
    res.json(
      (data ?? []).map((s) => ({
        ...toCamelCase(s),
        etablissementNom: etabs.get(s.establishment_id)?.nom ?? null,
        openedByNom: noms.get(s.opened_by) ?? null,
        closedByNom: s.closed_by ? noms.get(s.closed_by) ?? null : null,
      }))
    );
  }));

  // -------------------------------------------------------------------------
  // §5.2 Ventes
  // -------------------------------------------------------------------------

  api.get("/sales", route(async (req, res) => {
    const { debut, fin } = bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("sales").select("*")
      .gte("created_at", debut.toISOString())
      .lt("created_at", fin.toISOString())
      .order("created_at", { ascending: false });
    q = filtrerEtablissement(q, portee.id);

    // §5.1 : le personnel de terrain ne consulte que ses propres ventes.
    if (personnelDeTerrain(req.profil!)) q = q.eq("vendeur_id", req.profil!.id);

    const { data, error } = await q.limit(500);
    if (error) throw new Error(error.message);

    const [noms, etabs] = await Promise.all([nomsEmployes(), nomsEtablissements()]);
    res.json(
      (data ?? []).map((v) => ({
        ...toCamelCase(v),
        vendeurNom: noms.get(v.vendeur_id) ?? null,
        etablissementNom: etabs.get(v.establishment_id)?.nom ?? null,
      }))
    );
  }));

  api.get("/sales/:id", route(async (req, res) => {
    const [{ data: vente }, { data: lignes }] = await Promise.all([
      supabase.from("sales").select("*").eq("id", req.params.id).single(),
      supabase.from("sale_items").select("*").eq("sale_id", req.params.id).order("id"),
    ]);
    if (!vente) return res.status(404).json({ error: "Vente introuvable." });

    if (!estTransversal(req.profil!) && vente.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cette vente ne relève pas de votre établissement." });
    }

    const [noms, etabs] = await Promise.all([nomsEmployes(), nomsEtablissements()]);
    let clientNom: string | null = null;
    if (vente.customer_id) {
      const { data } = await supabase
        .from("customers").select("nom").eq("id", vente.customer_id).maybeSingle();
      clientNom = data?.nom ?? null;
    }

    res.json({
      ...toCamelCase(vente),
      vendeurNom: noms.get(vente.vendeur_id) ?? null,
      etablissementNom: etabs.get(vente.establishment_id)?.nom ?? null,
      customerNom: clientNom,
      items: toCamelCaseArray(lignes ?? []),
    });
  }));

  /**
   * Enregistre une vente (§5.2) et propage ses effets : décrément de stock
   * (§5.5) et mouvement de caisse (§5.3).
   *
   * Les prix ne sont jamais pris depuis le client : ils sont relus en base.
   * §5.1 réserve la modification des prix à l'administrateur — si le caissier
   * pouvait envoyer un prix arbitraire, cette règle ne vaudrait rien. Seule la
   * remise, prévue au §5.2, permet de descendre sous le tarif.
   */
  api.post("/sales", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { items, paymentMethod, numeroTransaction, remise, customerId } = req.body;

    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "La vente doit contenir au moins une ligne." });
    }

    // La caisse n'est plus un préalable à la vente : bloquer un encaissement
    // parce qu'une session n'est pas ouverte fait perdre des ventes réelles au
    // comptoir. Quand une caisse est ouverte, la vente s'y rattache et alimente
    // le rapprochement ; sinon elle est enregistrée sans session, et n'entre
    // simplement pas dans l'écart de fermeture.
    const session = await sessionOuverte(cible.id);

    const idsProduits = items.filter((i) => i.productId).map((i) => Number(i.productId));
    const idsPacks = items.filter((i) => i.packId).map((i) => Number(i.packId));

    const [{ data: produits }, { data: packs }] = await Promise.all([
      idsProduits.length
        ? supabase.from("products").select("*").in("id", idsProduits)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      idsPacks.length
        ? supabase.from("packs").select("*, pack_items(product_id, quantite)").in("id", idsPacks)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

    const parProduit = new Map((produits ?? []).map((p) => [p.id as number, p]));
    const parPack = new Map((packs ?? []).map((p) => [p.id as number, p]));

    const lignes: {
      product_id: number | null; pack_id: number | null; libelle: string;
      quantite: number; prix_unitaire: number; prix_achat_unitaire: number; montant: number;
    }[] = [];

    for (const item of items) {
      const quantite = Number(item.quantite);
      if (!Number.isFinite(quantite) || quantite <= 0) {
        return res.status(400).json({ error: "Quantité invalide sur une ligne de vente." });
      }

      if (item.packId) {
        const pack = parPack.get(Number(item.packId)) as
          | { id: number; nom: string; prix_vente: number; establishment_id: number;
              pack_items?: { product_id: number; quantite: number }[] }
          | undefined;
        if (!pack) return res.status(400).json({ error: `Pack ${item.packId} introuvable.` });
        // Un pack d'un autre établissement n'a rien à faire dans cette vente.
        if (pack.establishment_id !== cible.id) {
          return res.status(400).json({ error: `${pack.nom} n'appartient pas à cet établissement.` });
        }

        const composants = pack.pack_items ?? [];
        let cout = 0;
        if (composants.length) {
          const { data: sousProduits } = await supabase
            .from("products").select("id, prix_achat").in("id", composants.map((c) => c.product_id));
          const prixAchat = new Map((sousProduits ?? []).map((p) => [p.id, Number(p.prix_achat)]));
          cout = composants.reduce(
            (s, c) => s + (prixAchat.get(c.product_id) ?? 0) * Number(c.quantite), 0
          );
        }

        lignes.push({
          product_id: null, pack_id: pack.id, libelle: pack.nom, quantite,
          prix_unitaire: Number(pack.prix_vente),
          prix_achat_unitaire: cout,
          montant: Number(pack.prix_vente) * quantite,
        });
      } else {
        const produit = parProduit.get(Number(item.productId)) as
          | { id: number; nom: string; prix_vente: number; prix_achat: number; actif: boolean;
              gere_stock: boolean; quantite: number; establishment_id: number }
          | undefined;
        if (!produit) return res.status(400).json({ error: `Article ${item.productId} introuvable.` });
        if (produit.establishment_id !== cible.id) {
          return res.status(400).json({ error: `${produit.nom} n'appartient pas à cet établissement.` });
        }
        if (!produit.actif) return res.status(400).json({ error: `${produit.nom} n'est plus au catalogue.` });

        if (produit.gere_stock && Number(produit.quantite) < quantite) {
          return res.status(409).json({
            error: `Stock insuffisant pour ${produit.nom} : ${Number(produit.quantite)} disponible(s), ${quantite} demandé(s).`,
          });
        }

        lignes.push({
          product_id: produit.id, pack_id: null, libelle: produit.nom, quantite,
          prix_unitaire: Number(produit.prix_vente),
          prix_achat_unitaire: Number(produit.prix_achat),
          montant: Number(produit.prix_vente) * quantite,
        });
      }
    }

    const sousTotal = lignes.reduce((s, l) => s + l.montant, 0);
    const remiseNum = Math.max(0, Number(remise) || 0);
    if (remiseNum > sousTotal) {
      return res.status(400).json({ error: "La remise ne peut pas dépasser le sous-total." });
    }
    const coutTotal = lignes.reduce((s, l) => s + l.prix_achat_unitaire * l.quantite, 0);

    const vente = await insertionAvecNumero<{ id: number; numero_recu: string }>(
      "EMS", "sales", "numero_recu",
      (numero) => ({
        numero_recu: numero,
        establishment_id: cible.id,
        session_id: session?.id ?? null,
        customer_id: customerId ?? null,
        vendeur_id: req.profil!.id,
        payment_method: paymentMethod ?? "especes",
        numero_transaction: numeroTransaction ?? null,
        sous_total: sousTotal,
        remise: remiseNum,
        total: sousTotal - remiseNum,
        cout_total: coutTotal,
      })
    );

    const { error: errLignes } = await supabase
      .from("sale_items").insert(lignes.map((l) => ({ ...l, sale_id: vente.id })));
    if (errLignes) {
      // Une vente sans ligne est une incohérence pire qu'une vente absente.
      await supabase.from("sales").delete().eq("id", vente.id);
      throw new Error(errLignes.message);
    }

    for (const ligne of lignes) {
      if (!ligne.product_id) continue;
      const { error } = await supabase.rpc("apply_stock_movement", {
        p_product_id: ligne.product_id,
        p_delta: -ligne.quantite,
        p_type: "sortie",
        p_motif: `Vente ${vente.numero_recu}`,
        p_ref_type: "sale",
        p_ref_id: vente.id,
        p_user: req.profil!.id,
      });
      if (error) console.error("[stock] décrément échoué:", error.message, ligne);
    }

    if (session) {
      await supabase.from("cash_movements").insert({
        session_id: session.id,
        type: "vente",
        montant: sousTotal - remiseNum,
        motif: `Vente ${vente.numero_recu}`,
        payment_method: paymentMethod ?? "especes",
        sale_id: vente.id,
        created_by: req.profil!.id,
      });
    }

    res.status(201).json({
      id: vente.id, numeroRecu: vente.numero_recu, total: sousTotal - remiseNum,
    });
  }));

  /**
   * §5.2 « Éventuelle annulation » + §5.10 : motif obligatoire, auteur et heure
   * conservés. La vente n'est jamais supprimée — elle passe au statut annulée,
   * le stock est restitué et un mouvement de caisse inverse est écrit.
   */
  api.post("/sales/:id/cancel", requireRole(...VALIDENT), route(async (req, res) => {
    const { motif } = req.body;
    if (!motif || String(motif).trim().length < 3) {
      return res.status(400).json({ error: "Un motif d'annulation est obligatoire." });
    }

    const { data: vente, error: errVente } = await supabase
      .from("sales").select("*").eq("id", req.params.id).single();
    if (errVente) throw new Error(errVente.message);

    if (!estTransversal(req.profil!) && vente.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cette vente ne relève pas de votre établissement." });
    }
    if (vente.statut === "annulee") {
      return res.status(409).json({ error: "Cette vente est déjà annulée." });
    }

    const { data: maj, error } = await supabase
      .from("sales")
      .update({
        statut: "annulee",
        motif_annulation: motif,
        annule_par: req.profil!.id,
        annule_le: new Date().toISOString(),
      })
      .eq("id", req.params.id).eq("statut", "validee")
      .select().single();
    if (error) throw new Error(error.message);

    const { data: lignes } = await supabase
      .from("sale_items").select("*").eq("sale_id", req.params.id);
    for (const ligne of lignes ?? []) {
      if (!ligne.product_id) continue;
      await supabase.rpc("apply_stock_movement", {
        p_product_id: ligne.product_id,
        p_delta: Number(ligne.quantite),
        p_type: "entree",
        p_motif: `Annulation vente ${vente.numero_recu}`,
        p_ref_type: "sale_cancel",
        p_ref_id: vente.id,
        p_user: req.profil!.id,
      });
    }

    // Contre-passation uniquement si la caisse est encore ouverte : annuler une
    // vente d'hier ne doit pas modifier une caisse déjà arrêtée dont l'écart a
    // été constaté.
    if (vente.session_id) {
      const { data: session } = await supabase
        .from("cash_sessions").select("statut").eq("id", vente.session_id).maybeSingle();
      if (session?.statut === "ouverte") {
        await supabase.from("cash_movements").insert({
          session_id: vente.session_id,
          type: "remboursement",
          montant: -Number(vente.total),
          motif: `Annulation vente ${vente.numero_recu} — ${motif}`,
          payment_method: vente.payment_method,
          sale_id: vente.id,
          created_by: req.profil!.id,
        });
      }
    }

    journaliser(req.profil!, "annulation_vente", "sales", vente.id, {
      motif, avant: vente, apres: maj,
    });
    res.json(toCamelCase(maj));
  }));

  // -------------------------------------------------------------------------
  // §5.5 Stock
  // -------------------------------------------------------------------------

  /** Identifiants des articles de la portée, pour filtrer les mouvements. */
  async function produitsDeLaPortee(id: number | null): Promise<number[] | null> {
    if (id === null) return null;
    const { data } = await supabase.from("products").select("id").eq("establishment_id", id);
    return (data ?? []).map((p) => p.id as number);
  }

  api.get("/stock/movements", route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase
      .from("stock_movements").select("*, products(nom)")
      .order("created_at", { ascending: false });

    if (req.query.productId) {
      q = q.eq("product_id", req.query.productId);
    } else {
      const ids = await produitsDeLaPortee(portee.id);
      if (ids) {
        if (ids.length === 0) return res.json([]);
        q = q.in("product_id", ids);
      }
    }

    const { data, error } = await q.limit(300);
    if (error) throw new Error(error.message);

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((row: Record<string, unknown>) => {
        const { products, ...reste } = row as { products?: { nom: string }; created_by?: string };
        return {
          ...toCamelCase(reste),
          produitNom: products?.nom ?? null,
          createdByNom: reste.created_by ? noms.get(reste.created_by) ?? null : null,
        };
      })
    );
  }));

  api.get("/stock/alerts", route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase
      .from("products").select("id, nom, establishment_id, quantite, seuil_alerte, unite")
      .eq("actif", true).eq("gere_stock", true);
    q = filtrerEtablissement(q, portee.id);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const lignes = (data ?? []).map((p) => ({
      id: p.id, nom: p.nom, establishmentId: p.establishment_id, unite: p.unite,
      quantite: Number(p.quantite), seuilAlerte: Number(p.seuil_alerte),
    }));

    res.json({
      ruptures: lignes.filter((p) => p.quantite <= 0),
      bientotEnRupture: lignes.filter((p) => p.quantite > 0 && p.quantite <= p.seuilAlerte),
    });
  }));

  api.post("/stock/adjust", requireRole(...VALIDENT), route(async (req, res) => {
    const { productId, quantiteReelle, motif } = req.body;
    if (!motif || !String(motif).trim()) {
      return res.status(400).json({ error: "Un motif est obligatoire pour tout ajustement de stock." });
    }

    const { data: produit, error: errProduit } = await supabase
      .from("products").select("*").eq("id", productId).single();
    if (errProduit) throw new Error(errProduit.message);

    if (!estTransversal(req.profil!) && produit.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cet article ne relève pas de votre établissement." });
    }
    if (!produit.gere_stock) {
      return res.status(400).json({ error: "Cet article ne fait pas l'objet d'un suivi de stock." });
    }

    const ecart = Number(quantiteReelle) - Number(produit.quantite);
    if (ecart === 0) return res.json({ ok: true, ecart: 0 });

    const { error } = await supabase.rpc("apply_stock_movement", {
      p_product_id: productId,
      p_delta: ecart,
      p_type: "ajustement",
      p_motif: motif,
      p_ref_type: "inventaire",
      p_ref_id: null,
      p_user: req.profil!.id,
    });
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "ajustement_stock", "products", productId, {
      motif,
      avant: { quantite: Number(produit.quantite) },
      apres: { quantite: Number(quantiteReelle) },
    });
    res.json({ ok: true, ecart });
  }));

  /**
   * Dernier achat de chaque article.
   *
   * C'est ce qui relie concrètement les deux moitiés de l'écran
   * Approvisionnement : devant une rupture, la question n'est pas seulement
   * « combien en reste-t-il » mais « quand en a-t-on commandé pour la dernière
   * fois, à qui, et à quel prix ». Sans cette information, on repasse commande
   * sans savoir si la précédente est en route.
   *
   * Une seule requête pour tout le catalogue : interroger article par article
   * ferait cent appels sur un écran qui s'ouvre à chaque rupture.
   */
  api.get("/stock/derniers-achats", requireRole(...TOUS), route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let qAchats = supabase.from("purchases")
      .select("id, numero, date_achat, supplier_id, montant_restant")
      .order("date_achat", { ascending: false }).limit(400);
    qAchats = filtrerEtablissement(qAchats, portee.id);
    const { data: achats, error } = await qAchats;
    if (error) throw new Error(error.message);
    if (!achats?.length) return res.json({});

    const [{ data: lignes }, { data: fournisseurs }] = await Promise.all([
      supabase.from("purchase_items")
        .select("purchase_id, product_id, quantite, prix_unitaire")
        .in("purchase_id", achats.map((a) => a.id)),
      supabase.from("suppliers").select("id, nom"),
    ]);

    const achatParId = new Map(achats.map((a) => [a.id, a]));
    const nomFournisseur = new Map((fournisseurs ?? []).map((f) => [f.id, f.nom]));

    // Les achats arrivent du plus récent au plus ancien : la première ligne
    // rencontrée pour un article est donc la bonne, et on ne l'écrase plus.
    const dernier: Record<string, unknown> = {};
    for (const a of achats) {
      for (const l of (lignes ?? []).filter((x) => x.purchase_id === a.id)) {
        if (!l.product_id || dernier[l.product_id]) continue;
        const achat = achatParId.get(a.id)!;
        dernier[l.product_id] = {
          numero: achat.numero,
          date: achat.date_achat,
          // Ce qu'on doit encore sur cet achat : devant une rupture, savoir
          // qu'on doit déjà de l'argent au fournisseur change la conversation.
          restantDu: Number(achat.montant_restant),
          fournisseur: achat.supplier_id ? nomFournisseur.get(achat.supplier_id) ?? null : null,
          quantite: Number(l.quantite),
          prixUnitaire: Number(l.prix_unitaire),
        };
      }
    }

    res.json(dernier);
  }));

  // -------------------------------------------------------------------------
  // §5.6 Achats
  // -------------------------------------------------------------------------

  api.get("/purchases", requireRole(...TOUS), route(async (req, res) => {
    const { debutJour, finJour } = bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("purchases").select("*, suppliers(nom)")
      .gte("date_achat", debutJour).lte("date_achat", finJour)
      .order("date_achat", { ascending: false });
    q = filtrerEtablissement(q, portee.id);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const [noms, etabs] = await Promise.all([nomsEmployes(), nomsEtablissements()]);
    res.json(
      (data ?? []).map((row: Record<string, unknown>) => {
        const { suppliers, ...reste } = row as {
          suppliers?: { nom: string }; effectue_par?: string; establishment_id?: number;
        };
        return {
          ...toCamelCase(reste),
          fournisseurNom: suppliers?.nom ?? null,
          etablissementNom: etabs.get(reste.establishment_id!)?.nom ?? null,
          effectueParNom: reste.effectue_par ? noms.get(reste.effectue_par) ?? null : null,
        };
      })
    );
  }));

  api.post("/purchases", requireRole(...TOUS), route(async (req, res) => {
    const { supplierId, dateAchat, montantPaye, paymentMethod, justificatif, notes, items } = req.body;

    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "L'achat doit contenir au moins une ligne." });
    }

    const lignes = items.map((it: {
      productId?: number; libelle: string; quantite: number; prixUnitaire: number;
    }) => ({
      product_id: it.productId ?? null,
      libelle: it.libelle,
      quantite: Number(it.quantite),
      prix_unitaire: Number(it.prixUnitaire),
      montant: Number(it.quantite) * Number(it.prixUnitaire),
    }));
    const montantTotal = lignes.reduce((s, l) => s + l.montant, 0);
    const paye = Math.min(Number(montantPaye) || 0, montantTotal);

    const achat = await insertionAvecNumero<{ id: number; numero: string }>(
      "ACH", "purchases", "numero",
      (numero) => ({
        numero,
        supplier_id: supplierId ?? null,
        establishment_id: cible.id,
        date_achat: dateAchat ?? jourLocal(new Date()),
        montant_total: montantTotal,
        montant_paye: paye,
        payment_method: paymentMethod ?? "especes",
        effectue_par: req.profil!.id,
        justificatif: justificatif ?? null,
        notes: notes ?? null,
      })
    );

    const { error: errLignes } = await supabase
      .from("purchase_items").insert(lignes.map((l) => ({ ...l, purchase_id: achat.id })));
    if (errLignes) {
      await supabase.from("purchases").delete().eq("id", achat.id);
      throw new Error(errLignes.message);
    }

    // Un achat alimente le stock, et aligne le prix d'achat sur le dernier prix
    // payé pour que la marge du §5.13 reste juste.
    for (const ligne of lignes) {
      if (!ligne.product_id) continue;
      await supabase.rpc("apply_stock_movement", {
        p_product_id: ligne.product_id,
        p_delta: ligne.quantite,
        p_type: "entree",
        p_motif: `Achat ${achat.numero}`,
        p_ref_type: "purchase",
        p_ref_id: achat.id,
        p_user: req.profil!.id,
      });
      await supabase
        .from("products").update({ prix_achat: ligne.prix_unitaire }).eq("id", ligne.product_id);
    }

    journaliser(req.profil!, "creation_achat", "purchases", achat.id, {
      apres: { numero: achat.numero, montantTotal, paye },
    });
    res.status(201).json({ id: achat.id, numero: achat.numero, montantTotal });
  }));

  api.post("/purchases/:id/pay", requireRole(...TOUS), route(async (req, res) => {
    const { data: achat, error: errAchat } = await supabase
      .from("purchases").select("*").eq("id", req.params.id).single();
    if (errAchat) throw new Error(errAchat.message);

    if (!estTransversal(req.profil!) && achat.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cet achat ne relève pas de votre établissement." });
    }

    const nouveauPaye = Math.min(
      Number(achat.montant_paye) + (Number(req.body.montant) || 0),
      Number(achat.montant_total)
    );

    const { data, error } = await supabase
      .from("purchases").update({ montant_paye: nouveauPaye }).eq("id", req.params.id)
      .select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "reglement_achat", "purchases", req.params.id, {
      avant: { paye: Number(achat.montant_paye) }, apres: { paye: nouveauPaye },
    });
    res.json(toCamelCase(data));
  }));

  api.get("/purchases/:id", requireRole(...TOUS), route(async (req, res) => {
    const [{ data: achat }, { data: lignes }] = await Promise.all([
      supabase.from("purchases").select("*, suppliers(nom)").eq("id", req.params.id).single(),
      supabase.from("purchase_items").select("*").eq("purchase_id", req.params.id).order("id"),
    ]);
    if (!achat) return res.status(404).json({ error: "Achat introuvable." });
    if (!estTransversal(req.profil!) && achat.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cet achat ne relève pas de votre établissement." });
    }

    const { suppliers, ...reste } = achat as { suppliers?: { nom: string } };
    res.json({
      ...toCamelCase(reste),
      fournisseurNom: suppliers?.nom ?? null,
      items: toCamelCaseArray(lignes ?? []),
    });
  }));

  // -------------------------------------------------------------------------
  // §5.7 Dépenses
  // -------------------------------------------------------------------------

  api.get("/expenses", route(async (req, res) => {
    const { debutJour, finJour } = bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("expenses").select("*")
      .gte("date_depense", debutJour).lte("date_depense", finJour)
      .order("date_depense", { ascending: false });
    q = filtrerEtablissement(q, portee.id);

    const { data, error } = await q.limit(500);
    if (error) throw new Error(error.message);

    const [noms, etabs] = await Promise.all([nomsEmployes(), nomsEtablissements()]);
    res.json(
      (data ?? []).map((d) => ({
        ...toCamelCase(d),
        etablissementNom: etabs.get(d.establishment_id)?.nom ?? null,
        effectueParNom: d.effectue_par ? noms.get(d.effectue_par) ?? null : null,
        valideParNom: d.valide_par ? noms.get(d.valide_par) ?? null : null,
      }))
    );
  }));

  api.post("/expenses", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { categorie, montant, motif, dateDepense, paymentMethod, justificatif } = req.body;

    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });
    if (!motif || !String(motif).trim()) {
      return res.status(400).json({ error: "Le motif de la dépense est obligatoire." });
    }
    if (!(Number(montant) > 0)) {
      return res.status(400).json({ error: "Le montant doit être supérieur à zéro." });
    }

    const session = await sessionOuverte(cible.id);
    const methode: PaymentMethod = paymentMethod ?? "especes";

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        establishment_id: cible.id,
        categorie,
        montant: Number(montant),
        motif,
        date_depense: dateDepense ?? jourLocal(new Date()),
        payment_method: methode,
        effectue_par: req.profil!.id,
        justificatif: justificatif ?? null,
        session_id: session?.id ?? null,
        // L'auteur ne valide pas sa propre dépense : la validation reste un acte
        // distinct, confié à un responsable (§5.7).
        valide_par: null,
      })
      .select().single();
    if (error) throw new Error(error.message);

    // Une dépense en espèces sort du tiroir : sans cette écriture, l'écart de
    // fermeture serait systématiquement négatif.
    if (session) {
      await supabase.from("cash_movements").insert({
        session_id: session.id,
        type: "depense",
        montant: -Number(montant),
        motif: `Dépense — ${motif}`,
        payment_method: methode,
        expense_id: data.id,
        created_by: req.profil!.id,
      });
    }

    journaliser(req.profil!, "creation_depense", "expenses", data.id, { motif, apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  api.post("/expenses/:id/validate", requireRole(...VALIDENT), route(async (req, res) => {
    const { data: depense } = await supabase
      .from("expenses").select("establishment_id").eq("id", req.params.id).maybeSingle();
    if (!depense) return res.status(404).json({ error: "Dépense introuvable." });
    if (!estTransversal(req.profil!) && depense.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cette dépense ne relève pas de votre établissement." });
    }

    const { data, error } = await supabase
      .from("expenses")
      .update({ valide_par: req.profil!.id, valide_le: new Date().toISOString() })
      .eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "validation_depense", "expenses", req.params.id, { apres: data });
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.8 Commandes
  // -------------------------------------------------------------------------

  api.get("/orders", route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("orders").select("*").order("date_commande", { ascending: false });
    q = filtrerEtablissement(q, portee.id);
    if (req.query.statut) q = q.eq("statut", String(req.query.statut));

    const { data, error } = await q.limit(300);
    if (error) throw new Error(error.message);

    // Numéro de reçu des commandes déjà encaissées : c'est ce qui permet de
    // retrouver la vente correspondante depuis la liste, sans avoir à la
    // chercher par le montant et la date.
    const idsVentes = (data ?? []).map((c) => c.sale_id).filter(Boolean) as number[];
    const { data: ventes } = idsVentes.length
      ? await supabase.from("sales").select("id, numero_recu").in("id", idsVentes)
      : { data: [] as { id: number; numero_recu: string }[] };
    const recuParVente = new Map((ventes ?? []).map((v) => [v.id, v.numero_recu]));

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((c) => ({
        ...toCamelCase(c),
        technicienNom: c.technicien_id ? noms.get(c.technicien_id) ?? null : null,
        numeroRecu: c.sale_id ? recuParVente.get(c.sale_id) ?? null : null,
      }))
    );
  }));

  api.post("/orders", requireRole(...TOUS), route(async (req, res) => {
    const {
      customerId, customerNom, customerTelephone, typePrestation, description,
      quantite, prixUnitaire, acompte, dateLivraisonPrevue, technicienId,
    } = req.body;

    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });
    if (!customerNom || !typePrestation) {
      return res.status(400).json({ error: "Le nom du client et le type de prestation sont obligatoires." });
    }

    const qte = Number(quantite) || 1;
    const pu = Number(prixUnitaire) || 0;
    const total = qte * pu;
    const avance = Math.min(Math.max(0, Number(acompte) || 0), total);

    const commande = await insertionAvecNumero<Record<string, unknown>>(
      "CMD", "orders", "numero",
      (numero) => ({
        numero,
        establishment_id: cible.id,
        customer_id: customerId ?? null,
        customer_nom: customerNom,
        customer_telephone: customerTelephone ?? null,
        type_prestation: typePrestation,
        description: description ?? null,
        quantite: qte,
        prix_unitaire: pu,
        montant_total: total,
        acompte: avance,
        date_livraison_prevue: dateLivraisonPrevue ?? null,
        technicien_id: technicienId ?? (req.profil!.role === "technicien" ? req.profil!.id : null),
      })
    );

    journaliser(req.profil!, "creation_commande", "orders", commande.id as number, { apres: commande });
    res.status(201).json(toCamelCase(commande));
  }));

  /**
   * Statuts qui closent une commande et déclenchent l'encaissement.
   *
   * Les deux, et non le seul « livré » : certaines prestations sont réglées
   * quand le travail est fini, d'autres à la remise. Prendre le premier des
   * deux atteints évite qu'une commande passée directement à « livré » saute
   * l'encaissement, et le verrou `sale_id` empêche de compter deux fois celle
   * qui traverse les deux étapes.
   */
  const STATUTS_CLOTURE = ["termine", "livre"];

  /**
   * Transforme une commande close en vente.
   *
   * Une commande terminée est de l'argent gagné : tant qu'elle ne devenait pas
   * une vente, son montant n'entrait ni au chiffre d'affaires, ni en caisse, ni
   * en comptabilité, et il fallait la ressaisir à la main — ce que personne ne
   * fait. La vente est donc produite ici, une fois, au moment où la commande
   * se clôt.
   *
   * Le montant retenu est le total, pas le reste dû : l'acompte encaissé à la
   * prise de commande n'a jamais été enregistré ailleurs. Le compter ici remet
   * la recette entière au bon endroit, à la date de clôture.
   */
  async function venteDepuisCommande(commande: Record<string, unknown>, profil: Profil) {
    const etablissement = commande.establishment_id as number;
    const total = Number(commande.montant_total);
    const session = await sessionOuverte(etablissement);
    const moyen = (commande.payment_method as string) ?? "especes";

    const vente = await insertionAvecNumero<{ id: number; numero_recu: string }>(
      "EMS", "sales", "numero_recu",
      (numero) => ({
        numero_recu: numero,
        establishment_id: etablissement,
        session_id: session?.id ?? null,
        customer_id: commande.customer_id ?? null,
        vendeur_id: profil.id,
        payment_method: moyen,
        sous_total: total,
        remise: 0,
        total,
        // Une prestation n'a pas de prix d'achat au catalogue : son coût est
        // le temps passé, que cette application ne suit pas. Laisser zéro est
        // honnête ; inventer un coût fausserait la marge.
        cout_total: 0,
      })
    );

    const { error: errLigne } = await supabase.from("sale_items").insert({
      sale_id: vente.id,
      product_id: null,
      pack_id: null,
      libelle: `${commande.type_prestation} — ${commande.numero}`,
      quantite: Number(commande.quantite) || 1,
      prix_unitaire: Number(commande.prix_unitaire) || total,
      prix_achat_unitaire: 0,
      montant: total,
    });
    if (errLigne) {
      // Une vente sans ligne est une incohérence pire qu'une vente absente.
      await supabase.from("sales").delete().eq("id", vente.id);
      throw new Error(errLigne.message);
    }

    if (session) {
      await supabase.from("cash_movements").insert({
        session_id: session.id,
        type: "vente",
        montant: total,
        motif: `Commande ${commande.numero}`,
        payment_method: moyen,
        sale_id: vente.id,
        created_by: profil.id,
      });
    }

    return vente;
  }

  api.patch("/orders/:id", requireRole(...TOUS), route(async (req, res) => {
    const { data: avant } = await supabase
      .from("orders").select("*").eq("id", req.params.id).single();
    if (!avant) return res.status(404).json({ error: "Commande introuvable." });
    if (!estTransversal(req.profil!) && avant.establishment_id !== req.profil!.establishmentId) {
      return res.status(403).json({ error: "Cette commande ne relève pas de votre établissement." });
    }

    const { establishmentId: _fige, ...corps } = req.body as Record<string, unknown>;
    // Le total, le reste et le lien vers la vente se calculent, ils ne se
    // saisissent pas : les laisser passer permettrait de délier une commande
    // de sa vente depuis le navigateur.
    if (corps.quantite != null || corps.prixUnitaire != null) {
      const qte = Number(corps.quantite ?? avant.quantite);
      const pu = Number(corps.prixUnitaire ?? avant.prix_unitaire);
      corps.montantTotal = qte * pu;
    }
    delete corps.reste;
    delete corps.saleId;

    const statutVise = corps.statut as string | undefined;

    // Annuler une commande déjà encaissée laisserait une vente sans origine :
    // la recette resterait au chiffre d'affaires alors que la prestation est
    // abandonnée. On renvoie vers l'annulation de la vente, qui elle exige un
    // motif et restitue proprement.
    if (statutVise === "annule" && avant.sale_id) {
      return res.status(409).json({
        error: "Cette commande a déjà été encaissée. Annulez d'abord la vente correspondante dans l'écran Ventes.",
      });
    }

    // Modifier le montant d'une commande déjà encaissée ferait diverger la
    // commande et sa vente : le même travail afficherait deux prix.
    if (corps.montantTotal != null && avant.sale_id
        && Number(corps.montantTotal) !== Number(avant.montant_total)) {
      return res.status(409).json({
        error: "Cette commande a déjà été encaissée : son montant ne peut plus changer.",
      });
    }

    const { data, error } = await supabase
      .from("orders").update(toSnakeCase(corps)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    // La vente est produite après la mise à jour du statut : si elle échoue,
    // la commande reste close et l'erreur est visible, plutôt que d'annuler
    // silencieusement un changement que l'utilisateur croit fait.
    let vente: { id: number; numero_recu: string } | null = null;
    if (statutVise && STATUTS_CLOTURE.includes(statutVise) && !avant.sale_id) {
      vente = await venteDepuisCommande(data, req.profil!);
      const { data: liee } = await supabase
        .from("orders").update({ sale_id: vente.id }).eq("id", req.params.id).select().single();
      if (liee) Object.assign(data, liee);

      journaliser(req.profil!, "encaissement_commande", "orders", req.params.id, {
        motif: `Vente ${vente.numero_recu} générée à la clôture`,
        apres: { saleId: vente.id, numeroRecu: vente.numero_recu },
      });
    }

    journaliser(req.profil!, "modification_commande", "orders", req.params.id, {
      avant, apres: data, motif: req.body.motif,
    });

    res.json({
      ...toCamelCase(data),
      /** Renseigné seulement au moment où la vente vient d'être créée. */
      venteGeneree: vente ? { id: vente.id, numeroRecu: vente.numero_recu } : null,
    });
  }));

  // -------------------------------------------------------------------------
  // §5.11 Tableau de bord
  // -------------------------------------------------------------------------

  api.get("/dashboard", route(async (req, res) => {
    const { debut, fin, debutJour, finJour } = bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    // §5.1 : caissier et technicien n'ont qu'une consultation limitée. Leur
    // afficher marges et bénéfice reviendrait à leur ouvrir la comptabilité par
    // la fenêtre du tableau de bord.
    const restreint = personnelDeTerrain(req.profil!);

    let qVentes = supabase
      .from("sales").select("establishment_id, total, cout_total, created_at, statut, vendeur_id")
      .gte("created_at", debut.toISOString()).lt("created_at", fin.toISOString())
      .eq("statut", "validee");
    qVentes = filtrerEtablissement(qVentes, portee.id);
    if (restreint) qVentes = qVentes.eq("vendeur_id", req.profil!.id);

    let qDepenses = supabase.from("expenses").select("establishment_id, montant, date_depense")
      .gte("date_depense", debutJour).lte("date_depense", finJour);
    qDepenses = filtrerEtablissement(qDepenses, portee.id);

    let qSessions = supabase.from("cash_sessions").select("*").eq("statut", "ouverte");
    qSessions = filtrerEtablissement(qSessions, portee.id);

    let qAlertes = supabase.from("products").select("id, nom, quantite, seuil_alerte")
      .eq("actif", true).eq("gere_stock", true);
    qAlertes = filtrerEtablissement(qAlertes, portee.id);

    const [{ data: ventes }, depensesRes, { data: sessions }, alertes, etabs] = await Promise.all([
      qVentes,
      restreint
        ? Promise.resolve({ data: [] as { establishment_id: number; montant: number; date_depense: string }[] })
        : qDepenses,
      qSessions,
      qAlertes,
      nomsEtablissements(),
    ]);

    const lignesVentes = ventes ?? [];
    const depenses = depensesRes.data ?? [];

    // --- Agrégation par établissement, jamais fondue ---
    const concernes = portee.id === null
      ? [...etabs.values()].filter((e) => e.actif)
      : [etabs.get(portee.id)].filter(Boolean) as EtabResume[];

    const parEtablissement: LigneEtablissement[] = concernes.map((e) => {
      const v = lignesVentes.filter((x) => x.establishment_id === e.id);
      const ca = v.reduce((s, x) => s + Number(x.total), 0);
      const cout = v.reduce((s, x) => s + Number(x.cout_total), 0);
      const dep = depenses.filter((d) => d.establishment_id === e.id)
        .reduce((s, d) => s + Number(d.montant), 0);
      return {
        establishmentId: e.id, nom: e.nom, couleur: e.couleur,
        ca, cout, marge: ca - cout, nbVentes: v.length,
        depenses: restreint ? 0 : dep,
        tresorerie: restreint ? 0 : ca - dep,
        resultat: restreint ? 0 : ca - cout - dep,
      };
    });

    const ca = parEtablissement.reduce((s, e) => s + e.ca, 0);
    const cout = parEtablissement.reduce((s, e) => s + e.cout, 0);
    const totalDepenses = depenses.reduce((s, d) => s + Number(d.montant), 0);
    const margeBrute = ca - cout;

    // --- Série journalière, une valeur par établissement ---
    const parJour = new Map<string, { depenses: number; valeurs: Record<string, number> }>();
    const initJour = (cle: string) => {
      if (!parJour.has(cle)) parJour.set(cle, { depenses: 0, valeurs: {} });
      return parJour.get(cle)!;
    };
    for (const v of lignesVentes) {
      const jour = initJour(jourLocal(new Date(v.created_at)));
      const cle = String(v.establishment_id);
      jour.valeurs[cle] = (jour.valeurs[cle] ?? 0) + Number(v.total);
    }
    for (const d of depenses) {
      initJour(String(d.date_depense).slice(0, 10)).depenses += Number(d.montant);
    }

    const noms = await nomsEmployes();
    const caisses = await Promise.all(
      (sessions ?? []).map(async (s) => ({
        establishmentId: s.establishment_id as number,
        etablissementNom: etabs.get(s.establishment_id)?.nom ?? "—",
        sessionId: s.id,
        ouvertePar: noms.get(s.opened_by) ?? "—",
        ouverteA: s.opened_at,
        soldeTheorique: await soldeTheorique(s.id, Number(s.fonds_initial)),
      }))
    );

    const produits = (alertes.data ?? []).map((p) => ({
      id: p.id, nom: p.nom,
      quantite: Number(p.quantite), seuilAlerte: Number(p.seuil_alerte),
    }));

    const stats: DashboardStats = {
      restreint,
      etablissementId: portee.id,
      etablissementNom: await nomEtablissement(portee.id),
      ca,
      nbVentes: lignesVentes.length,
      // Marge, dépenses et bénéfice ne sont pas seulement masqués à l'écran :
      // ils ne quittent pas le serveur pour un profil restreint.
      depenses: restreint ? 0 : totalDepenses,
      margeBrute: restreint ? 0 : margeBrute,
      beneficeEstimatif: restreint ? 0 : margeBrute - totalDepenses,
      tresorerie: restreint ? 0 : ca - totalDepenses,
      parEtablissement,
      caisses,
      ruptures: produits.filter((p) => p.quantite <= 0),
      bientotEnRupture: produits.filter((p) => p.quantite > 0 && p.quantite <= p.seuilAlerte),
      serie: [...parJour.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v })),
    };
    res.json(stats);
  }));

  // -------------------------------------------------------------------------
  // §5.12 Rapports — §5.13 Comptabilité
  // -------------------------------------------------------------------------

  api.get("/reports", requireRole(...VALIDENT), route(async (req, res) => {
    const { debut, fin, debutJour, finJour, libelle } =
      bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    const debutISO = debut.toISOString();
    const finISO = fin.toISOString();

    let qVentes = supabase.from("sales")
      .select("id, establishment_id, total, cout_total, vendeur_id, payment_method")
      .gte("created_at", debutISO).lt("created_at", finISO).eq("statut", "validee");
    qVentes = filtrerEtablissement(qVentes, portee.id);

    let qDepenses = supabase.from("expenses").select("establishment_id, categorie, montant")
      .gte("date_depense", debutJour).lte("date_depense", finJour);
    qDepenses = filtrerEtablissement(qDepenses, portee.id);

    let qAchats = supabase.from("purchases")
      .select("montant_total, montant_paye, montant_restant")
      .gte("date_achat", debutJour).lte("date_achat", finJour);
    qAchats = filtrerEtablissement(qAchats, portee.id);

    let qSessions = supabase.from("cash_sessions").select("*").eq("statut", "fermee")
      .gte("closed_at", debutISO).lt("closed_at", finISO);
    qSessions = filtrerEtablissement(qSessions, portee.id);

    const [{ data: ventes }, { data: depenses }, { data: achats }, { data: sessions }, etabs] =
      await Promise.all([qVentes, qDepenses, qAchats, qSessions, nomsEtablissements()]);

    const lignesVentes = ventes ?? [];
    const idsVentes = lignesVentes.map((v) => v.id);

    // Détail produit chargé par lots : PostgREST limite la taille des filtres `in`.
    const detail: {
      libelle: string; quantite: number; montant: number;
      prix_achat_unitaire: number; sale_id: number;
    }[] = [];
    for (let i = 0; i < idsVentes.length; i += 200) {
      const { data } = await supabase
        .from("sale_items")
        .select("libelle, quantite, montant, prix_achat_unitaire, sale_id")
        .in("sale_id", idsVentes.slice(i, i + 200));
      detail.push(...((data ?? []) as typeof detail));
    }

    const etabParVente = new Map(lignesVentes.map((v) => [v.id, v.establishment_id as number]));
    const noms = await nomsEmployes();
    const { data: profils } = await supabase.from("profiles").select("id, full_name, role");
    const roleParId = new Map((profils ?? []).map((p) => [p.id, p.role as UserRole]));

    // --- Par établissement
    const concernes = portee.id === null
      ? [...etabs.values()].filter((e) => e.actif)
      : [etabs.get(portee.id)].filter(Boolean) as EtabResume[];

    const parEtablissement: LigneEtablissement[] = concernes.map((e) => {
      const v = lignesVentes.filter((x) => x.establishment_id === e.id);
      const ca = v.reduce((s, x) => s + Number(x.total), 0);
      const cout = v.reduce((s, x) => s + Number(x.cout_total), 0);
      const dep = (depenses ?? []).filter((d) => d.establishment_id === e.id)
        .reduce((s, d) => s + Number(d.montant), 0);
      return {
        establishmentId: e.id, nom: e.nom, couleur: e.couleur,
        ca, cout, marge: ca - cout, nbVentes: v.length, depenses: dep,
        tresorerie: ca - dep,
        resultat: ca - cout - dep,
      };
    });

    // --- Par produit
    const parProduit = new Map<string, { etablissement: string; quantite: number; ca: number; marge: number }>();
    for (const l of detail) {
      const etabId = etabParVente.get(l.sale_id);
      const nomEtab = etabId ? etabs.get(etabId)?.nom ?? "—" : "—";
      const cle = `${l.libelle} ${nomEtab}`;
      const acc = parProduit.get(cle) ?? { etablissement: nomEtab, quantite: 0, ca: 0, marge: 0 };
      acc.quantite += Number(l.quantite);
      acc.ca += Number(l.montant);
      acc.marge += Number(l.montant) - Number(l.prix_achat_unitaire) * Number(l.quantite);
      parProduit.set(cle, acc);
    }
    const caParProduit = [...parProduit.entries()]
      .map(([cle, v]) => ({ produit: cle.split(" ")[0], ...v }))
      .sort((a, b) => b.ca - a.ca);

    // --- Par employé
    const parEmploye = new Map<string, { nbVentes: number; ca: number }>();
    for (const v of lignesVentes) {
      const acc = parEmploye.get(v.vendeur_id) ?? { nbVentes: 0, ca: 0 };
      acc.nbVentes += 1;
      acc.ca += Number(v.total);
      parEmploye.set(v.vendeur_id, acc);
    }
    const caParEmploye = [...parEmploye.entries()]
      .map(([id, v]) => ({
        employe: noms.get(id) ?? "—",
        role: roleParId.get(id) ?? ("caissier" as UserRole),
        ...v,
      }))
      .sort((a, b) => b.ca - a.ca);

    // --- Par mode de paiement
    const parPaiement = new Map<PaymentMethod, { montant: number; nbVentes: number }>();
    for (const v of lignesVentes) {
      const cle = v.payment_method as PaymentMethod;
      const acc = parPaiement.get(cle) ?? { montant: 0, nbVentes: 0 };
      acc.montant += Number(v.total);
      acc.nbVentes += 1;
      parPaiement.set(cle, acc);
    }

    // --- Dépenses par catégorie
    const parCategorie = new Map<ExpenseCategory, { montant: number; nb: number }>();
    for (const d of depenses ?? []) {
      const cle = d.categorie as ExpenseCategory;
      const acc = parCategorie.get(cle) ?? { montant: 0, nb: 0 };
      acc.montant += Number(d.montant);
      acc.nb += 1;
      parCategorie.set(cle, acc);
    }

    const ca = lignesVentes.reduce((s, v) => s + Number(v.total), 0);
    const coutMarchandises = lignesVentes.reduce((s, v) => s + Number(v.cout_total), 0);
    const totalDepenses = (depenses ?? []).reduce((s, d) => s + Number(d.montant), 0);

    const rapport: ReportData = {
      periode: { debut: debutISO, fin: finISO, libelle },
      etablissement: { id: portee.id, nom: await nomEtablissement(portee.id) },
      parEtablissement,
      caParProduit,
      caParEmploye,
      caParPaiement: [...parPaiement.entries()].map(([methode, v]) => ({ methode, ...v })),
      depensesParCategorie: [...parCategorie.entries()]
        .map(([categorie, v]) => ({ categorie, ...v }))
        .sort((a, b) => b.montant - a.montant),
      achats: {
        total: (achats ?? []).reduce((s, a) => s + Number(a.montant_total), 0),
        paye: (achats ?? []).reduce((s, a) => s + Number(a.montant_paye), 0),
        restant: (achats ?? []).reduce((s, a) => s + Number(a.montant_restant), 0),
        nb: (achats ?? []).length,
      },
      totaux: {
        ca,
        coutMarchandises,
        margeBrute: ca - coutMarchandises,
        depenses: totalDepenses,
        resultat: ca - coutMarchandises - totalDepenses,
        nbVentes: lignesVentes.length,
        panierMoyen: lignesVentes.length ? Math.round(ca / lignesVentes.length) : 0,
      },
      meilleuresVentes: caParProduit.slice(0, 10)
        .map(({ produit, quantite, ca }) => ({ produit, quantite, ca })),
      faiblesVentes: [...caParProduit].sort((a, b) => a.quantite - b.quantite).slice(0, 10)
        .map(({ produit, quantite, ca }) => ({ produit, quantite, ca })),
      ecartsCaisse: (sessions ?? []).map((s) => ({
        sessionId: s.id,
        etablissement: etabs.get(s.establishment_id)?.nom ?? "—",
        date: s.closed_at,
        theorique: Number(s.solde_theorique ?? 0),
        physique: Number(s.solde_physique ?? 0),
        ecart: Number(s.ecart ?? 0),
        responsable: noms.get(s.closed_by ?? "") ?? "—",
      })),
    };
    res.json(rapport);
  }));

  // -------------------------------------------------------------------------
  // Pointage du personnel
  // -------------------------------------------------------------------------

  /**
   * Pointe un collègue depuis un poste déjà ouvert.
   *
   * Au comptoir, demander au caissier de se déconnecter pour que le technicien
   * puisse pointer ferait perdre du temps à deux personnes. L'écran Pointage
   * reconnaît le visage et enregistre l'arrivée sans toucher à la session en
   * cours.
   */
  api.post("/pointage/visage", requireRole(...TOUS), route(async (req, res) => {
    const { empreinte } = req.body;
    if (!Array.isArray(empreinte) || empreinte.length !== 128) {
      return res.status(400).json({ error: "Image inexploitable. Réessayez." });
    }

    // On ne cherche que dans l'établissement où l'on se trouve : un agent de la
    // papeterie n'a pas à pouvoir pointer au restaurant depuis ce poste.
    const cible = etablissementEcriture(req.profil!, req.body.establishmentId);
    if (cible.erreur) return res.status(400).json({ error: cible.erreur });

    const { data: candidats, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, visage_empreinte, establishment_id")
      .eq("actif", true).eq("establishment_id", cible.id)
      .not("visage_empreinte", "is", null);
    if (error) throw new Error(error.message);

    const trouve = meilleureCorrespondance(empreinte as number[], candidats ?? []);
    if (!trouve) {
      return res.status(404).json({
        error: "Visage non reconnu. Placez-vous face à la caméra, dans un bon éclairage.",
      });
    }

    const pointage = await enregistrerPointage(trouve.id, cible.id, "visage", true);
    res.json({
      nom: trouve.full_name,
      pointage,
      dejaPointe: pointage === null,
    });
  }));

  /** Pointages de la journée, pour l'écran de pointage. */
  api.get("/pointage/jour", requireRole(...TOUS), route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    const jour = String(req.query.jour || jourLocal(new Date()));

    let q = supabase.from("pointages").select("*").eq("jour", jour).order("arrive_a");
    q = filtrerEtablissement(q, portee.id);

    const [{ data, error }, noms] = await Promise.all([q, nomsEmployes()]);
    if (error) throw new Error(error.message);

    // Le personnel attendu, pour distinguer « pas encore arrivé » de « absent ».
    let qAttendus = supabase
      .from("profiles").select("id, full_name, fonction, establishment_id")
      .eq("actif", true).eq("mode_connexion", "pin");
    qAttendus = filtrerEtablissement(qAttendus, portee.id);
    const { data: attendus } = await qAttendus;

    const pointes = new Set((data ?? []).map((p) => p.profile_id));
    res.json({
      jour,
      pointages: (data ?? []).map((p) => ({
        ...toCamelCase(p),
        nom: noms.get(p.profile_id) ?? "—",
      })),
      absents: (attendus ?? [])
        .filter((a) => !pointes.has(a.id))
        .map((a) => ({ id: a.id, fullName: a.full_name, fonction: a.fonction })),
    });
  }));

  /** Historique et bilan de présence, pour la direction. */
  api.get("/pointages", requireRole(...VALIDENT), route(async (req, res) => {
    const { debutJour, finJour, libelle } = bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let q = supabase.from("pointages").select("*")
      .gte("jour", debutJour).lte("jour", finJour)
      .order("jour", { ascending: false }).order("arrive_a", { ascending: false });
    q = filtrerEtablissement(q, portee.id);

    const [{ data, error }, noms, etabs] = await Promise.all([
      q, nomsEmployes(), nomsEtablissements(),
    ]);
    if (error) throw new Error(error.message);

    const lignes = (data ?? []).map((p) => ({
      ...toCamelCase(p),
      nom: noms.get(p.profile_id) ?? "—",
      etablissementNom: etabs.get(p.establishment_id)?.nom ?? "—",
    }));

    // Bilan par personne : nombre de jours travaillés, heure moyenne d'arrivée
    // et arrivées non vérifiées. C'est ce qui permet de juger la ponctualité
    // plutôt que de relire une liste de dates.
    const parPersonne = new Map<string, { nom: string; jours: number; minutes: number[]; nonVerifies: number }>();
    for (const p of data ?? []) {
      const acc = parPersonne.get(p.profile_id) ?? {
        nom: noms.get(p.profile_id) ?? "—", jours: 0, minutes: [], nonVerifies: 0,
      };
      acc.jours += 1;
      const local = versLocal(new Date(p.arrive_a));
      acc.minutes.push(local.getUTCHours() * 60 + local.getUTCMinutes());
      if (!p.verifie) acc.nonVerifies += 1;
      parPersonne.set(p.profile_id, acc);
    }

    const bilan = [...parPersonne.entries()].map(([id, v]) => {
      const moyenne = v.minutes.reduce((s, m) => s + m, 0) / (v.minutes.length || 1);
      const plusTot = Math.min(...v.minutes);
      const plusTard = Math.max(...v.minutes);
      const enMinutes = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
      return {
        profileId: id,
        nom: v.nom,
        jours: v.jours,
        arriveeMoyenne: enMinutes(moyenne),
        plusTot: enMinutes(plusTot),
        plusTard: enMinutes(plusTard),
        nonVerifies: v.nonVerifies,
      };
    }).sort((a, b) => a.nom.localeCompare(b.nom));

    res.json({ periode: libelle, pointages: lignes, bilan });
  }));

  // -------------------------------------------------------------------------
  // §5.13 Écritures comptables — le détail derrière les totaux
  // -------------------------------------------------------------------------

  /**
   * Journal chronologique de tout ce qui entre et sort.
   *
   * Le compte de résultat donne des totaux ; cette route donne les lignes qui
   * les composent, pour qu'un chiffre puisse toujours être justifié. Quatre
   * origines s'y mêlent :
   *   - les ventes validées (entrée d'argent) ;
   *   - les dépenses (sortie) ;
   *   - les achats fournisseurs, à hauteur de ce qui a réellement été payé —
   *     un achat à crédit ne sort rien de la caisse tant qu'il n'est pas réglé ;
   *   - les mouvements de caisse manuels, hors ventes et dépenses, qui y sont
   *     déjà comptés et feraient double emploi.
   */
  api.get("/ledger", requireRole(...VALIDENT), route(async (req, res) => {
    const { debut, fin, debutJour, finJour, libelle } =
      bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    let qVentes = supabase.from("sales")
      .select("id, numero_recu, establishment_id, total, payment_method, created_at, vendeur_id")
      .gte("created_at", debut.toISOString()).lt("created_at", fin.toISOString())
      .eq("statut", "validee");
    qVentes = filtrerEtablissement(qVentes, portee.id);

    let qDepenses = supabase.from("expenses")
      .select("id, establishment_id, categorie, montant, motif, date_depense, payment_method, effectue_par, valide_par")
      .gte("date_depense", debutJour).lte("date_depense", finJour);
    qDepenses = filtrerEtablissement(qDepenses, portee.id);

    let qAchats = supabase.from("purchases")
      .select("id, numero, establishment_id, montant_paye, montant_total, date_achat, payment_method, effectue_par, supplier_id")
      .gte("date_achat", debutJour).lte("date_achat", finJour);
    qAchats = filtrerEtablissement(qAchats, portee.id);

    const [{ data: ventes }, { data: depenses }, { data: achats }, etabs, noms] =
      await Promise.all([qVentes, qDepenses, qAchats, nomsEtablissements(), nomsEmployes()]);

    // Mouvements de caisse manuels : on part des sessions de la portée pour ne
    // pas ramener ceux d'un autre établissement.
    let qSessions = supabase.from("cash_sessions").select("id, establishment_id");
    qSessions = filtrerEtablissement(qSessions, portee.id);
    const { data: sessions } = await qSessions;
    const etabParSession = new Map((sessions ?? []).map((s) => [s.id, s.establishment_id as number]));

    let mouvements: Record<string, unknown>[] = [];
    if (etabParSession.size) {
      const { data } = await supabase.from("cash_movements")
        .select("id, session_id, type, montant, motif, payment_method, created_at, created_by")
        .in("session_id", [...etabParSession.keys()])
        .in("type", ["entree", "retrait", "depot", "remboursement", "autre"])
        .gte("created_at", debut.toISOString()).lt("created_at", fin.toISOString());
      mouvements = data ?? [];
    }

    const { data: fournisseurs } = await supabase.from("suppliers").select("id, nom");
    const nomFournisseur = new Map((fournisseurs ?? []).map((f) => [f.id, f.nom]));

    const ecritures = [
      ...(ventes ?? []).map((v) => ({
        date: v.created_at as string,
        type: "vente" as const,
        reference: v.numero_recu as string,
        libelle: "Encaissement de vente",
        etablissement: etabs.get(v.establishment_id as number)?.nom ?? "—",
        entree: Number(v.total),
        sortie: 0,
        moyen: v.payment_method as PaymentMethod,
        auteur: noms.get(v.vendeur_id as string) ?? "—",
        statut: null as string | null,
      })),
      ...(depenses ?? []).map((d) => ({
        date: `${d.date_depense}T12:00:00.000Z`,
        type: "depense" as const,
        reference: `DEP-${d.id}`,
        libelle: `${EXPENSE_LABELS_SERVEUR[d.categorie as ExpenseCategory] ?? d.categorie} — ${d.motif}`,
        etablissement: etabs.get(d.establishment_id as number)?.nom ?? "—",
        entree: 0,
        sortie: Number(d.montant),
        moyen: d.payment_method as PaymentMethod,
        auteur: noms.get(d.effectue_par as string) ?? "—",
        statut: d.valide_par ? "Validée" : "En attente de validation",
      })),
      ...(achats ?? [])
        // Un achat entièrement à crédit ne constitue pas une sortie d'argent :
        // il n'apparaît que le jour où il est réglé.
        .filter((a) => Number(a.montant_paye) > 0)
        .map((a) => ({
          date: `${a.date_achat}T12:00:00.000Z`,
          type: "achat" as const,
          reference: a.numero as string,
          libelle: `Achat fournisseur${a.supplier_id ? ` — ${nomFournisseur.get(a.supplier_id) ?? ""}` : ""}`,
          etablissement: etabs.get(a.establishment_id as number)?.nom ?? "—",
          entree: 0,
          sortie: Number(a.montant_paye),
          moyen: a.payment_method as PaymentMethod,
          auteur: noms.get(a.effectue_par as string) ?? "—",
          statut: Number(a.montant_paye) < Number(a.montant_total)
            ? `Reste dû ${Number(a.montant_total) - Number(a.montant_paye)}`
            : null,
        })),
      ...mouvements.map((m) => {
        const montant = Number(m.montant);
        return {
          date: m.created_at as string,
          type: "mouvement" as const,
          reference: `MVT-${m.id}`,
          libelle: `${CASH_MOVEMENT_LABELS_SERVEUR[m.type as string] ?? "Mouvement"} — ${m.motif ?? ""}`,
          etablissement: etabs.get(etabParSession.get(m.session_id as number) as number)?.nom ?? "—",
          entree: montant > 0 ? montant : 0,
          sortie: montant < 0 ? -montant : 0,
          moyen: m.payment_method as PaymentMethod,
          auteur: noms.get(m.created_by as string) ?? "—",
          statut: null as string | null,
        };
      }),
    ].sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      periode: libelle,
      etablissement: await nomEtablissement(portee.id),
      ecritures,
      totaux: {
        entrees: ecritures.reduce((s, e) => s + e.entree, 0),
        sorties: ecritures.reduce((s, e) => s + e.sortie, 0),
      },
    });
  }));

  // -------------------------------------------------------------------------
  // §5.10 Journal — commun à tous les établissements
  // -------------------------------------------------------------------------

  /**
   * Journal de toutes les opérations, pas seulement des actions sensibles.
   *
   * Deux sources s'y mêlent :
   *   - `audit_log`, qui garde la trace des gestes de contrôle (annulation,
   *     changement de prix, ajustement de stock…) avec l'avant et l'après ;
   *   - les opérations courantes — ventes, dépenses, achats, ouvertures et
   *     mouvements de caisse, mouvements de stock, commandes, pointages —
   *     reconstituées à la lecture depuis leurs propres tables.
   *
   * Les secondes ne sont volontairement pas recopiées dans `audit_log` : un
   * journal alimenté par duplication finit toujours par diverger de la réalité
   * qu'il est censé décrire, et c'est précisément ce qu'un journal ne doit pas
   * faire. Ici il ne peut pas mentir, il lit les mêmes lignes que les écrans.
   */
  api.get("/audit", requireRole(...VALIDENT), route(async (req, res) => {
    const { debut, fin, debutJour, finJour, libelle } =
      bornesPeriode(req.query as Record<string, unknown>);
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    const domaine = req.query.entite ? String(req.query.entite) : null;
    const veut = (e: string) => !domaine || domaine === e;

    // Les dépenses et les achats ne portent qu'une date, sans heure. Les placer
    // à midi les range au bon jour quel que soit le fuseau d'affichage, au lieu
    // de les faire basculer sur la veille.
    const iso = (jour: string) => `${jour}T12:00:00.000Z`;
    const dansLaPeriode = { gte: debut.toISOString(), lt: fin.toISOString() };

    const [etabs, noms] = await Promise.all([nomsEtablissements(), nomsEmployes()]);
    const nomEtab = (id: unknown) => etabs.get(id as number)?.nom ?? null;
    const nomAuteur = (id: unknown) => noms.get(id as string) ?? "—";

    const lignes: Record<string, unknown>[] = [];

    // --- Traces d'audit ------------------------------------------------------
    {
      let q = supabase.from("audit_log").select("*")
        .gte("created_at", dansLaPeriode.gte).lt("created_at", dansLaPeriode.lt)
        .order("created_at", { ascending: false }).limit(500);
      if (domaine) q = q.eq("entite", domaine);
      if (req.query.action) q = q.eq("action", String(req.query.action));

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      for (const a of data ?? []) {
        lignes.push({
          cle: `audit-${a.id}`,
          userId: a.user_id,
          userNom: nomAuteur(a.user_id),
          action: a.action,
          entite: a.entite,
          entiteId: a.entite_id,
          motif: a.motif,
          avant: a.avant,
          apres: a.apres,
          createdAt: a.created_at,
          etablissement: null,
          montant: null,
          trace: true,
        });
      }
    }

    // Un filtre d'action ne s'applique qu'aux traces : les opérations courantes
    // n'en portent pas, les inclure ferait mentir le filtre.
    if (!req.query.action) {
      const ajouter = (o: {
        cle: string; date: string; action: string; entite: string; entiteId: string;
        motif: string; auteur: unknown; etablissement: unknown; montant?: number;
      }) => lignes.push({
        cle: o.cle,
        userId: (o.auteur as string) ?? null,
        userNom: nomAuteur(o.auteur),
        action: o.action,
        entite: o.entite,
        entiteId: o.entiteId,
        motif: o.motif,
        avant: null,
        apres: null,
        createdAt: o.date,
        etablissement: nomEtab(o.etablissement),
        montant: o.montant ?? null,
        trace: false,
      });

      const requetes: PromiseLike<unknown>[] = [];

      if (veut("sales")) {
        let q = supabase.from("sales")
          .select("id, numero_recu, establishment_id, total, statut, created_at, vendeur_id")
          .gte("created_at", dansLaPeriode.gte).lt("created_at", dansLaPeriode.lt);
        q = filtrerEtablissement(q, portee.id);
        requetes.push(q.then(({ data }) => {
          for (const v of data ?? []) {
            ajouter({
              cle: `vente-${v.id}`,
              date: v.created_at as string,
              action: v.statut === "annulee" ? "vente_annulee" : "vente",
              entite: "sales",
              entiteId: v.numero_recu as string,
              motif: v.statut === "annulee" ? "Vente annulée" : "Vente encaissée",
              auteur: v.vendeur_id,
              etablissement: v.establishment_id,
              montant: Number(v.total),
            });
          }
        }));
      }

      if (veut("expenses")) {
        let q = supabase.from("expenses")
          .select("id, establishment_id, categorie, montant, motif, date_depense, effectue_par")
          .gte("date_depense", debutJour).lte("date_depense", finJour);
        q = filtrerEtablissement(q, portee.id);
        requetes.push(q.then(({ data }) => {
          for (const d of data ?? []) {
            ajouter({
              cle: `depense-${d.id}`,
              date: iso(d.date_depense as string),
              action: "depense",
              entite: "expenses",
              entiteId: `DEP-${d.id}`,
              motif: `${EXPENSE_LABELS_SERVEUR[d.categorie as ExpenseCategory] ?? d.categorie} — ${d.motif}`,
              auteur: d.effectue_par,
              etablissement: d.establishment_id,
              montant: Number(d.montant),
            });
          }
        }));
      }

      if (veut("purchases")) {
        let q = supabase.from("purchases")
          .select("id, numero, establishment_id, montant_total, date_achat, effectue_par")
          .gte("date_achat", debutJour).lte("date_achat", finJour);
        q = filtrerEtablissement(q, portee.id);
        requetes.push(q.then(({ data }) => {
          for (const a of data ?? []) {
            ajouter({
              cle: `achat-${a.id}`,
              date: iso(a.date_achat as string),
              action: "achat",
              entite: "purchases",
              entiteId: a.numero as string,
              motif: "Achat fournisseur",
              auteur: a.effectue_par,
              etablissement: a.establishment_id,
              montant: Number(a.montant_total),
            });
          }
        }));
      }

      if (veut("orders")) {
        let q = supabase.from("orders")
          .select("id, numero, establishment_id, statut, montant_total, customer_nom, type_prestation, created_at, technicien_id")
          .gte("created_at", dansLaPeriode.gte).lt("created_at", dansLaPeriode.lt);
        q = filtrerEtablissement(q, portee.id);
        requetes.push(q.then(({ data }) => {
          for (const c of data ?? []) {
            ajouter({
              cle: `commande-${c.id}`,
              date: c.created_at as string,
              action: "commande",
              entite: "orders",
              entiteId: c.numero as string,
              motif: `${c.type_prestation} pour ${c.customer_nom} — ${c.statut}`,
              // Une commande n'enregistre que le technicien affecté, pas son
              // auteur : mieux vaut ne montrer personne qu'attribuer à tort.
              auteur: c.technicien_id,
              etablissement: c.establishment_id,
              montant: Number(c.montant_total),
            });
          }
        }));
      }

      if (veut("cash_sessions")) {
        let q = supabase.from("cash_sessions")
          .select("id, establishment_id, opened_at, closed_at, opened_by, closed_by, ecart")
          .gte("opened_at", dansLaPeriode.gte).lt("opened_at", dansLaPeriode.lt);
        q = filtrerEtablissement(q, portee.id);
        requetes.push(q.then(({ data }) => {
          for (const s of data ?? []) {
            ajouter({
              cle: `caisse-ouverture-${s.id}`,
              date: s.opened_at as string,
              action: "ouverture_caisse",
              entite: "cash_sessions",
              entiteId: `CAISSE-${s.id}`,
              motif: "Ouverture de caisse",
              auteur: s.opened_by,
              etablissement: s.establishment_id,
            });
            if (s.closed_at) {
              const ecart = Number(s.ecart ?? 0);
              ajouter({
                cle: `caisse-fermeture-${s.id}`,
                date: s.closed_at as string,
                action: "fermeture_caisse",
                entite: "cash_sessions",
                entiteId: `CAISSE-${s.id}`,
                motif: ecart === 0
                  ? "Fermeture de caisse, sans écart"
                  : `Fermeture de caisse — écart constaté`,
                auteur: s.closed_by,
                etablissement: s.establishment_id,
                montant: ecart,
              });
            }
          }
        }));
      }

      // Mouvements de caisse et de stock : on passe par les sessions et les
      // articles de la portée, ces tables ne portant pas d'établissement.
      let qSessions = supabase.from("cash_sessions").select("id, establishment_id");
      qSessions = filtrerEtablissement(qSessions, portee.id);
      const { data: sessions } = await qSessions;
      const etabParSession = new Map((sessions ?? []).map((s) => [s.id, s.establishment_id]));

      if (veut("cash_movements") && etabParSession.size) {
        requetes.push(supabase.from("cash_movements")
          .select("id, session_id, type, montant, motif, created_at, created_by")
          .in("session_id", [...etabParSession.keys()])
          .gte("created_at", dansLaPeriode.gte).lt("created_at", dansLaPeriode.lt)
          .then(({ data }) => {
            for (const m of data ?? []) {
              ajouter({
                cle: `mouvement-${m.id}`,
                date: m.created_at as string,
                action: "mouvement_caisse",
                entite: "cash_movements",
                entiteId: `MVT-${m.id}`,
                motif: `${CASH_MOVEMENT_LABELS_SERVEUR[m.type as string] ?? "Mouvement"}${m.motif ? ` — ${m.motif}` : ""}`,
                auteur: m.created_by,
                etablissement: etabParSession.get(m.session_id as number),
                montant: Math.abs(Number(m.montant)),
              });
            }
          }));
      }

      if (veut("stock_movements")) {
        let qArticles = supabase.from("products").select("id, nom, establishment_id");
        qArticles = filtrerEtablissement(qArticles, portee.id);
        const { data: articles } = await qArticles;
        const article = new Map((articles ?? []).map((p) => [p.id, p]));

        if (article.size) {
          requetes.push(supabase.from("stock_movements")
            .select("id, product_id, type, quantite, motif, created_at, created_by")
            .in("product_id", [...article.keys()])
            .gte("created_at", dansLaPeriode.gte).lt("created_at", dansLaPeriode.lt)
            .then(({ data }) => {
              for (const m of data ?? []) {
                const p = article.get(m.product_id as number);
                ajouter({
                  cle: `stock-${m.id}`,
                  date: m.created_at as string,
                  action: "mouvement_stock",
                  entite: "stock_movements",
                  entiteId: `STK-${m.id}`,
                  motif: `${p?.nom ?? "Article"} — ${m.type} de ${m.quantite}${m.motif ? ` (${m.motif})` : ""}`,
                  auteur: m.created_by,
                  etablissement: p?.establishment_id,
                });
              }
            }));
        }
      }

      if (veut("pointages")) {
        let q = supabase.from("pointages")
          .select("id, profile_id, establishment_id, arrive_a, methode, verifie")
          .gte("jour", debutJour).lte("jour", finJour);
        q = filtrerEtablissement(q, portee.id);
        requetes.push(q.then(({ data }) => {
          for (const p of data ?? []) {
            ajouter({
              cle: `pointage-${p.id}`,
              date: p.arrive_a as string,
              action: "pointage",
              entite: "pointages",
              entiteId: `PTG-${p.id}`,
              motif: p.verifie
                ? "Arrivée, visage reconnu"
                : "Arrivée par code, sans reconnaissance",
              auteur: p.profile_id,
              etablissement: p.establishment_id,
            });
          }
        }));
      }

      await Promise.all(requetes);
    }

    lignes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    // Plafond volontaire : au-delà, on n'inspecte plus un journal, on le
    // dépouille — c'est le rôle des exports et du filtre de période.
    res.json({ periode: libelle, entrees: lignes.slice(0, 500), tronque: lignes.length > 500 });
  }));

  // -------------------------------------------------------------------------
  // Corbeille — ce qui a été retiré, et peut revenir
  // -------------------------------------------------------------------------

  /**
   * Rien n'est jamais effacé de cette application : retirer un article, un
   * pack, une catégorie, un fournisseur, un établissement ou un compte les
   * désactive. Ils cessent d'apparaître partout, mais l'historique qui les
   * mentionne — une vente d'il y a six mois, un achat réglé — reste lisible.
   *
   * Ventes, caisses et écritures n'y figurent pas : elles ne se suppriment
   * pas du tout. Une vente s'annule, avec un motif, et la trace en reste.
   */
  // `select` est écrit en toutes lettres pour chaque domaine : le typage de
  // supabase-js ne sait pas analyser une liste de colonnes construite à la
  // volée, et le faire lui perdrait la vérification des noms de colonnes —
  // exactement ce qu'on veut garder ici.
  const DOMAINES_CORBEILLE = [
    { cle: "products", table: "products", libelle: "Articles", champNom: "nom", select: "id, nom, establishment_id" },
    { cle: "packs", table: "packs", libelle: "Packs", champNom: "nom", select: "id, nom, establishment_id" },
    { cle: "categories", table: "categories", libelle: "Catégories", champNom: "nom", select: "id, nom, establishment_id" },
    { cle: "suppliers", table: "suppliers", libelle: "Fournisseurs", champNom: "nom", select: "id, nom" },
    { cle: "establishments", table: "establishments", libelle: "Établissements", champNom: "nom", select: "id, nom" },
    { cle: "profiles", table: "profiles", libelle: "Comptes", champNom: "full_name", select: "id, full_name, establishment_id" },
  ] as const;

  api.get("/corbeille", requireRole(...ADMIN), route(async (req, res) => {
    const portee = etablissementDemande(req.profil!, req.query.establishmentId);
    if (portee.erreur) return res.status(400).json({ error: portee.erreur });

    const etabs = await nomsEtablissements();

    const groupes = await Promise.all(DOMAINES_CORBEILLE.map(async (d) => {
      const parEtablissement = d.select.includes("establishment_id");
      let q = supabase.from(d.table).select(d.select)
        .eq("actif", false).order(d.champNom);
      if (parEtablissement) q = filtrerEtablissement(q, portee.id);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return {
        cle: d.cle,
        libelle: d.libelle,
        elements: ((data ?? []) as unknown as Record<string, unknown>[]).map((x) => ({
          id: String(x.id),
          nom: String(x[d.champNom] ?? "—"),
          etablissement: parEtablissement
            ? etabs.get(x.establishment_id as number)?.nom ?? null
            : null,
        })),
      };
    }));

    res.json({ groupes, total: groupes.reduce((s, g) => s + g.elements.length, 0) });
  }));

  api.post("/corbeille/:domaine/:id/restaurer", requireRole(...ADMIN), route(async (req, res) => {
    const d = DOMAINES_CORBEILLE.find((x) => x.cle === req.params.domaine);
    if (!d) return res.status(400).json({ error: "Domaine inconnu." });

    // Un identifiant venu de l'URL ne choisit pas la table : celle-ci est
    // prise dans la liste fermée ci-dessus, jamais construite depuis la requête.
    const { data, error } = await supabase.from(d.table)
      .update({ actif: true }).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Élément introuvable." });

    journaliser(req.profil!, "restauration", d.table, req.params.id, { apres: data });
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------------------
  // §6 Paramètres de l'entreprise
  // -------------------------------------------------------------------------

  api.get("/settings", route(async (_req, res) => {
    const { data, error } = await supabase.from("settings").select("*");
    if (error) throw new Error(error.message);
    res.json(Object.fromEntries((data ?? []).map((s) => [s.key, s.value])));
  }));

  api.put("/settings/:key", requireRole(...ADMIN), route(async (req, res) => {
    const { data, error } = await supabase
      .from("settings")
      .upsert({ key: req.params.key, value: req.body, updated_at: new Date().toISOString() })
      .select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "modification_parametres", "settings", req.params.key, { apres: req.body });
    res.json(data.value);
  }));

  app.use("/api", api);

  // Le détail va aux logs serveur, le client reçoit un message exploitable.
  app.use((err: Error, _req: express.Request, res: Response, _next: express.NextFunction) => {
    console.error("[api]", err);
    res.status(500).json({ error: err.message || "Erreur interne du serveur." });
  });

  return app;
}
