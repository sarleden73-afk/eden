import express from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth, AuthRequest } from "./middleware/auth.js";
import { supabase } from "./lib/supabase-server.js";
import { toSnakeCase, toCamelCase, toCamelCaseArray } from "./lib/caseConvert.js";
import { notifyOnce } from "./lib/whatsapp.js";
import { generateCardNumber, generateCustomerCode } from "./lib/customerCodes.js";
import { registerPublicRoutes } from "./publicApi.js";

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// Builds the Express app with all /api routes. Shared by the local dev server
// (server.ts) and the Vercel serverless handler (api/index.ts). It does NOT
// call listen() or serve static/Vite assets — those are environment-specific.
export function createApiApp() {
  const app = express();

  // Vercel/tout reverse-proxy en amont : nécessaire pour que req.ip reflète le
  // vrai client (utilisé par le rate-limiting des routes publiques ci-dessous).
  app.set("trust proxy", true);

  app.use(express.json({ limit: "5mb" })); // selfies are base64-encoded images

  // CORS ouvert, mais restreint au préfixe /api/public : ce sont les seules routes
  // conçues pour être appelées depuis un autre domaine (le site vitrine, déployé en
  // tant que projet Vercel séparé). Le reste de l'API exige de toute façon un Bearer
  // token Supabase, donc l'absence de CORS ailleurs n'est pas une mesure de sécurité —
  // on la garde simplement inchangée pour ne rien modifier au comportement existant.
  app.use("/api/public", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  // Le site de réservation publique n'est pas encore validé par le client : ces
  // routes restent désactivées partout SAUF en local, tant que PUBLIC_BOOKING_ENABLED
  // n'est pas explicitement mis à "true" (jamais ajouté aux variables d'env Vercel
  // pour l'instant — donc inactif en production même si ce code est déployé).
  if (process.env.PUBLIC_BOOKING_ENABLED === "true") {
    registerPublicRoutes(app);
  }

  const syncUser = async (uid: string, email?: string) => {
    const existing = unwrap(await supabase.from("users").select("id").eq("uid", uid).limit(1));
    if (!existing || existing.length === 0) {
      unwrap(await supabase.from("users").insert({ uid, email: email || "" }));
    }
  };

  // Resolves the caller's access to a business. Returns the business plus the
  // caller's role ('admin' if owner or admin member, else 'staff'), or null
  // after sending the appropriate error response.
  const loadAccess = async (
    req: AuthRequest,
    res: express.Response,
    businessId: number
  ): Promise<{ business: any; role: string; employeeId?: number } | null> => {
    if (Number.isNaN(businessId)) {
      res.status(400).json({ error: "Invalid business id" });
      return null;
    }
    const rows = unwrap(await supabase.from("businesses").select("*").eq("id", businessId).limit(1));
    if (!rows || rows.length === 0) {
      res.status(404).json({ error: "Business not found" });
      return null;
    }
    const business = toCamelCase<{ ownerUid: string }>(rows[0]);
    if (business.ownerUid === req.user!.uid) return { business, role: "admin" };

    const mem = unwrap(await supabase.from("members").select("*").eq("business_id", businessId));
    const member = (mem || []).map((m) => toCamelCase<{ uid: string; email: string; role: string; employeeId?: number }>(m))
      .find((m) => m.uid === req.user!.uid || m.email === req.user!.email);
    if (member) return { business, role: member.role, employeeId: member.employeeId };

    res.status(403).json({ error: "Forbidden" });
    return null;
  };

  // Back-compat: returns the business if the caller is owner or member, else null.
  const loadOwnedBusiness = async (req: AuthRequest, res: express.Response, businessId: number) => {
    const access = await loadAccess(req, res, businessId);
    return access ? access.business : null;
  };

  const requireOwnedBusiness = async (
    req: AuthRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const access = await loadAccess(req, res, parseInt(req.params.id));
    if (!access) return; // response already sent
    // Le rôle 'employee' est volontairement cantonné au pointage (voir les deux
    // routes /employees ci-dessous, qui utilisent requireAnyMember à la place) :
    // il n'a accès à aucune autre route métier (clients, ventes, comptabilité...).
    if (access.role === "employee") {
      res.status(403).json({ error: "Ce compte n'a accès qu'au pointage." });
      return;
    }
    (req as any).business = access.business;
    (req as any).role = access.role;
    next();
  };

  // Comme requireOwnedBusiness, mais sans exclure le rôle 'employee' — réservé
  // aux quelques routes que le pointage doit pouvoir appeler lui-même.
  const requireAnyMember = async (
    req: AuthRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const access = await loadAccess(req, res, parseInt(req.params.id));
    if (!access) return; // response already sent
    (req as any).business = access.business;
    (req as any).role = access.role;
    next();
  };

  // Admin-only gate (owner or member with role 'admin').
  const requireAdmin = async (
    req: AuthRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const access = await loadAccess(req, res, parseInt(req.params.id));
    if (!access) return; // response already sent
    if (access.role !== "admin") {
      res.status(403).json({ error: "Réservé aux administrateurs" });
      return;
    }
    (req as any).business = access.business;
    (req as any).role = access.role;
    next();
  };

  const handleZodError = (res: express.Response, error: z.ZodError) => {
    res.status(400).json({ error: error.issues.map((i) => i.message).join(", ") });
  };

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- Avis clients (QR code -> page publique -> panneau admin) ---

  // Public : identifie l'unique entreprise de l'application (mono-tenant) pour que la
  // page d'avis /avis puisse fonctionner sans authentification. Ne renvoie rien de
  // sensible (juste id + nom).
  app.get("/api/public/business", async (req, res) => {
    try {
      const rows = unwrap(await supabase.from("businesses").select("id, name").limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const reviewSchema = z.object({
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
    customerName: z.string().trim().max(200).optional(),
    customerPhone: z.string().trim().max(30).optional(),
  });

  // Public : n'importe qui avec le lien/QR peut déposer un avis, sans authentification.
  // Nom + téléphone sont facultatifs côté client mais permettent au salon de recontacter
  // la personne — ils ne sont visibles que dans le panneau admin (jamais exposés ailleurs).
  app.post("/api/businesses/:id/reviews", async (req, res) => {
    try {
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("reviews").insert(toSnakeCase({
          businessId: parseInt(req.params.id),
          rating: parsed.data.rating,
          comment: parsed.data.comment,
          customerName: parsed.data.customerName,
          customerPhone: parsed.data.customerPhone,
        })).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Réservé admin : consultation des avis (note, commentaire, nom si renseigné).
  app.get("/api/businesses/:id/reviews", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(
        await supabase.from("reviews").select("*").eq("business_id", parseInt(req.params.id)).order("created_at", { ascending: false })
      );
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get business for logged in user (as owner, or as an invited staff member)
  app.get("/api/business", requireAuth, async (req: AuthRequest, res) => {
    try {
      await syncUser(req.user!.uid, req.user!.email);

      // Owner?
      const owned = unwrap(await supabase.from("businesses").select("*").eq("owner_uid", req.user!.uid).limit(1));
      if (owned && owned.length > 0) {
        res.json({ ...toCamelCase(owned[0]), role: "admin" });
        return;
      }

      // Invited member? (match by uid, else by email)
      let mem = unwrap(await supabase.from("members").select("*").eq("uid", req.user!.uid).limit(1));
      if ((!mem || mem.length === 0) && req.user!.email) {
        mem = unwrap(await supabase.from("members").select("*").eq("email", req.user!.email).limit(1));
        // Link this login to the membership for future lookups
        if (mem && mem.length > 0 && !mem[0].uid) {
          unwrap(await supabase.from("members").update({ uid: req.user!.uid }).eq("id", mem[0].id));
        }
      }
      if (mem && mem.length > 0) {
        const member = toCamelCase<{ businessId: number; role: string; employeeId?: number }>(mem[0]);
        const biz = unwrap(await supabase.from("businesses").select("*").eq("id", member.businessId).limit(1));
        if (biz && biz.length > 0) {
          res.json({ ...toCamelCase(biz[0]), role: member.role, employeeId: member.employeeId });
          return;
        }
      }

      res.json(null);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createBusinessSchema = z.object({ name: z.string().trim().min(1).max(200) });

  app.post("/api/business", requireAuth, async (req: AuthRequest, res) => {
    try {
      const parsed = createBusinessSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      await syncUser(req.user!.uid, req.user!.email);
      // Application mono-client : une seule entreprise autorisée.
      const anyBiz = unwrap(await supabase.from("businesses").select("id").limit(1));
      if (anyBiz && anyBiz.length > 0) {
        return res.status(403).json({ error: "Une entreprise existe déjà sur cette application." });
      }
      const result = unwrap(
        await supabase.from("businesses").insert({ name: parsed.data.name, owner_uid: req.user!.uid }).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/programs", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("programs").select("*").eq("business_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createProgramSchema = z.object({
    name: z.string().trim().min(1).max(200),
    visitsRequired: z.coerce.number().int().min(1).max(1000),
    rewardDescription: z.string().trim().min(1).max(500),
  });

  app.post("/api/businesses/:id/programs", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = createProgramSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase
          .from("programs")
          .insert({
            business_id: parseInt(req.params.id),
            name: parsed.data.name,
            visits_required: parsed.data.visitsRequired,
            reward_description: parsed.data.rewardDescription,
          })
          .select()
          .single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/customers", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const isAdmin = (req as any).role === "admin";
      const rows = unwrap(await supabase.from("customers").select("*").eq("business_id", businessId));
      // Attach each customer's last visit date so the UI can flag inactive clients.
      const visitRows = unwrap(await supabase.from("visits").select("customer_id, date").eq("business_id", businessId));
      const lastVisitByCustomer: Record<string, string> = {};
      for (const v of visitRows || []) {
        if (!lastVisitByCustomer[v.customer_id] || v.date > lastVisitByCustomer[v.customer_id]) lastVisitByCustomer[v.customer_id] = v.date;
      }
      // Le numéro de téléphone est une donnée réservée à l'administrateur : le staff
      // ne doit jamais le recevoir (on le retire de la réponse, pas seulement de l'affichage).
      const enriched = (rows || []).map((r) => {
        const c: any = { ...toCamelCase(r), lastVisitDate: lastVisitByCustomer[r.id] || null };
        if (!isAdmin) c.phone = null;
        return c;
      });
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Recherche d'un client par téléphone (caisse). Accessible au staff pour retrouver
  // un client via le numéro qu'il communique, MAIS la réponse ne renvoie jamais le
  // numéro au staff — il ne peut donc pas parcourir/collecter les contacts.
  app.get("/api/businesses/:id/customers/lookup", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const isAdmin = (req as any).role === "admin";
      const phone = String(req.query.phone || "").replace(/\s/g, "").trim();
      if (phone.length < 3) return res.json(null);
      const rows = unwrap(await supabase.from("customers").select("*").eq("business_id", businessId));
      const match: any = (rows || [])
        .map((r) => toCamelCase<any>(r))
        .find((c: any) => (c.phone || "").replace(/\s/g, "").includes(phone));
      if (!match) return res.json(null);
      if (!isAdmin) match.phone = null;
      res.json(match);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createCustomerSchema = z.object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(30),
    // Carte de fidélité optionnelle : true (défaut) attribue une carte, false crée
    // juste la fiche client (retrouvable, mais sans carte tant qu'on ne lui en attribue pas une).
    hasCard: z.boolean().optional(),
  });

  app.post("/api/businesses/:id/customers", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = createCustomerSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const businessId = parseInt(req.params.id);
      const wantsCard = parsed.data.hasCard !== false; // carte attribuée par défaut

      // Cryptographically random, unguessable client id (public card URLs rely on this being unenumerable)
      const id = "CARD-" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();

      // Carte de fidélité : numéro attribué seulement si demandé (sinon null = pas de carte).
      const cardNumber = wantsCard ? await generateCardNumber(businessId) : null;
      const code = await generateCustomerCode(businessId);

      const result = unwrap(
        await supabase
          .from("customers")
          .insert({
            id,
            business_id: businessId,
            name: parsed.data.name,
            phone: parsed.data.phone,
            card_number: cardNumber,
            code,
          })
          .select()
          .single()
      );
      if (process.env.WHATSAPP_WELCOME_ENABLED === "true") {
        await notifyOnce({
          businessId, customerId: id, phone: parsed.data.phone,
          type: "welcome_new_client", referenceId: id,
          params: [parsed.data.name, code],
        });
      }
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const assignCardSchema = z.object({ cardNumber: z.string().trim().max(30).optional() });

  // Attribuer (ou remplacer) une carte de fidélité à un client existant. Le numéro est
  // auto-généré, ou fourni (ex: numéro d'une carte physique pré-imprimée). Admin + staff.
  app.post("/api/customers/:id/card", requireAuth, async (req: AuthRequest, res) => {
    try {
      const custs = unwrap(await supabase.from("customers").select("*").eq("id", req.params.id).limit(1));
      if (!custs || custs.length === 0) return res.status(404).json({ error: "Customer not found" });
      const customer = toCamelCase<{ businessId: number }>(custs[0]);
      const access = await loadAccess(req, res, customer.businessId);
      if (!access) return; // response already sent
      const parsed = assignCardSchema.safeParse(req.body || {});
      if (!parsed.success) return handleZodError(res, parsed.error);
      let cardNumber = (parsed.data.cardNumber || "").trim();
      if (cardNumber) {
        const clash = unwrap(
          await supabase.from("customers").select("id").eq("business_id", customer.businessId).eq("card_number", cardNumber).neq("id", req.params.id).limit(1)
        );
        if (clash && clash.length > 0) return res.status(400).json({ error: "Ce numéro de carte est déjà attribué à un autre client." });
      } else {
        cardNumber = await generateCardNumber(customer.businessId);
      }
      const result = unwrap(await supabase.from("customers").update({ card_number: cardNumber }).eq("id", req.params.id).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Public: powers the shareable /card/:id loyalty card page (no login for customers).
  app.get("/api/customers/:id", async (req, res) => {
    try {
      const rows = unwrap(await supabase.from("customers").select("*").eq("id", req.params.id).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const customer = toCamelCase<{ businessId: number; visits: number; points: number; stamps: number; phone?: string }>(rows[0]);
      const mode = await getLoyaltyMode(customer.businessId);
      const progress = progressFor(mode, customer);
      const unlockedRewards = await getUnlockedRewards(customer.businessId, progress);
      const tier = await getCurrentTier(customer.businessId, req.params.id, mode, progress);
      // Endpoint public (page carte partageable) : ne jamais exposer le téléphone.
      delete (customer as any).phone;
      res.json({ ...customer, loyaltyMode: mode, progress, unlockedRewards, tier: tier?.name || null });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Loyalty engine helpers (mode: 'visits' | 'points' | 'stamps') ---

  const getLoyaltyMode = async (businessId: number): Promise<string> => {
    const rows = unwrap(await supabase.from("loyalty_settings").select("mode").eq("business_id", businessId).limit(1));
    return rows && rows.length > 0 ? rows[0].mode : "visits";
  };

  const progressFor = (mode: string, customer: { visits: number; points: number; stamps: number }) =>
    mode === "points" ? customer.points || 0 : mode === "stamps" ? customer.stamps || 0 : customer.visits || 0;

  const getUnlockedRewards = async (businessId: number, progress: number) => {
    const rows = unwrap(
      await supabase.from("rewards").select("*").eq("business_id", businessId).eq("active", true).lte("threshold", progress).order("threshold")
    );
    return toCamelCaseArray(rows || []);
  };

  const getWindowedVisitCount = async (customerId: string, days: number) => {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    // is_primary=true isolates one row per checkout (a checkout can have several
    // service lines) so this counts real passages, not prestation lines.
    const rows = unwrap(await supabase.from("visits").select("id").eq("customer_id", customerId).eq("is_primary", true).gte("date", since));
    return rows ? rows.length : 0;
  };

  // Highest tier the customer qualifies for. Tiers with window_days require that
  // many visits within that rolling window (e.g. "4 visites en 60 jours"); others
  // use the lifetime progress value.
  const getCurrentTier = async (businessId: number, customerId: string, mode: string, progress: number) => {
    const rows = unwrap(await supabase.from("tiers").select("*").eq("business_id", businessId).order("threshold", { ascending: false }));
    for (const row of rows || []) {
      const tier = toCamelCase<{ name: string; threshold: number; windowDays?: number }>(row);
      if (tier.windowDays && mode === "visits") {
        const count = await getWindowedVisitCount(customerId, tier.windowDays);
        if (count >= tier.threshold) return tier;
      } else if (progress >= tier.threshold) {
        return tier;
      }
    }
    return null;
  };

  const validateVisitSchema = z.object({
    // employeeId obligatoire sur chaque ligne : traçabilité par prestataire non
    // négociable (demande explicite du client — aucune vente ne doit pouvoir être
    // enregistrée sans savoir qui a réalisé la prestation). Volontairement optionnel
    // ici (zod émet un message technique confus sur une valeur manquante coercée) :
    // la présence réelle est vérifiée juste après, avec un message clair pour l'un
    // et l'autre format (items[] ou l'ancien format à plat).
    items: z.array(z.object({
      serviceId: z.coerce.number().int().positive().optional(),
      variantId: z.coerce.number().int().positive().optional(),
      // Vente directe d'un produit d'inventaire (ex: une boisson), indépendamment
      // de toute prestation. Pas de "qui l'a réalisée" ici — pas de prestataire.
      productId: z.coerce.number().int().positive().optional(),
      employeeId: z.coerce.number().int().positive().optional(),
      offered: z.boolean().optional(), // prestation/produit offert (montant et points à 0)
    })).min(1).optional(),
    tip: z.coerce.number().int().min(0).optional(),
    discount: z.coerce.number().int().min(0).optional(),
    // Legacy single-service shape, still supported (employeeId validé plus bas, une
    // fois "items" résolu — ce champ doit rester optionnel ici pour ne pas casser
    // le format items[], qui ne l'utilise pas).
    serviceId: z.coerce.number().int().positive().optional(),
    variantId: z.coerce.number().int().positive().optional(),
    employeeId: z.coerce.number().int().positive().optional(),
  });

  app.post("/api/customers/:id/visits", requireAuth, async (req: AuthRequest, res) => {
    try {
      const customerId = req.params.id;
      const parsed = validateVisitSchema.safeParse(req.body || {});
      if (!parsed.success) return handleZodError(res, parsed.error);
      const items = parsed.data.items && parsed.data.items.length > 0
        ? parsed.data.items
        : [{ serviceId: parsed.data.serviceId, variantId: parsed.data.variantId, employeeId: parsed.data.employeeId }];

      // Couvre aussi l'ancien format à plat (une seule prestation, hors items[]) : le
      // schéma ne peut pas l'exiger sans casser le format items[], donc on le vérifie ici.
      // Seules les PRESTATIONS exigent un employé (traçabilité du prestataire) — une
      // ligne produit pur (vente directe, ex: une boisson) n'a pas de "prestataire".
      if (items.some((it) => (it.serviceId || it.variantId) && !it.employeeId)) {
        return res.status(400).json({ error: "Chaque prestation doit être liée à l'employé qui l'a réalisée." });
      }

      const custs = unwrap(await supabase.from("customers").select("*").eq("id", customerId).limit(1));
      if (!custs || custs.length === 0) return res.status(404).json({ error: "Customer not found" });
      const customer = toCamelCase<{ businessId: number; visits: number; points: number; stamps: number; name: string; phone: string }>(custs[0]);

      const business = await loadOwnedBusiness(req, res, customer.businessId);
      if (!business) return; // response already sent

      // Guard against accidental double validation (same customer within the last 60s)
      const recent = unwrap(
        await supabase.from("visits").select("id").eq("customer_id", customerId)
          .gt("date", new Date(Date.now() - 60_000).toISOString())
      );
      if (recent && recent.length > 0) {
        return res.status(400).json({ error: "Visite déjà validée à l'instant. Patientez un instant." });
      }

      // Resolve each service/variant → amount + points, insert one visit row per item (detailed history)
      let totalAmount = 0;
      let totalPoints = 0;
      const performedNames: string[] = [];
      const tip = parsed.data.tip || 0;
      const discount = Math.min(parsed.data.discount || 0, Number.MAX_SAFE_INTEGER);
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        let serviceId: number | null = null;
        let serviceName: string | null = null;
        let amountFcfa = 0;
        let earnedPoints = 0;
        // Produit vendu directement (hors prestation, ex: une boisson) : réutilisé
        // plus bas pour décrémenter son stock sans re-interroger la base.
        let directProduct: { id: number; usesPerUnit: number; stockUses: number } | null = null;
        if (item.variantId) {
          const vr = unwrap(await supabase.from("service_variants").select("*").eq("id", item.variantId).limit(1));
          if (vr && vr.length > 0) {
            const variant = toCamelCase<{ serviceId: number; name: string; price: number; points?: number }>(vr[0]);
            serviceId = variant.serviceId;
            amountFcfa = Math.round(variant.price / 100);
            earnedPoints = variant.points ?? Math.round(amountFcfa / 1000);
            const sv = unwrap(await supabase.from("services").select("name").eq("id", variant.serviceId).limit(1));
            serviceName = (sv && sv[0]?.name ? sv[0].name + " — " : "") + variant.name;
          }
        } else if (item.serviceId) {
          const sv = unwrap(await supabase.from("services").select("*").eq("id", item.serviceId).eq("business_id", customer.businessId).limit(1));
          if (sv && sv.length > 0) {
            const service = toCamelCase<{ id: number; name: string; price: number; points?: number }>(sv[0]);
            serviceId = service.id;
            serviceName = service.name;
            amountFcfa = Math.round(service.price / 100);
            earnedPoints = service.points ?? Math.round(amountFcfa / 1000);
          }
        } else if (item.productId) {
          const pr = unwrap(
            await supabase.from("products").select("*").eq("id", item.productId).eq("business_id", customer.businessId).limit(1)
          );
          if (pr && pr.length > 0) {
            const product = toCamelCase<{ id: number; name: string; price?: number; usesPerUnit?: number; stockUses?: number }>(pr[0]);
            serviceName = product.name;
            amountFcfa = Math.round((product.price || 0) / 100);
            earnedPoints = Math.round(amountFcfa / 1000);
            directProduct = { id: product.id, usesPerUnit: product.usesPerUnit || 1, stockUses: product.stockUses || 0 };
          }
        }
        if (item.offered) {
          earnedPoints = 0;
          if (serviceName) serviceName += " (Offert)";
        }
        // Le prix catalogue reste stocké sur la ligne (même offerte) pour le reporting
        // « prestations offertes », mais une prestation offerte n'est PAS facturée :
        // elle n'entre donc pas dans le total encaissé ni dans le chiffre d'affaires.
        if (!item.offered) totalAmount += amountFcfa;
        totalPoints += earnedPoints;
        if (serviceName) performedNames.push(serviceName);

        unwrap(
          await supabase.from("visits").insert(toSnakeCase({
            customerId,
            businessId: customer.businessId,
            serviceId,
            serviceName,
            employeeId: item.employeeId,
            amount: amountFcfa || null,
            points: earnedPoints,
            offered: !!item.offered,
            // Le pourboire et la réduction concernent l'ensemble du ticket : on les
            // rattache à la première ligne pour ne les afficher qu'une fois dans l'historique.
            tip: idx === 0 ? tip : 0,
            discount: idx === 0 ? discount : 0,
            isPrimary: idx === 0,
            validatedBy: req.user!.uid,
          }))
        );

        // Décrément automatique du stock : chaque produit lié à cette prestation est
        // consommé (même si la prestation est offerte : le produit est bien utilisé).
        // Best-effort : un souci d'inventaire ne doit jamais bloquer une vente.
        if (serviceId) {
          try {
            const links = unwrap(await supabase.from("service_products").select("*").eq("service_id", serviceId));
            for (const link of links || []) {
              const l = toCamelCase<{ productId: number; usesPerPrestation: number }>(link);
              const prod = unwrap(await supabase.from("products").select("stock_uses").eq("id", l.productId).limit(1));
              if (prod && prod.length > 0) {
                const usedQty = l.usesPerPrestation || 1;
                const newStock = Math.max(0, (prod[0].stock_uses || 0) - usedQty);
                unwrap(await supabase.from("products").update({ stock_uses: newStock }).eq("id", l.productId));
                unwrap(await supabase.from("stock_movements").insert({
                  business_id: customer.businessId, product_id: l.productId, delta: -usedQty,
                  reason: `Vente — ${serviceName || "prestation"}`, created_by: req.user!.uid,
                }));
              }
            }
          } catch (e) {
            console.error("Décrément stock échoué:", (e as Error).message);
          }
        }

        // Vente directe d'un produit (hors prestation, ex: une boisson) : son propre
        // stock est décrémenté immédiatement, même logique best-effort que ci-dessus.
        if (directProduct) {
          try {
            const usedQty = directProduct.usesPerUnit;
            const newStock = Math.max(0, directProduct.stockUses - usedQty);
            unwrap(await supabase.from("products").update({ stock_uses: newStock }).eq("id", directProduct.id));
            unwrap(await supabase.from("stock_movements").insert({
              business_id: customer.businessId, product_id: directProduct.id, delta: -usedQty,
              reason: `Vente comptoir${item.offered ? " (offert)" : ""}`, created_by: req.user!.uid,
            }));
          } catch (e) {
            console.error("Décrément stock (vente directe) échoué:", (e as Error).message);
          }
        }
      }
      const netPrestations = Math.max(0, totalAmount - discount); // chiffre d'affaires prestations (hors pourboire)
      totalAmount = netPrestations + tip;                         // total encaissé (avec pourboire)

      const mode = await getLoyaltyMode(customer.businessId);
      const newVisits = customer.visits + 1; // one checkout = one visit, regardless of number of services
      const newPoints = (customer.points || 0) + totalPoints;
      const newStamps = (customer.stamps || 0) + 1;
      const newProgress = progressFor(mode, { visits: newVisits, points: newPoints, stamps: newStamps });

      const unlocked = await getUnlockedRewards(customer.businessId, newProgress);
      const tier = await getCurrentTier(customer.businessId, customerId, mode, newProgress);
      const newRewardStatus = unlocked.length > 0 ? "available" : "pending";

      unwrap(
        await supabase.from("customers").update({
          visits: newVisits, points: newPoints, stamps: newStamps, reward_status: newRewardStatus,
        }).eq("id", customerId)
      );

      // Comptabilité automatique : chaque vente crée une écriture crédit (source unique).
      // Le pourboire est enregistré séparément (catégorie "Pourboire") pour que le total
      // encaissé affiché dans les Rapports (net + pourboires) corresponde exactement au
      // solde de la Comptabilité. Les prestations offertes ne génèrent aucune écriture.
      // Best-effort : si l'écriture échoue, la vente reste enregistrée (on ne casse pas la caisse).
      if (netPrestations > 0) {
        try {
          const label = `Vente — ${customer.name}${performedNames.length ? " : " + performedNames.join(", ") : ""}`;
          unwrap(await supabase.from("transactions").insert(toSnakeCase({
            businessId: customer.businessId,
            type: "credit",
            amount: netPrestations,
            category: "Vente",
            description: label.slice(0, 500),
            date: new Date(),
            createdBy: req.user!.uid,
          })));
        } catch (e) {
          console.error("Compta auto (vente) échouée:", (e as Error).message);
        }
      }
      if (tip > 0) {
        try {
          unwrap(await supabase.from("transactions").insert(toSnakeCase({
            businessId: customer.businessId,
            type: "credit",
            amount: tip,
            category: "Pourboire",
            description: `Pourboire — ${customer.name}`,
            date: new Date(),
            createdBy: req.user!.uid,
          })));
        } catch (e) {
          console.error("Compta auto (pourboire) échouée:", (e as Error).message);
        }
      }

      res.json({
        newVisits, newPoints, newStamps, earnedPoints: totalPoints, amount: totalAmount,
        serviceName: performedNames.join(", "), newRewardStatus,
        unlockedRewards: unlocked, tier: tier?.name || null,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Public: powers the shareable /card/:id loyalty card page (no login for customers).
  app.get("/api/customers/:id/visits", async (req, res) => {
    try {
      const rows = unwrap(await supabase.from("visits").select("*").eq("customer_id", req.params.id));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const redeemSchema = z.object({ rewardId: z.coerce.number().int().positive() });

  app.post("/api/customers/:id/redeem", requireAuth, async (req: AuthRequest, res) => {
    try {
      const custs = unwrap(await supabase.from("customers").select("*").eq("id", req.params.id).limit(1));
      if (!custs || custs.length === 0) return res.status(404).json({ error: "Customer not found" });
      const customer = toCamelCase<{ businessId: number; visits: number; points: number; stamps: number }>(custs[0]);

      const business = await loadOwnedBusiness(req, res, customer.businessId);
      if (!business) return; // response already sent

      const parsed = redeemSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);

      const rw = unwrap(await supabase.from("rewards").select("*").eq("id", parsed.data.rewardId).eq("business_id", customer.businessId).limit(1));
      if (!rw || rw.length === 0) return res.status(404).json({ error: "Récompense introuvable" });
      const reward = toCamelCase<{ id: number; threshold: number }>(rw[0]);

      const mode = await getLoyaltyMode(customer.businessId);
      const progress = progressFor(mode, customer);
      if (progress < reward.threshold) return res.status(400).json({ error: "Le client n'a pas encore atteint le seuil de cette récompense." });

      unwrap(await supabase.from("customer_rewards").insert({ customer_id: req.params.id, reward_id: reward.id, redeemed_by: req.user!.uid }));
      // Redeeming resets the progress counter to zero for a fresh loyalty cycle.
      unwrap(await supabase.from("customers").update({ visits: 0, points: 0, stamps: 0, reward_status: "pending" }).eq("id", req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Loyalty configuration (admin) ---

  app.get("/api/businesses/:id/loyalty-settings", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const mode = await getLoyaltyMode(parseInt(req.params.id));
      res.json({ mode });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const loyaltySettingsSchema = z.object({ mode: z.enum(["visits", "points", "stamps"]) });

  app.put("/api/businesses/:id/loyalty-settings", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const parsed = loyaltySettingsSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const businessId = parseInt(req.params.id);
      unwrap(await supabase.from("loyalty_settings").upsert({ business_id: businessId, mode: parsed.data.mode }, { onConflict: "business_id" }));
      res.json({ mode: parsed.data.mode });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/rewards", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("rewards").select("*").eq("business_id", parseInt(req.params.id)).order("threshold"));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const rewardSchema = z.object({
    label: z.string().trim().min(1).max(200),
    threshold: z.coerce.number().int().min(1),
    type: z.enum(["discount_amount", "discount_percent", "free_service", "product", "custom"]).default("custom"),
    value: z.string().trim().max(200).optional(),
    active: z.boolean().optional(),
  });

  app.post("/api/businesses/:id/rewards", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const parsed = rewardSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("rewards").insert({ business_id: parseInt(req.params.id), ...parsed.data, active: parsed.data.active ?? true }).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/rewards/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("rewards").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const reward = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, reward.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      const parsed = rewardSchema.partial().safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(await supabase.from("rewards").update(parsed.data).eq("id", parseInt(req.params.id)).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/rewards/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("rewards").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const reward = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, reward.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      unwrap(await supabase.from("rewards").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/tiers", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("tiers").select("*").eq("business_id", parseInt(req.params.id)).order("threshold"));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const tierSchema = z.object({
    name: z.string().trim().min(1).max(100),
    threshold: z.coerce.number().int().min(0),
    perks: z.string().trim().max(500).optional(),
    windowDays: z.coerce.number().int().min(1).max(3650).optional(), // ex: 60 = "N visites en 60 jours"
  });

  app.post("/api/businesses/:id/tiers", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const parsed = tierSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("tiers").insert({ business_id: parseInt(req.params.id), ...toSnakeCase(parsed.data) }).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/tiers/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("tiers").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const tier = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, tier.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      unwrap(await supabase.from("tiers").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/employees", requireAuth, requireAnyMember, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("employees").select("*").eq("business_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createEmployeeSchema = z.object({
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(30).optional(),
    avatarUrl: z.string().max(2_000_000).optional(),
  });

  // Ajout d'un employé : autorisé au staff et à 'employee' aussi (utile pour s'auto-inscrire au pointage).
  // La SUPPRESSION reste réservée à l'administrateur (voir DELETE /employees/:id ci-dessous).
  app.post("/api/businesses/:id/employees", requireAuth, requireAnyMember, async (req: AuthRequest, res) => {
    try {
      const parsed = createEmployeeSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase
          .from("employees")
          .insert({
            business_id: parseInt(req.params.id),
            name: parsed.data.name,
            role: parsed.data.role,
            phone: parsed.data.phone,
            avatar_url: parsed.data.avatarUrl,
          })
          .select()
          .single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete an employee (admin only). Cleans up dependent rows first.
  app.delete("/api/employees/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const empId = parseInt(req.params.id);
      const rows = unwrap(await supabase.from("employees").select("*").eq("id", empId).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const employee = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, employee.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      // Remove dependent rows / references before deleting
      unwrap(await supabase.from("time_logs").delete().eq("employee_id", empId));
      unwrap(await supabase.from("appointments").update({ employee_id: null }).eq("employee_id", empId));
      unwrap(await supabase.from("employees").delete().eq("id", empId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Clock-in / clock-out history for the whole business (admin only, traçabilité)
  app.get("/api/businesses/:id/time-logs", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const emps = unwrap(await supabase.from("employees").select("id, name").eq("business_id", businessId));
      const empIds = (emps || []).map((e: any) => e.id);
      if (empIds.length === 0) return res.json([]);
      const logs = unwrap(
        await supabase.from("time_logs").select("*").in("employee_id", empIds).order("clock_in_time", { ascending: false }).limit(500)
      );
      const nameById: Record<number, string> = {};
      (emps || []).forEach((e: any) => { nameById[e.id] = e.name; });
      const enriched = (logs || []).map((l: any) => ({ ...toCamelCase(l), employeeName: nameById[l.employee_id] || "—" }));
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/services", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("services").select("*").eq("business_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createServiceSchema = z.object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().max(100).optional(),
    price: z.coerce.number().int().min(0),
    duration: z.coerce.number().int().min(1).max(1440),
    description: z.string().trim().max(1000).optional(),
    points: z.coerce.number().int().min(0).optional(),
  });

  app.post("/api/businesses/:id/services", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = createServiceSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase
          .from("services")
          .insert({
            business_id: parseInt(req.params.id),
            name: parsed.data.name,
            category: parsed.data.category,
            price: parsed.data.price,
            duration: parsed.data.duration,
            description: parsed.data.description,
            points: parsed.data.points,
          })
          .select()
          .single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/services/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("services").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const svc = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, svc.businessId);
      if (!access) return;
      const parsed = createServiceSchema.partial().safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(await supabase.from("services").update(toSnakeCase(parsed.data)).eq("id", parseInt(req.params.id)).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/services/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("services").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const svc = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, svc.businessId);
      if (!access) return;
      const serviceId = parseInt(req.params.id);
      // Le nom de la prestation est déjà figé dans l'historique (visits.service_name),
      // donc on peut détacher les références avant de supprimer sans perdre l'historique.
      unwrap(await supabase.from("visits").update({ service_id: null }).eq("service_id", serviceId));
      unwrap(await supabase.from("appointments").delete().eq("service_id", serviceId));
      unwrap(await supabase.from("service_variants").delete().eq("service_id", serviceId));
      unwrap(await supabase.from("services").delete().eq("id", serviceId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/businesses/:id/appointments", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("appointments").select("*").eq("business_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createAppointmentSchema = z.object({
    customerId: z.string().trim().min(1),
    employeeId: z.coerce.number().int().positive().optional(),
    serviceId: z.coerce.number().int().positive(),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    status: z.enum(["scheduled", "completed", "cancelled", "in_progress"]).optional(),
  });

  app.post("/api/businesses/:id/appointments", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = createAppointmentSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      if (parsed.data.endTime <= parsed.data.startTime) {
        return res.status(400).json({ error: "endTime must be after startTime" });
      }
      const result = unwrap(
        await supabase
          .from("appointments")
          .insert(
            toSnakeCase({
              businessId: parseInt(req.params.id),
              customerId: parsed.data.customerId,
              employeeId: parsed.data.employeeId,
              serviceId: parsed.data.serviceId,
              startTime: parsed.data.startTime,
              endTime: parsed.data.endTime,
              status: parsed.data.status ?? "scheduled",
            })
          )
          .select()
          .single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Employee time clock ---

  const clockSchema = z.object({
    selfieUrl: z.string().max(2_000_000).optional(),
    locationLat: z.string().max(50).optional(),
    locationLng: z.string().max(50).optional(),
    livenessConfirmed: z.string().max(20).optional(),
  });

  app.post("/api/employees/:id/clock-in", requireAuth, async (req: AuthRequest, res) => {
    try {
      const empId = parseInt(req.params.id);
      const emp = unwrap(await supabase.from("employees").select("*").eq("id", empId).limit(1));
      if (!emp || emp.length === 0) return res.status(404).json({ error: "Employee not found" });
      const employee = toCamelCase<{ businessId: number }>(emp[0]);

      const access = await loadAccess(req, res, employee.businessId);
      if (!access) return; // response already sent
      // Un login 'employee' ne peut pointer que pour lui-même (pas pour un collègue).
      if (access.role === "employee" && access.employeeId !== empId) {
        return res.status(403).json({ error: "Vous ne pouvez pointer que pour vous-même." });
      }

      const parsed = clockSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);

      const openLog = unwrap(
        await supabase.from("time_logs").select("id").eq("employee_id", empId).is("clock_out_time", null)
      );
      if (openLog && openLog.length > 0) {
        return res.status(400).json({ error: "Employee is already clocked in." });
      }

      const result = unwrap(
        await supabase
          .from("time_logs")
          .insert(
            toSnakeCase({
              employeeId: empId,
              clockInTime: new Date(),
              selfieUrl: parsed.data.selfieUrl,
              locationLat: parsed.data.locationLat,
              locationLng: parsed.data.locationLng,
              livenessConfirmed: parsed.data.livenessConfirmed ?? "false",
            })
          )
          .select()
          .single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/employees/:id/clock-out", requireAuth, async (req: AuthRequest, res) => {
    try {
      const empId = parseInt(req.params.id);
      const emp = unwrap(await supabase.from("employees").select("*").eq("id", empId).limit(1));
      if (!emp || emp.length === 0) return res.status(404).json({ error: "Employee not found" });
      const employee = toCamelCase<{ businessId: number }>(emp[0]);

      const access = await loadAccess(req, res, employee.businessId);
      if (!access) return; // response already sent
      if (access.role === "employee" && access.employeeId !== empId) {
        return res.status(403).json({ error: "Vous ne pouvez pointer que pour vous-même." });
      }

      // Pointage libre : arrivée et départ sont deux boutons indépendants, dans
      // n'importe quel ordre (un employé peut avoir oublié de pointer son arrivée).
      // S'il existe une arrivée ouverte, on la clôture normalement. Sinon, on
      // enregistre quand même le départ seul (arrivée inconnue).
      const openLog = unwrap(
        await supabase.from("time_logs").select("id").eq("employee_id", empId).is("clock_out_time", null)
          .order("clock_in_time", { ascending: false }).limit(1)
      );
      const result = openLog && openLog.length > 0
        ? unwrap(await supabase.from("time_logs").update({ clock_out_time: new Date().toISOString() }).eq("id", openLog[0].id).select().single())
        : unwrap(await supabase.from("time_logs").insert({ employee_id: empId, clock_in_time: null, clock_out_time: new Date().toISOString() }).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Statut de pointage courant d'UN employé (arrivée ouverte ou non) : sert à
  // l'écran de pointage pour savoir quel bouton proposer, et pour imposer qu'une
  // arrivée soit pointée avant le départ. Volontairement scopé à un seul employé
  // (pas tout l'historique) pour rester accessible au rôle 'employee'.
  app.get("/api/employees/:id/current-status", requireAuth, async (req: AuthRequest, res) => {
    try {
      const empId = parseInt(req.params.id);
      const emp = unwrap(await supabase.from("employees").select("*").eq("id", empId).limit(1));
      if (!emp || emp.length === 0) return res.status(404).json({ error: "Employee not found" });
      const employee = toCamelCase<{ businessId: number }>(emp[0]);

      const access = await loadAccess(req, res, employee.businessId);
      if (!access) return;
      if (access.role === "employee" && access.employeeId !== empId) {
        return res.status(403).json({ error: "Accès réservé à votre propre pointage." });
      }

      const openLog = unwrap(
        await supabase.from("time_logs").select("clock_in_time").eq("employee_id", empId).is("clock_out_time", null)
          .order("clock_in_time", { ascending: false }).limit(1)
      );
      const clockedIn = !!(openLog && openLog.length > 0 && openLog[0].clock_in_time);
      res.json({ clockedIn, clockInTime: clockedIn ? openLog[0].clock_in_time : null });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Service categories ---

  app.get("/api/businesses/:id/categories", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("categories").select("*").eq("business_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createCategorySchema = z.object({ name: z.string().trim().min(1).max(100) });

  app.post("/api/businesses/:id/categories", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("categories").insert({ business_id: parseInt(req.params.id), name: parsed.data.name }).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Service variants ---

  // Loads a service and verifies the caller can access its business.
  const loadServiceAccess = async (req: AuthRequest, res: express.Response, serviceId: number) => {
    const rows = unwrap(await supabase.from("services").select("*").eq("id", serviceId).limit(1));
    if (!rows || rows.length === 0) {
      res.status(404).json({ error: "Service not found" });
      return null;
    }
    const service = toCamelCase<{ businessId: number }>(rows[0]);
    const access = await loadAccess(req, res, service.businessId);
    if (!access) return null;
    return { service, access };
  };

  app.get("/api/services/:id/variants", requireAuth, async (req: AuthRequest, res) => {
    try {
      const ctx = await loadServiceAccess(req, res, parseInt(req.params.id));
      if (!ctx) return;
      const rows = unwrap(await supabase.from("service_variants").select("*").eq("service_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createVariantSchema = z.object({
    name: z.string().trim().min(1).max(200),
    price: z.coerce.number().int().min(0),
    duration: z.coerce.number().int().min(1).max(1440).optional(),
  });

  app.post("/api/services/:id/variants", requireAuth, async (req: AuthRequest, res) => {
    try {
      const ctx = await loadServiceAccess(req, res, parseInt(req.params.id));
      if (!ctx) return;
      const parsed = createVariantSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("service_variants").insert({
          service_id: parseInt(req.params.id),
          name: parsed.data.name,
          price: parsed.data.price,
          duration: parsed.data.duration,
        }).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/variants/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("service_variants").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const variant = toCamelCase<{ serviceId: number }>(rows[0]);
      const ctx = await loadServiceAccess(req, res, variant.serviceId);
      if (!ctx) return;
      unwrap(await supabase.from("service_variants").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/categories/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("categories").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const cat = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, cat.businessId);
      if (!access) return;
      // Detach services pointing at this category, then delete it
      unwrap(await supabase.from("services").update({ category_id: null }).eq("category_id", parseInt(req.params.id)));
      unwrap(await supabase.from("categories").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Synthèse des ventes (source unique = table visits) ---
  // Une vente validée écrit dans `visits` ; ce endpoint agrège ces lignes pour alimenter
  // automatiquement Rapports, Tableau de bord et Comptabilité (aucune ressaisie).
  app.get("/api/businesses/:id/sales-summary", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      let query = supabase.from("visits").select("*").eq("business_id", businessId);
      if (typeof req.query.from === "string") query = query.gte("date", req.query.from);
      if (typeof req.query.to === "string") query = query.lte("date", req.query.to);
      const rows = toCamelCaseArray(unwrap(await query.order("date", { ascending: true })) || []) as any[];

      let prestations = 0, tickets = 0, gross = 0, discounts = 0, tips = 0, offeredCount = 0, offeredValue = 0;
      const seriesMap: Record<string, number> = {};
      const svcMap: Record<string, { count: number; amount: number }> = {};
      const empMap: Record<number, { count: number; amount: number }> = {}; // prestations par employé
      for (const v of rows) {
        prestations += 1;
        if (v.isPrimary) tickets += 1;
        const amt = v.amount || 0;
        const lineDiscount = v.isPrimary ? (v.discount || 0) : 0; // réduction rattachée au ticket
        if (v.offered) { offeredCount += 1; offeredValue += amt; }
        else { gross += amt; }
        discounts += lineDiscount;
        tips += v.tip || 0;
        const day = String(v.date || "").slice(0, 10);
        if (day) seriesMap[day] = (seriesMap[day] || 0) + (v.offered ? 0 : amt) - lineDiscount;
        const name = String(v.serviceName || "Autre").replace(" (Offert)", "");
        if (!svcMap[name]) svcMap[name] = { count: 0, amount: 0 };
        svcMap[name].count += 1;
        svcMap[name].amount += (v.offered ? 0 : amt);
        if (v.employeeId) {
          if (!empMap[v.employeeId]) empMap[v.employeeId] = { count: 0, amount: 0 };
          empMap[v.employeeId].count += 1;
          empMap[v.employeeId].amount += (v.offered ? 0 : amt);
        }
      }
      // Classement des employés par nombre de prestations réalisées sur la période
      // (pour "l'employé du mois" sur le tableau de bord).
      const empRows = unwrap(await supabase.from("employees").select("id, name").eq("business_id", businessId)) || [];
      const empName: Record<number, string> = {};
      for (const e of empRows) empName[e.id] = e.name;
      const topEmployees = Object.entries(empMap)
        .map(([id, s]) => ({ employeeId: Number(id), name: empName[Number(id)] || "—", count: s.count, amount: s.amount }))
        .sort((a, b) => b.count - a.count);
      const net = Math.max(0, gross - discounts);          // revenu net des prestations
      const collected = net + tips;                        // total encaissé (avec pourboires)
      const series = Object.entries(seriesMap)
        .map(([date, total]) => ({ date, total: Math.max(0, total) }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const topServices = Object.entries(svcMap)
        .map(([name, s]) => ({ name, count: s.count, amount: s.amount }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      res.json({ prestations, tickets, gross, discounts, tips, offeredCount, offeredValue, net, collected, series, topServices, topEmployees });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Accounting / transactions (owner + members) ---

  app.get("/api/businesses/:id/transactions", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      let query = supabase.from("transactions").select("*").eq("business_id", parseInt(req.params.id));
      if (typeof req.query.from === "string") query = query.gte("date", req.query.from);
      if (typeof req.query.to === "string") query = query.lte("date", req.query.to);
      const rows = unwrap(await query.order("date", { ascending: false }));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createTransactionSchema = z.object({
    type: z.enum(["credit", "debit"]),
    amount: z.coerce.number().int().min(0),
    category: z.string().trim().max(100).optional(),
    description: z.string().trim().max(500).optional(),
    date: z.coerce.date().optional(),
  });

  app.post("/api/businesses/:id/transactions", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = createTransactionSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("transactions").insert(
          toSnakeCase({
            businessId: parseInt(req.params.id),
            type: parsed.data.type,
            amount: parsed.data.amount,
            category: parsed.data.category,
            description: parsed.data.description,
            date: parsed.data.date ?? new Date(),
            createdBy: req.user!.uid,
          })
        ).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Modifier une opération : accessible au staff (correction d'une saisie).
  const updateTransactionSchema = createTransactionSchema.partial();
  app.put("/api/transactions/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("transactions").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const txn = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, txn.businessId);
      if (!access) return; // response already sent
      const parsed = updateTransactionSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const patch: any = {};
      if (parsed.data.type !== undefined) patch.type = parsed.data.type;
      if (parsed.data.amount !== undefined) patch.amount = parsed.data.amount;
      if (parsed.data.category !== undefined) patch.category = parsed.data.category;
      if (parsed.data.description !== undefined) patch.description = parsed.data.description;
      if (parsed.data.date !== undefined) patch.date = parsed.data.date;
      const result = unwrap(await supabase.from("transactions").update(patch).eq("id", parseInt(req.params.id)).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Supprimer une opération : réservé à l'administrateur (le staff ne supprime pas les écritures).
  app.delete("/api/transactions/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("transactions").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const txn = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, txn.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Suppression réservée à l'administrateur." });
      unwrap(await supabase.from("transactions").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Staff / members (admin only) ---

  app.get("/api/businesses/:id/members", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("members").select("*").eq("business_id", parseInt(req.params.id)));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createMemberSchema = z.object({
    email: z.string().trim().email().max(200),
    password: z.string().min(6).max(100),
    name: z.string().trim().max(200).optional(),
    role: z.enum(["admin", "staff", "employee"]).optional(),
    // Uniquement pertinent pour le rôle 'employee' : lie ce login à sa fiche employé
    // (planning/pointage) pour que son écran de pointage se cible automatiquement,
    // sans liste à choisir.
    employeeId: z.coerce.number().int().positive().optional(),
  });

  app.post("/api/businesses/:id/members", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const parsed = createMemberSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const email = parsed.data.email.toLowerCase();

      // Create the login account directly (no Google needed). If it already
      // exists, reuse it. email_confirm so the member can sign in immediately.
      let uid: string | null = null;
      const created = await supabase.auth.admin.createUser({ email, password: parsed.data.password, email_confirm: true });
      if (created.data?.user) {
        uid = created.data.user.id;
      } else {
        const list = await supabase.auth.admin.listUsers();
        const existing = list.data.users.find((u: any) => u.email === email);
        if (existing) uid = existing.id;
        else return res.status(400).json({ error: created.error?.message || "Impossible de créer le compte." });
      }
      if (uid) unwrap(await supabase.from("users").upsert({ uid, email }, { onConflict: "uid" }));

      const result = unwrap(
        await supabase.from("members").insert({
          business_id: parseInt(req.params.id),
          email,
          uid,
          name: parsed.data.name,
          role: parsed.data.role ?? "staff",
          employee_id: parsed.data.employeeId,
        }).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const updateMemberSchema = z.object({
    role: z.enum(["admin", "staff", "employee"]),
    employeeId: z.coerce.number().int().positive().optional(),
  });

  app.put("/api/members/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("members").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const member = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, member.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      const parsed = updateMemberSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("members").update({
          role: parsed.data.role,
          employee_id: parsed.data.role === "employee" ? parsed.data.employeeId : null,
        }).eq("id", parseInt(req.params.id)).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/members/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("members").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const member = toCamelCase<{ businessId: number; uid?: string }>(rows[0]);
      const access = await loadAccess(req, res, member.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      unwrap(await supabase.from("members").delete().eq("id", parseInt(req.params.id)));
      // Supprimer aussi le compte de connexion pour qu'il ne puisse plus se connecter
      if (member.uid) { try { await supabase.auth.admin.deleteUser(member.uid); } catch {} }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Cron : relance WhatsApp des clients inactifs (Vercel Cron, pas de session utilisateur) ---
  const INACTIVE_DAYS = 60; // même règle que le badge "Inactif" côté UI (Customers.tsx)
  const REMINDER_COOLDOWN_DAYS = 30; // ne pas relancer plus d'une fois par mois

  app.get("/api/cron/inactive-reminders", async (req, res) => {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (process.env.WHATSAPP_INACTIVE_REMINDER_ENABLED !== "true") return res.json({ skipped: true });
    try {
      const businesses = unwrap(await supabase.from("businesses").select("id"));
      let processed = 0;
      for (const biz of businesses || []) {
        const businessId = biz.id;
        const customers = unwrap(await supabase.from("customers").select("id, name, phone, created_at").eq("business_id", businessId)) || [];
        const visits = unwrap(await supabase.from("visits").select("customer_id, date").eq("business_id", businessId)) || [];
        const lastVisitByCustomer: Record<string, string> = {};
        for (const v of visits) {
          if (!lastVisitByCustomer[v.customer_id] || v.date > lastVisitByCustomer[v.customer_id]) lastVisitByCustomer[v.customer_id] = v.date;
        }
        const cutoff = Date.now() - INACTIVE_DAYS * 86400000;
        const recentReminders = unwrap(
          await supabase.from("whatsapp_notifications").select("customer_id")
            .eq("business_id", businessId).eq("type", "inactive_reminder")
            .gte("created_at", new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 86400000).toISOString())
        ) || [];
        const recentlyReminded = new Set(recentReminders.map((r: any) => r.customer_id));
        for (const c of customers) {
          if (!c.phone || recentlyReminded.has(c.id)) continue;
          const ref = lastVisitByCustomer[c.id] || c.created_at;
          if (!ref || new Date(ref).getTime() > cutoff) continue;
          await notifyOnce({
            businessId, customerId: c.id, phone: c.phone,
            type: "inactive_reminder", referenceId: `${c.id}:${new Date().toISOString().slice(0, 10)}`,
            params: [c.name],
          });
          processed++;
        }
      }
      res.json({ processed });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Inventaire / stocks (réservé à l'administrateur) ---

  // Inventaire : consultation + réappro accessibles au staff (comme comptabilité/
  // employés) ; seule la suppression reste réservée à l'admin.
  app.get("/api/businesses/:id/products", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("products").select("*").eq("business_id", parseInt(req.params.id)).order("name"));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const productSchema = z.object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().max(100).optional(),
    unitLabel: z.string().trim().max(50).optional(),
    usesPerUnit: z.coerce.number().int().min(1).max(100000),
    stockUses: z.coerce.number().int().min(0).optional(),
    lowStockUses: z.coerce.number().int().min(0).optional(),
    // Prix de vente d'1 unité (FCFA, centimes comme le reste du catalogue). Optionnel :
    // seuls les produits vendables directement à la caisse (boissons...) en ont un ; un
    // consommable interne (teinture...) n'est utilisé que via service_products.
    price: z.coerce.number().int().min(0).optional(),
  });

  app.post("/api/businesses/:id/products", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = productSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(
        await supabase.from("products").insert(toSnakeCase({
          businessId: parseInt(req.params.id),
          name: parsed.data.name,
          category: parsed.data.category,
          unitLabel: parsed.data.unitLabel || "unité",
          usesPerUnit: parsed.data.usesPerUnit,
          stockUses: parsed.data.stockUses ?? 0,
          lowStockUses: parsed.data.lowStockUses ?? 0,
          price: parsed.data.price,
        })).select().single()
      );
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/products/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("products").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const prod = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, prod.businessId);
      if (!access) return;
      const parsed = productSchema.partial().safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const result = unwrap(await supabase.from("products").update(toSnakeCase(parsed.data)).eq("id", parseInt(req.params.id)).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // delta en utilisations : positif = entrée (réappro), négatif = sortie (vente directe
  // d'un produit non lié à une prestation, casse, périmé...). reason optionnel, sinon
  // déduit du signe pour que l'historique reste toujours lisible.
  const restockSchema = z.object({ delta: z.coerce.number().int(), reason: z.string().trim().max(200).optional() });

  // Mouvement de stock explicite et tracé (contrairement à un simple PUT sur stockUses,
  // on sait toujours "quelle opération a fait bouger le stock"). Couvre aussi bien le
  // réapprovisionnement (+N) que la vente directe d'un produit hors prestation (-N,
  // ex: une boisson vendue à l'unité depuis un pack de 12).
  app.post("/api/products/:id/restock", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("products").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const prod = toCamelCase<{ businessId: number; stockUses: number }>(rows[0]);
      const access = await loadAccess(req, res, prod.businessId);
      if (!access) return;
      const parsed = restockSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      const newStock = Math.max(0, (prod.stockUses || 0) + parsed.data.delta);
      const result = unwrap(await supabase.from("products").update({ stock_uses: newStock }).eq("id", parseInt(req.params.id)).select().single());
      const defaultReason = parsed.data.delta >= 0 ? "Réapprovisionnement" : "Vente directe";
      unwrap(await supabase.from("stock_movements").insert({
        business_id: prod.businessId, product_id: parseInt(req.params.id),
        delta: parsed.data.delta, reason: parsed.data.reason || defaultReason, created_by: req.user!.uid,
      }));
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Historique des mouvements d'un produit (entrées réappro + sorties ventes).
  app.get("/api/products/:id/movements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("products").select("business_id").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const access = await loadAccess(req, res, rows[0].business_id);
      if (!access) return;
      const movements = unwrap(
        await supabase.from("stock_movements").select("*").eq("product_id", parseInt(req.params.id)).order("created_at", { ascending: false }).limit(30)
      );
      res.json(toCamelCaseArray(movements || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Historique complet de l'inventaire, tous produits confondus (traçabilité détaillée
  // demandée par l'admin) : chaque mouvement avec le nom du produit et de la personne
  // qui a fait l'opération.
  app.get("/api/businesses/:id/stock-movements", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const movements = unwrap(
        await supabase.from("stock_movements").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(200)
      ) || [];
      const productIds = Array.from(new Set(movements.map((m: any) => m.product_id)));
      const products = productIds.length
        ? unwrap(await supabase.from("products").select("id, name, unit_label").in("id", productIds)) || []
        : [];
      const productById: Record<number, any> = {};
      for (const p of products) productById[p.id] = p;

      // Résout l'auteur (uid Supabase Auth) en nom/e-mail lisible : propriétaire ou membre.
      const uids = Array.from(new Set(movements.map((m: any) => m.created_by).filter(Boolean)));
      const nameByUid: Record<string, string> = {};
      if (uids.length) {
        const biz = unwrap(await supabase.from("businesses").select("owner_uid").eq("id", businessId).limit(1));
        const ownerUid = biz && biz[0] ? biz[0].owner_uid : null;
        const members = unwrap(await supabase.from("members").select("uid, name, email").eq("business_id", businessId)) || [];
        const users = unwrap(await supabase.from("users").select("uid, email").in("uid", uids)) || [];
        for (const u of users) nameByUid[u.uid] = u.email;
        for (const m of members) if (m.uid) nameByUid[m.uid] = m.name || m.email;
        if (ownerUid) {
          const ownerUser = users.find((u: any) => u.uid === ownerUid);
          if (ownerUser) nameByUid[ownerUid] = `${ownerUser.email} (admin)`;
        }
      }

      const enriched = movements.map((m: any) => ({
        ...toCamelCase(m),
        productName: productById[m.product_id]?.name || `#${m.product_id}`,
        unitLabel: productById[m.product_id]?.unit_label || "unité",
        createdByName: (m.created_by && nameByUid[m.created_by]) || null,
      }));
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/products/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("products").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const prod = toCamelCase<{ businessId: number }>(rows[0]);
      const access = await loadAccess(req, res, prod.businessId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      unwrap(await supabase.from("service_products").delete().eq("product_id", parseInt(req.params.id)));
      unwrap(await supabase.from("products").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Liens prestation <-> produit (config dans l'onglet Inventaire, staff + admin)
  app.get("/api/businesses/:id/service-products", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const productIds = (unwrap(await supabase.from("products").select("id").eq("business_id", businessId)) || []).map((p: any) => p.id);
      if (productIds.length === 0) return res.json([]);
      const rows = unwrap(await supabase.from("service_products").select("*").in("product_id", productIds));
      res.json(toCamelCaseArray(rows || []));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const linkSchema = z.object({
    serviceId: z.coerce.number().int().positive(),
    productId: z.coerce.number().int().positive(),
    usesPerPrestation: z.coerce.number().int().min(1).max(1000).optional(),
  });

  app.post("/api/businesses/:id/service-products", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const parsed = linkSchema.safeParse(req.body);
      if (!parsed.success) return handleZodError(res, parsed.error);
      // upsert : si le lien existe déjà, on met à jour la quantité consommée
      const existing = unwrap(await supabase.from("service_products").select("id").eq("service_id", parsed.data.serviceId).eq("product_id", parsed.data.productId).limit(1));
      const payload = toSnakeCase({ serviceId: parsed.data.serviceId, productId: parsed.data.productId, usesPerPrestation: parsed.data.usesPerPrestation || 1 });
      const result = existing && existing.length > 0
        ? unwrap(await supabase.from("service_products").update(payload).eq("id", existing[0].id).select().single())
        : unwrap(await supabase.from("service_products").insert(payload).select().single());
      res.json(toCamelCase(result));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/service-products/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = unwrap(await supabase.from("service_products").select("*").eq("id", parseInt(req.params.id)).limit(1));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
      const link = toCamelCase<{ productId: number }>(rows[0]);
      const prod = unwrap(await supabase.from("products").select("business_id").eq("id", link.productId).limit(1));
      const bizId = prod && prod[0] ? prod[0].business_id : null;
      if (bizId == null) return res.status(404).json({ error: "Not found" });
      const access = await loadAccess(req, res, bizId);
      if (!access) return;
      if (access.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      unwrap(await supabase.from("service_products").delete().eq("id", parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Notifications in-app (cloche) : clients inactifs 60j+ et stock bas ---
  app.get("/api/businesses/:id/notifications", requireAuth, requireOwnedBusiness, async (req: AuthRequest, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const isAdmin = (req as any).role === "admin";
      const INACTIVE_DAYS = 60;

      // Clients inactifs (mêmes 60 jours que le badge "Inactif")
      const customers = unwrap(await supabase.from("customers").select("id, name, code, created_at").eq("business_id", businessId)) || [];
      const visits = unwrap(await supabase.from("visits").select("customer_id, date").eq("business_id", businessId)) || [];
      const lastVisit: Record<string, string> = {};
      for (const v of visits) {
        if (!lastVisit[v.customer_id] || v.date > lastVisit[v.customer_id]) lastVisit[v.customer_id] = v.date;
      }
      const cutoff = Date.now() - INACTIVE_DAYS * 86400000;
      const inactiveClients = customers
        .map((c: any) => {
          const ref = lastVisit[c.id] || c.created_at;
          const days = ref ? Math.floor((Date.now() - new Date(ref).getTime()) / 86400000) : 0;
          return { id: c.id, name: c.name, code: c.code, days, ref };
        })
        .filter((c: any) => c.ref && new Date(c.ref).getTime() <= cutoff)
        .sort((a: any, b: any) => b.days - a.days)
        .map(({ id, name, code, days }: any) => ({ id, name, code, days }));

      // Stock bas (réservé admin). Isolé dans son try : si la table products n'existe
      // pas encore (migration-007 non exécutée), la cloche fonctionne quand même pour
      // les clients inactifs.
      let lowStock: any[] = [];
      if (isAdmin) {
        try {
          const products = unwrap(await supabase.from("products").select("*").eq("business_id", businessId)) || [];
          lowStock = (products as any[])
            .map((p) => toCamelCase<any>(p))
            .filter((p: any) => (p.lowStockUses || 0) > 0 && (p.stockUses || 0) <= (p.lowStockUses || 0))
            .map((p: any) => ({
              id: p.id, name: p.name, unitLabel: p.unitLabel, usesPerUnit: p.usesPerUnit,
              stockUses: p.stockUses, unitsLeft: Math.floor((p.stockUses || 0) / (p.usesPerUnit || 1)),
            }));
        } catch { lowStock = []; }
      }

      res.json({ inactiveClients, lowStock });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return app;
}
