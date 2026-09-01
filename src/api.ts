import express, { Response } from "express";
import { supabase } from "./lib/supabase-server.js";
import { requireAuth, AuthRequest } from "./middleware/auth.js";
import { toCamelCase, toCamelCaseArray, toSnakeCase } from "./lib/caseConvert.js";
import type {
  Pole, UserRole, PaymentMethod, DashboardStats, ReportData, ExpenseCategory,
} from "./types.js";

// ============================================================================
// API EDEN MULTI-SERVICES
// ----------------------------------------------------------------------------
// Toutes les routes sont montées sous /api et exigent une session Supabase
// valide (requireAuth), puis un profil actif (loadProfile). Les autorisations
// du §5.1 du cahier des charges sont appliquées ici, côté serveur : le frontend
// masque les écrans interdits, mais c'est cette couche qui fait foi.
// ============================================================================

// --- Autorisations (§5.1) ---------------------------------------------------
// admin        : accès à tout, gestion des utilisateurs, modification des prix,
//                comptabilité, rapports.
// responsable  : consultation des ventes et du stock, validation de certaines
//                opérations (dépenses, annulations, fermeture de caisse), suivi
//                des employés. Ne gère ni les comptes ni les prix.
// caissier     : enregistrement des ventes, encaissement, consultation limitée
//                du stock.
// technicien   : enregistrement des prestations cyber/infographie, suivi des
//                commandes clients.

const TOUS: UserRole[] = ["admin", "responsable", "caissier", "technicien"];
const ENCAISSENT: UserRole[] = ["admin", "responsable", "caissier", "technicien"];
const VALIDENT: UserRole[] = ["admin", "responsable"];
const ADMIN: UserRole[] = ["admin"];

interface Profil {
  id: string;
  fullName: string;
  role: UserRole;
  pole: Pole | null;
  actif: boolean;
}

interface Req extends AuthRequest {
  profil?: Profil;
}

/**
 * Charge le profil applicatif après l'authentification Supabase. Un compte
 * authentifié mais sans profil, ou désactivé, est rejeté : c'est ce qui permet
 * de couper l'accès d'un employé qui quitte l'entreprise sans supprimer son
 * compte Auth (et donc sans perdre l'historique de ses ventes).
 */
async function loadProfile(req: Req, res: Response, next: express.NextFunction) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, pole, actif")
    .eq("id", req.user!.uid)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res.status(403).json({
      error: "Aucun profil n'est associé à ce compte. Contactez l'administrateur.",
    });
  }
  if (!data.actif) {
    return res.status(403).json({ error: "Ce compte a été désactivé." });
  }

  req.profil = {
    id: data.id,
    fullName: data.full_name,
    role: data.role as UserRole,
    pole: data.pole as Pole | null,
    actif: data.actif,
  };
  next();
}

/** Garde de rôle. À placer après loadProfile. */
function requireRole(...roles: UserRole[]) {
  return (req: Req, res: Response, next: express.NextFunction) => {
    if (!roles.includes(req.profil!.role)) {
      return res.status(403).json({
        error: "Votre rôle ne vous autorise pas cette opération.",
      });
    }
    next();
  };
}

// --- Traçabilité (§5.10) ----------------------------------------------------

/**
 * Écrit une entrée au journal. Volontairement sans `await` bloquant l'appelant
 * sur son échec : une panne d'écriture du journal ne doit pas annuler une vente
 * déjà enregistrée. L'erreur est loguée pour être visible en supervision.
 */
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

/** Enveloppe async pour que les rejets remontent au gestionnaire d'erreurs. */
const route =
  (fn: (req: Req, res: Response) => Promise<unknown>) =>
  (req: Req, res: Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

/** Cache court des noms d'employés : évite un aller-retour par ligne affichée. */
let profilsCache: { at: number; map: Map<string, string> } | null = null;
async function nomsEmployes(): Promise<Map<string, string>> {
  if (profilsCache && Date.now() - profilsCache.at < 30_000) return profilsCache.map;
  const { data } = await supabase.from("profiles").select("id, full_name");
  const map = new Map<string, string>((data ?? []).map((p) => [p.id, p.full_name]));
  profilsCache = { at: Date.now(), map };
  return map;
}
function inValiderCacheProfils() {
  profilsCache = null;
}

/**
 * Numéro séquentiel lisible du jour : PREFIX-AAAAMMJJ-0001.
 * Deux caisses peuvent tomber sur le même numéro en même temps ; l'unicité est
 * garantie par l'index, et l'appelant réessaie (cf. insertionAvecNumero).
 */
async function prochainNumero(prefix: string, table: string, colonne: string): Promise<string> {
  const jour = new Date();
  const cle = `${jour.getFullYear()}${String(jour.getMonth() + 1).padStart(2, "0")}${String(jour.getDate()).padStart(2, "0")}`;
  const motif = `${prefix}-${cle}-%`;

  const { count } = await supabase
    .from(table)
    .select(colonne, { count: "exact", head: true })
    .like(colonne, motif);

  return `${prefix}-${cle}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

const CODE_CONFLIT_UNICITE = "23505";

/** Insère en réessayant si le numéro généré vient d'être pris par un collègue. */
async function insertionAvecNumero<T>(
  prefix: string,
  table: string,
  colonne: string,
  construire: (numero: string) => Record<string, unknown>
): Promise<T> {
  for (let essai = 0; essai < 5; essai++) {
    const numero = await prochainNumero(prefix, table, colonne);
    const { data, error } = await supabase
      .from(table)
      .insert(construire(numero))
      .select()
      .single();

    if (!error) return data as T;
    if (error.code !== CODE_CONFLIT_UNICITE) throw new Error(error.message);
  }
  throw new Error("Impossible de générer un numéro unique après 5 tentatives.");
}

/** Bornes [début, fin[ d'une période, en ISO. */
function bornesPeriode(query: Record<string, unknown>): { debut: Date; fin: Date; libelle: string } {
  const periode = String(query.periode ?? "jour");
  const maintenant = new Date();
  const debutDuJour = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (periode === "personnalise" && query.debut && query.fin) {
    const debut = new Date(String(query.debut));
    const fin = new Date(String(query.fin));
    // Borne haute inclusive côté utilisateur : on ajoute un jour pour couvrir
    // toute la journée de fin.
    fin.setDate(fin.getDate() + 1);
    return { debut, fin, libelle: "Période personnalisée" };
  }

  switch (periode) {
    case "semaine": {
      const debut = debutDuJour(maintenant);
      // Semaine commençant le lundi (getDay() : 0 = dimanche).
      const decalage = (debut.getDay() + 6) % 7;
      debut.setDate(debut.getDate() - decalage);
      return { debut, fin: maintenant, libelle: "Cette semaine" };
    }
    case "mois":
      return {
        debut: new Date(maintenant.getFullYear(), maintenant.getMonth(), 1),
        fin: maintenant,
        libelle: "Ce mois-ci",
      };
    case "annee":
      return {
        debut: new Date(maintenant.getFullYear(), 0, 1),
        fin: maintenant,
        libelle: "Cette année",
      };
    default:
      return { debut: debutDuJour(maintenant), fin: maintenant, libelle: "Aujourd'hui" };
  }
}

function estPoleValide(v: unknown): v is Pole {
  return v === "MULTI_SERVICES" || v === "FOOD";
}

// ============================================================================
// Application
// ============================================================================

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const api = express.Router();
  api.use(requireAuth, loadProfile);

  // -------------------------------------------------------------------------
  // Profil courant
  // -------------------------------------------------------------------------

  api.get("/me", route(async (req, res) => {
    const { data, error } = await supabase
      .from("profiles").select("*").eq("id", req.profil!.id).single();
    if (error) throw new Error(error.message);
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.1 Gestion des utilisateurs — administrateur uniquement
  // -------------------------------------------------------------------------

  api.get("/users", requireRole(...TOUS), route(async (_req, res) => {
    const { data, error } = await supabase
      .from("profiles").select("*").order("full_name");
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  /**
   * Crée le compte Auth *et* le profil. Le mot de passe initial est fourni par
   * l'administrateur et transmis à l'employé ; email_confirm est forcé pour que
   * l'employé puisse se connecter immédiatement, sans boîte mail à valider
   * (beaucoup d'agents n'ont pas d'adresse e-mail active).
   */
  api.post("/users", requireRole(...ADMIN), route(async (req, res) => {
    const { email, password, fullName, role, pole, poste, telephone, salaire, dateEntree } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: "Email, mot de passe et nom complet sont obligatoires." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères." });
    }

    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (authErr) return res.status(400).json({ error: authErr.message });

    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: auth.user.id,
        full_name: fullName,
        email,
        role: role ?? "caissier",
        pole: pole ?? null,
        poste: poste ?? null,
        telephone: telephone ?? null,
        salaire: salaire ?? null,
        date_entree: dateEntree ?? null,
      })
      .select().single();

    if (error) {
      // Le compte Auth existe déjà mais le profil a échoué : on le supprime
      // pour ne pas laisser un compte capable de se connecter sans profil.
      await supabase.auth.admin.deleteUser(auth.user.id);
      throw new Error(error.message);
    }

    inValiderCacheProfils();
    journaliser(req.profil!, "creation_utilisateur", "profiles", data.id, { apres: { email, role } });
    res.status(201).json(toCamelCase(data));
  }));

  api.patch("/users/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { data: avant } = await supabase
      .from("profiles").select("*").eq("id", req.params.id).single();

    const champs = ["fullName", "role", "pole", "poste", "telephone", "salaire", "dateEntree", "actif"];
    const maj = toSnakeCase(
      Object.fromEntries(Object.entries(req.body).filter(([k]) => champs.includes(k)))
    );

    const { data, error } = await supabase
      .from("profiles").update(maj).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    inValiderCacheProfils();
    journaliser(req.profil!, "modification_utilisateur", "profiles", req.params.id, {
      avant, apres: data, motif: req.body.motif,
    });
    res.json(toCamelCase(data));
  }));

  /** Réinitialisation du mot de passe d'un employé par l'administrateur. */
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

  api.get("/categories", route(async (_req, res) => {
    const { data, error } = await supabase
      .from("categories").select("*").order("pole").order("ordre");
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  api.post("/categories", requireRole(...ADMIN), route(async (req, res) => {
    const { data, error } = await supabase
      .from("categories").insert(toSnakeCase(req.body)).select().single();
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
  // §2, §3, §5.5 Catalogue produits et prestations
  // -------------------------------------------------------------------------

  api.get("/products", route(async (req, res) => {
    let q = supabase.from("products").select("*, categories(nom)").order("nom");
    if (estPoleValide(req.query.pole)) q = q.eq("pole", req.query.pole);
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
    const { data, error } = await supabase
      .from("products").insert(toSnakeCase(req.body)).select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "creation_produit", "products", data.id, { apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  /**
   * §5.1 « Modification des prix » est réservée à l'administrateur, et §5.10
   * impose d'en garder trace : tout changement de prix de vente ou d'achat est
   * journalisé avec l'ancienne et la nouvelle valeur.
   */
  api.patch("/products/:id", requireRole(...ADMIN), route(async (req, res) => {
    const { data: avant, error: errAvant } = await supabase
      .from("products").select("*").eq("id", req.params.id).single();
    if (errAvant) throw new Error(errAvant.message);

    // La quantité ne se modifie jamais directement : elle passe par un
    // mouvement de stock, sinon l'historique du §5.5 devient faux.
    const { quantite: _ignore, ...corps } = req.body;

    const { data, error } = await supabase
      .from("products").update(toSnakeCase(corps)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    const prixChange =
      avant.prix_vente !== data.prix_vente || avant.prix_achat !== data.prix_achat;
    journaliser(
      req.profil!,
      prixChange ? "modification_prix" : "modification_produit",
      "products",
      req.params.id,
      { avant, apres: data, motif: req.body.motif }
    );
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §2.4 Packs
  // -------------------------------------------------------------------------

  api.get("/packs", route(async (_req, res) => {
    const { data, error } = await supabase
      .from("packs")
      .select("*, pack_items(id, pack_id, product_id, quantite, products(nom, prix_vente))")
      .order("nom");
    if (error) throw new Error(error.message);

    res.json(
      (data ?? []).map((row: Record<string, unknown>) => {
        const { pack_items, ...reste } = row as {
          pack_items?: { id: number; pack_id: number; product_id: number; quantite: number; products?: { nom: string; prix_vente: number } }[];
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
    const { items, ...pack } = req.body;
    const { data, error } = await supabase
      .from("packs").insert(toSnakeCase(pack)).select().single();
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
    const { items, ...pack } = req.body;
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
  // §5.6 Fournisseurs
  // -------------------------------------------------------------------------

  api.get("/suppliers", route(async (_req, res) => {
    const { data, error } = await supabase.from("suppliers").select("*").order("nom");
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
  }));

  api.post("/suppliers", requireRole(...VALIDENT), route(async (req, res) => {
    const { data, error } = await supabase
      .from("suppliers").insert(toSnakeCase(req.body)).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(toCamelCase(data));
  }));

  api.patch("/suppliers/:id", requireRole(...VALIDENT), route(async (req, res) => {
    const { data, error } = await supabase
      .from("suppliers").update(toSnakeCase(req.body)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.9 Clients
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

  /** §5.9 : fiche client avec historique d'achats, commandes en cours et total dépensé. */
  api.get("/customers/:id", route(async (req, res) => {
    const id = Number(req.params.id);

    const [{ data: client }, { data: ventes }, { data: commandes }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      supabase.from("sales").select("*").eq("customer_id", id)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("orders").select("*").eq("customer_id", id)
        .order("date_commande", { ascending: false }),
    ]);

    if (!client) return res.status(404).json({ error: "Client introuvable." });

    const validees = (ventes ?? []).filter((v) => v.statut === "validee");
    const noms = await nomsEmployes();

    res.json({
      ...toCamelCase(client),
      totalDepense: validees.reduce((s, v) => s + Number(v.total), 0),
      nbAchats: validees.length,
      ventes: (ventes ?? []).map((v) => ({
        ...toCamelCase(v),
        vendeurNom: noms.get(v.vendeur_id) ?? null,
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
      .from("cash_movements")
      .select("montant, payment_method")
      .eq("session_id", sessionId);
    if (error) throw new Error(error.message);

    return (data ?? [])
      .filter((m) => m.payment_method === "especes")
      .reduce((total, m) => total + Number(m.montant), fondsInitial);
  }

  /** Session ouverte du pôle, ou null. */
  async function sessionOuverte(pole: Pole) {
    const { data, error } = await supabase
      .from("cash_sessions").select("*").eq("pole", pole).eq("statut", "ouverte").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  api.get("/cash/current", route(async (req, res) => {
    const pole = req.query.pole;
    if (!estPoleValide(pole)) return res.status(400).json({ error: "Pôle invalide." });

    const session = await sessionOuverte(pole);
    if (!session) return res.json(null);

    const noms = await nomsEmployes();
    const [theorique, { data: mouvements }] = await Promise.all([
      soldeTheorique(session.id, Number(session.fonds_initial)),
      supabase.from("cash_movements").select("*").eq("session_id", session.id)
        .order("created_at", { ascending: false }),
    ]);

    res.json({
      ...toCamelCase(session),
      openedByNom: noms.get(session.opened_by) ?? null,
      soldeTheorique: theorique,
      mouvements: (mouvements ?? []).map((m) => ({
        ...toCamelCase(m),
        createdByNom: m.created_by ? noms.get(m.created_by) ?? null : null,
      })),
    });
  }));

  api.post("/cash/open", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { pole, fondsInitial, notes } = req.body;
    if (!estPoleValide(pole)) return res.status(400).json({ error: "Pôle invalide." });

    if (await sessionOuverte(pole)) {
      return res.status(409).json({
        error: "Une caisse est déjà ouverte pour ce pôle. Fermez-la avant d'en ouvrir une nouvelle.",
      });
    }

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        pole,
        fonds_initial: Number(fondsInitial) || 0,
        opened_by: req.profil!.id,
        notes: notes ?? null,
      })
      .select().single();

    // L'index unique partiel rattrape deux ouvertures simultanées.
    if (error?.code === CODE_CONFLIT_UNICITE) {
      return res.status(409).json({ error: "Une caisse vient d'être ouverte pour ce pôle." });
    }
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "ouverture_caisse", "cash_sessions", data.id, { apres: data });
    res.status(201).json(toCamelCase(data));
  }));

  /**
   * §5.3 Fermeture : le caissier saisit le solde physique compté, le serveur
   * recalcule le théorique et enregistre l'écart. L'écart n'est jamais corrigé
   * silencieusement — c'est l'indicateur central du contrôle interne.
   */
  api.post("/cash/close", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { sessionId, soldePhysique, notes } = req.body;

    const { data: session, error: errSession } = await supabase
      .from("cash_sessions").select("*").eq("id", sessionId).single();
    if (errSession) throw new Error(errSession.message);
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
      apres: { theorique, physique, ecart: physique - theorique },
      motif: notes,
    });
    res.json(toCamelCase(data));
  }));

  /** Entrées/sorties d'argent hors ventes et dépenses (§5.3). */
  api.post("/cash/movements", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { sessionId, type, montant, motif, paymentMethod } = req.body;

    if (!motif || !String(motif).trim()) {
      return res.status(400).json({ error: "Un motif est obligatoire pour tout mouvement de caisse." });
    }

    // Le signe est imposé par le type : l'utilisateur saisit toujours un
    // montant positif, impossible de se tromper de sens.
    const sortie = ["retrait", "depense", "remboursement"].includes(type);
    const valeur = Math.abs(Number(montant)) * (sortie ? -1 : 1);

    const { data, error } = await supabase
      .from("cash_movements")
      .insert({
        session_id: sessionId,
        type,
        montant: valeur,
        motif,
        payment_method: paymentMethod ?? "especes",
        created_by: req.profil!.id,
      })
      .select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "mouvement_caisse", "cash_movements", data.id, {
      motif, apres: data,
    });
    res.status(201).json(toCamelCase(data));
  }));

  api.get("/cash/sessions", requireRole(...VALIDENT), route(async (req, res) => {
    let q = supabase.from("cash_sessions").select("*").order("opened_at", { ascending: false });
    if (estPoleValide(req.query.pole)) q = q.eq("pole", req.query.pole);

    const { data, error } = await q.limit(200);
    if (error) throw new Error(error.message);

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((s) => ({
        ...toCamelCase(s),
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

    let q = supabase
      .from("sales").select("*")
      .gte("created_at", debut.toISOString())
      .lt("created_at", fin.toISOString())
      .order("created_at", { ascending: false });

    if (estPoleValide(req.query.pole)) q = q.eq("pole", req.query.pole);
    // Un caissier ne consulte que ses propres ventes ; responsable et admin
    // voient tout (§5.1 « Consultation des ventes »).
    if (req.profil!.role === "caissier") q = q.eq("vendeur_id", req.profil!.id);

    const { data, error } = await q.limit(500);
    if (error) throw new Error(error.message);

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((v) => ({ ...toCamelCase(v), vendeurNom: noms.get(v.vendeur_id) ?? null }))
    );
  }));

  api.get("/sales/:id", route(async (req, res) => {
    const [{ data: vente }, { data: lignes }] = await Promise.all([
      supabase.from("sales").select("*").eq("id", req.params.id).single(),
      supabase.from("sale_items").select("*").eq("sale_id", req.params.id).order("id"),
    ]);
    if (!vente) return res.status(404).json({ error: "Vente introuvable." });

    const noms = await nomsEmployes();
    let clientNom: string | null = null;
    if (vente.customer_id) {
      const { data } = await supabase
        .from("customers").select("nom").eq("id", vente.customer_id).maybeSingle();
      clientNom = data?.nom ?? null;
    }

    res.json({
      ...toCamelCase(vente),
      vendeurNom: noms.get(vente.vendeur_id) ?? null,
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
   * remise, prévue au §5.2, permet de descendre sous le tarif, et elle est
   * enregistrée comme telle.
   */
  api.post("/sales", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { pole, items, paymentMethod, numeroTransaction, remise, customerId } = req.body;

    if (!estPoleValide(pole)) return res.status(400).json({ error: "Pôle invalide." });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "La vente doit contenir au moins une ligne." });
    }

    const session = await sessionOuverte(pole);
    if (!session) {
      return res.status(409).json({
        error: "Aucune caisse ouverte pour ce pôle. Ouvrez la caisse avant d'enregistrer une vente.",
      });
    }

    // Relecture des tarifs officiels.
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
          | { id: number; nom: string; prix_vente: number; pack_items?: { product_id: number; quantite: number }[] }
          | undefined;
        if (!pack) return res.status(400).json({ error: `Pack ${item.packId} introuvable.` });

        // Coût du pack = somme des prix d'achat de ses composants.
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
          | { id: number; nom: string; prix_vente: number; prix_achat: number; actif: boolean; gere_stock: boolean; quantite: number }
          | undefined;
        if (!produit) return res.status(400).json({ error: `Article ${item.productId} introuvable.` });
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
        pole,
        session_id: session.id,
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

    // §5.5 « le stock doit diminuer automatiquement ». La fonction SQL fait le
    // décrément et le journal en une opération atomique.
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

    await supabase.from("cash_movements").insert({
      session_id: session.id,
      type: "vente",
      montant: sousTotal - remiseNum,
      motif: `Vente ${vente.numero_recu}`,
      payment_method: paymentMethod ?? "especes",
      sale_id: vente.id,
      created_by: req.profil!.id,
    });

    res.status(201).json({ id: vente.id, numeroRecu: vente.numero_recu, total: sousTotal - remiseNum });
  }));

  /**
   * §5.2 « Éventuelle annulation » + §5.10 : motif obligatoire, auteur et heure
   * conservés. La vente n'est jamais supprimée — elle passe au statut annulée,
   * le stock est restitué et un mouvement de caisse inverse est écrit.
   * Réservé aux profils qui « valident » (§5.1).
   */
  api.post("/sales/:id/cancel", requireRole(...VALIDENT), route(async (req, res) => {
    const { motif } = req.body;
    if (!motif || String(motif).trim().length < 3) {
      return res.status(400).json({ error: "Un motif d'annulation est obligatoire." });
    }

    const { data: vente, error: errVente } = await supabase
      .from("sales").select("*").eq("id", req.params.id).single();
    if (errVente) throw new Error(errVente.message);
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

    // Restitution du stock.
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

    // Contre-passation en caisse, uniquement si la session est encore ouverte :
    // annuler une vente d'hier ne doit pas modifier une caisse déjà arrêtée et
    // dont l'écart a été constaté.
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

  api.get("/stock/movements", route(async (req, res) => {
    let q = supabase
      .from("stock_movements").select("*, products(nom)")
      .order("created_at", { ascending: false });
    if (req.query.productId) q = q.eq("product_id", req.query.productId);

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

  /** §5.11 « Produits en rupture » et « bientôt en rupture ». */
  api.get("/stock/alerts", route(async (_req, res) => {
    const { data, error } = await supabase
      .from("products").select("id, nom, pole, quantite, seuil_alerte, unite")
      .eq("actif", true).eq("gere_stock", true);
    if (error) throw new Error(error.message);

    const lignes = (data ?? []).map((p) => ({
      id: p.id, nom: p.nom, pole: p.pole, unite: p.unite,
      quantite: Number(p.quantite), seuilAlerte: Number(p.seuil_alerte),
    }));

    res.json({
      ruptures: lignes.filter((p) => p.quantite <= 0),
      bientotEnRupture: lignes.filter((p) => p.quantite > 0 && p.quantite <= p.seuilAlerte),
    });
  }));

  /**
   * Ajustement d'inventaire (§5.5). Le motif est obligatoire : un écart de
   * stock non expliqué est exactement ce que le contrôle interne cherche à
   * empêcher.
   */
  api.post("/stock/adjust", requireRole(...VALIDENT), route(async (req, res) => {
    const { productId, quantiteReelle, motif } = req.body;
    if (!motif || !String(motif).trim()) {
      return res.status(400).json({ error: "Un motif est obligatoire pour tout ajustement de stock." });
    }

    const { data: produit, error: errProduit } = await supabase
      .from("products").select("*").eq("id", productId).single();
    if (errProduit) throw new Error(errProduit.message);
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

  // -------------------------------------------------------------------------
  // §5.6 Achats
  // -------------------------------------------------------------------------

  api.get("/purchases", requireRole(...VALIDENT), route(async (req, res) => {
    const { debut, fin } = bornesPeriode(req.query as Record<string, unknown>);

    const { data, error } = await supabase
      .from("purchases").select("*, suppliers(nom)")
      .gte("date_achat", debut.toISOString().slice(0, 10))
      .lte("date_achat", fin.toISOString().slice(0, 10))
      .order("date_achat", { ascending: false });
    if (error) throw new Error(error.message);

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((row: Record<string, unknown>) => {
        const { suppliers, ...reste } = row as { suppliers?: { nom: string }; effectue_par?: string };
        return {
          ...toCamelCase(reste),
          fournisseurNom: suppliers?.nom ?? null,
          effectueParNom: reste.effectue_par ? noms.get(reste.effectue_par) ?? null : null,
        };
      })
    );
  }));

  /**
   * Un achat alimente le stock : chaque ligne rattachée à un produit suivi
   * génère une entrée. Le prix d'achat du produit est aligné sur le dernier
   * prix payé, pour que la marge du §5.13 reste juste.
   */
  api.post("/purchases", requireRole(...VALIDENT), route(async (req, res) => {
    const { supplierId, pole, dateAchat, montantPaye, paymentMethod, justificatif, notes, items } = req.body;

    if (!estPoleValide(pole)) return res.status(400).json({ error: "Pôle invalide." });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "L'achat doit contenir au moins une ligne." });
    }

    const lignes = items.map((it: { productId?: number; libelle: string; quantite: number; prixUnitaire: number }) => ({
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
        pole,
        date_achat: dateAchat ?? new Date().toISOString().slice(0, 10),
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

  /** Règlement partiel ou total d'un achat à crédit (§5.6). */
  api.post("/purchases/:id/pay", requireRole(...VALIDENT), route(async (req, res) => {
    const { montant } = req.body;

    const { data: achat, error: errAchat } = await supabase
      .from("purchases").select("*").eq("id", req.params.id).single();
    if (errAchat) throw new Error(errAchat.message);

    const nouveauPaye = Math.min(
      Number(achat.montant_paye) + (Number(montant) || 0),
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

  api.get("/purchases/:id", requireRole(...VALIDENT), route(async (req, res) => {
    const [{ data: achat }, { data: lignes }] = await Promise.all([
      supabase.from("purchases").select("*, suppliers(nom)").eq("id", req.params.id).single(),
      supabase.from("purchase_items").select("*").eq("purchase_id", req.params.id).order("id"),
    ]);
    if (!achat) return res.status(404).json({ error: "Achat introuvable." });

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
    const { debut, fin } = bornesPeriode(req.query as Record<string, unknown>);

    let q = supabase
      .from("expenses").select("*")
      .gte("date_depense", debut.toISOString().slice(0, 10))
      .lte("date_depense", fin.toISOString().slice(0, 10))
      .order("date_depense", { ascending: false });
    if (estPoleValide(req.query.pole)) q = q.eq("pole", req.query.pole);

    const { data, error } = await q.limit(500);
    if (error) throw new Error(error.message);

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((d) => ({
        ...toCamelCase(d),
        effectueParNom: d.effectue_par ? noms.get(d.effectue_par) ?? null : null,
        valideParNom: d.valide_par ? noms.get(d.valide_par) ?? null : null,
      }))
    );
  }));

  /**
   * Une dépense payée en espèces sort du tiroir : elle est immédiatement
   * répercutée sur la caisse ouverte du pôle, sinon l'écart de fermeture
   * serait systématiquement négatif.
   */
  api.post("/expenses", requireRole(...ENCAISSENT), route(async (req, res) => {
    const { pole, categorie, montant, motif, dateDepense, paymentMethod, justificatif } = req.body;

    if (!estPoleValide(pole)) return res.status(400).json({ error: "Pôle invalide." });
    if (!motif || !String(motif).trim()) {
      return res.status(400).json({ error: "Le motif de la dépense est obligatoire." });
    }
    if (!(Number(montant) > 0)) {
      return res.status(400).json({ error: "Le montant doit être supérieur à zéro." });
    }

    const session = await sessionOuverte(pole);
    const methode: PaymentMethod = paymentMethod ?? "especes";

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        pole,
        categorie,
        montant: Number(montant),
        motif,
        date_depense: dateDepense ?? new Date().toISOString().slice(0, 10),
        payment_method: methode,
        effectue_par: req.profil!.id,
        justificatif: justificatif ?? null,
        session_id: session?.id ?? null,
        // L'auteur ne peut pas valider sa propre dépense : la validation reste
        // un acte distinct, confié à un responsable (§5.7).
        valide_par: null,
      })
      .select().single();
    if (error) throw new Error(error.message);

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
    const { data, error } = await supabase
      .from("expenses")
      .update({ valide_par: req.profil!.id, valide_le: new Date().toISOString() })
      .eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "validation_depense", "expenses", req.params.id, { apres: data });
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.8 Commandes infographie
  // -------------------------------------------------------------------------

  api.get("/orders", route(async (req, res) => {
    let q = supabase.from("orders").select("*").order("date_commande", { ascending: false });
    if (req.query.statut) q = q.eq("statut", String(req.query.statut));

    const { data, error } = await q.limit(300);
    if (error) throw new Error(error.message);

    const noms = await nomsEmployes();
    res.json(
      (data ?? []).map((c) => ({
        ...toCamelCase(c),
        technicienNom: c.technicien_id ? noms.get(c.technicien_id) ?? null : null,
      }))
    );
  }));

  api.post("/orders", requireRole(...TOUS), route(async (req, res) => {
    const {
      customerId, customerNom, customerTelephone, typePrestation, description,
      quantite, prixUnitaire, acompte, dateLivraisonPrevue, technicienId,
    } = req.body;

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
        // Par défaut la commande revient à celui qui la saisit s'il est
        // technicien — c'est le cas le plus fréquent au comptoir.
        technicien_id: technicienId ?? (req.profil!.role === "technicien" ? req.profil!.id : null),
      })
    );

    journaliser(req.profil!, "creation_commande", "orders", commande.id as number, { apres: commande });
    res.status(201).json(toCamelCase(commande));
  }));

  api.patch("/orders/:id", requireRole(...TOUS), route(async (req, res) => {
    const { data: avant } = await supabase
      .from("orders").select("*").eq("id", req.params.id).single();

    const corps = { ...req.body };
    // Le total et le reste se recalculent, ils ne se saisissent pas.
    if (corps.quantite != null || corps.prixUnitaire != null) {
      const qte = Number(corps.quantite ?? avant.quantite);
      const pu = Number(corps.prixUnitaire ?? avant.prix_unitaire);
      corps.montantTotal = qte * pu;
    }
    delete corps.reste;

    const { data, error } = await supabase
      .from("orders").update(toSnakeCase(corps)).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);

    journaliser(req.profil!, "modification_commande", "orders", req.params.id, {
      avant, apres: data, motif: req.body.motif,
    });
    res.json(toCamelCase(data));
  }));

  // -------------------------------------------------------------------------
  // §5.11 Tableau de bord
  // -------------------------------------------------------------------------

  api.get("/dashboard", route(async (req, res) => {
    const { debut, fin } = bornesPeriode(req.query as Record<string, unknown>);

    const [{ data: ventes }, { data: depenses }, { data: sessions }, alertes] = await Promise.all([
      supabase.from("sales").select("pole, total, cout_total, created_at, statut")
        .gte("created_at", debut.toISOString()).lt("created_at", fin.toISOString())
        .eq("statut", "validee"),
      supabase.from("expenses").select("pole, montant, date_depense, valide_par")
        .gte("date_depense", debut.toISOString().slice(0, 10))
        .lte("date_depense", fin.toISOString().slice(0, 10)),
      supabase.from("cash_sessions").select("*").eq("statut", "ouverte"),
      supabase.from("products").select("id, nom, quantite, seuil_alerte")
        .eq("actif", true).eq("gere_stock", true),
    ]);

    const lignesVentes = ventes ?? [];
    const caMultiServices = lignesVentes
      .filter((v) => v.pole === "MULTI_SERVICES").reduce((s, v) => s + Number(v.total), 0);
    const caFood = lignesVentes
      .filter((v) => v.pole === "FOOD").reduce((s, v) => s + Number(v.total), 0);
    const cout = lignesVentes.reduce((s, v) => s + Number(v.cout_total), 0);
    const totalDepenses = (depenses ?? []).reduce((s, d) => s + Number(d.montant), 0);
    const margeBrute = caMultiServices + caFood - cout;

    // Série journalière pour le graphique.
    const parJour = new Map<string, { caMultiServices: number; caFood: number; depenses: number }>();
    const initJour = (cle: string) => {
      if (!parJour.has(cle)) parJour.set(cle, { caMultiServices: 0, caFood: 0, depenses: 0 });
      return parJour.get(cle)!;
    };
    for (const v of lignesVentes) {
      const cle = String(v.created_at).slice(0, 10);
      const jour = initJour(cle);
      if (v.pole === "MULTI_SERVICES") jour.caMultiServices += Number(v.total);
      else jour.caFood += Number(v.total);
    }
    for (const d of depenses ?? []) {
      initJour(String(d.date_depense).slice(0, 10)).depenses += Number(d.montant);
    }

    const noms = await nomsEmployes();
    const caisses = await Promise.all(
      (sessions ?? []).map(async (s) => ({
        pole: s.pole as Pole,
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
      caMultiServices,
      caFood,
      caTotal: caMultiServices + caFood,
      nbVentes: lignesVentes.length,
      depenses: totalDepenses,
      margeBrute,
      beneficeEstimatif: margeBrute - totalDepenses,
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
  // §5.12 Rapports et statistiques — §5.13 Comptabilité
  // -------------------------------------------------------------------------

  api.get("/reports", requireRole(...VALIDENT), route(async (req, res) => {
    const { debut, fin, libelle } = bornesPeriode(req.query as Record<string, unknown>);
    const debutISO = debut.toISOString();
    const finISO = fin.toISOString();

    const [{ data: ventes }, { data: depenses }, { data: achats }, { data: sessions }] =
      await Promise.all([
        supabase.from("sales")
          .select("id, pole, total, cout_total, vendeur_id, payment_method, statut")
          .gte("created_at", debutISO).lt("created_at", finISO).eq("statut", "validee"),
        supabase.from("expenses").select("categorie, montant")
          .gte("date_depense", debutISO.slice(0, 10)).lte("date_depense", finISO.slice(0, 10)),
        supabase.from("purchases").select("montant_total, montant_paye, montant_restant")
          .gte("date_achat", debutISO.slice(0, 10)).lte("date_achat", finISO.slice(0, 10)),
        supabase.from("cash_sessions").select("*").eq("statut", "fermee")
          .gte("closed_at", debutISO).lt("closed_at", finISO),
      ]);

    const lignesVentes = ventes ?? [];
    const idsVentes = lignesVentes.map((v) => v.id);

    // Détail produit : chargé par lots, PostgREST limitant la taille des filtres `in`.
    const detail: { libelle: string; quantite: number; montant: number; prix_achat_unitaire: number; sale_id: number }[] = [];
    for (let i = 0; i < idsVentes.length; i += 200) {
      const { data } = await supabase
        .from("sale_items")
        .select("libelle, quantite, montant, prix_achat_unitaire, sale_id")
        .in("sale_id", idsVentes.slice(i, i + 200));
      detail.push(...((data ?? []) as typeof detail));
    }

    const poleParVente = new Map(lignesVentes.map((v) => [v.id, v.pole as Pole]));
    const noms = await nomsEmployes();
    const { data: profils } = await supabase.from("profiles").select("id, full_name, role");
    const roleParId = new Map((profils ?? []).map((p) => [p.id, p.role as UserRole]));

    // --- CA par pôle
    const caParPole = (["MULTI_SERVICES", "FOOD"] as Pole[]).map((pole) => {
      const duPole = lignesVentes.filter((v) => v.pole === pole);
      const ca = duPole.reduce((s, v) => s + Number(v.total), 0);
      const cout = duPole.reduce((s, v) => s + Number(v.cout_total), 0);
      return { pole, ca, cout, marge: ca - cout, nbVentes: duPole.length };
    });

    // --- CA par produit
    const parProduit = new Map<string, { pole: Pole; quantite: number; ca: number; marge: number }>();
    for (const l of detail) {
      const pole = poleParVente.get(l.sale_id) ?? "MULTI_SERVICES";
      const cle = l.libelle;
      const acc = parProduit.get(cle) ?? { pole, quantite: 0, ca: 0, marge: 0 };
      acc.quantite += Number(l.quantite);
      acc.ca += Number(l.montant);
      acc.marge += Number(l.montant) - Number(l.prix_achat_unitaire) * Number(l.quantite);
      parProduit.set(cle, acc);
    }
    const caParProduit = [...parProduit.entries()]
      .map(([produit, v]) => ({ produit, ...v }))
      .sort((a, b) => b.ca - a.ca);

    // --- CA par employé
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

    // --- CA par mode de paiement
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
      caParPole,
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
        pole: s.pole as Pole,
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
  // §5.10 Journal de traçabilité
  // -------------------------------------------------------------------------

  api.get("/audit", requireRole(...VALIDENT), route(async (req, res) => {
    let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false });
    if (req.query.entite) q = q.eq("entite", String(req.query.entite));
    if (req.query.action) q = q.eq("action", String(req.query.action));

    const { data, error } = await q.limit(300);
    if (error) throw new Error(error.message);
    res.json(toCamelCaseArray(data ?? []));
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

  // Gestionnaire d'erreurs : le détail va aux logs serveur, le client reçoit un
  // message exploitable sans fuite d'information technique.
  app.use((err: Error, _req: express.Request, res: Response, _next: express.NextFunction) => {
    console.error("[api]", err);
    res.status(500).json({ error: err.message || "Erreur interne du serveur." });
  });

  return app;
}
