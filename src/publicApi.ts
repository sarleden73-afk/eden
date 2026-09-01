import express from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { supabase } from "./lib/supabase-server.js";
import { toCamelCase, toCamelCaseArray } from "./lib/caseConvert.js";
import { generateCardNumber, generateCustomerCode } from "./lib/customerCodes.js";

// Routes publiques (lecture seule sur le catalogue + création de rendez-vous en
// attente) consommées par le site vitrine JEANNY EMPIRE BEAUTY, déployé comme un
// projet Vercel séparé. Aucune authentification : ne jamais exposer ici de données
// sensibles (téléphones clients, chiffre d'affaires, comptabilité...).
//
// Mono-tenant : ce site ne sert qu'un seul salon. L'id business est fixé via env
// (par défaut 6 = JEANNY EMPIRE BEAUTY dans la base Supabase de production).
const PUBLIC_BUSINESS_ID = parseInt(process.env.PUBLIC_BUSINESS_ID || "6", 10);

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// Horaires d'ouverture (0 = dimanche ... 6 = samedi). Source de vérité unique,
// partagée par le calcul des créneaux ci-dessous et exposée au front (GET /catalog)
// pour que le site affiche toujours les mêmes horaires que ceux réellement appliqués.
type DayHours = { open: string; close: string } | null;
const OPENING_HOURS: Record<number, DayHours> = {
  0: null, // dimanche : fermé
  1: { open: "08:00", close: "19:00" },
  2: { open: "08:00", close: "19:00" },
  3: { open: "08:00", close: "19:00" },
  4: { open: "08:00", close: "19:00" },
  5: { open: "08:00", close: "19:00" },
  6: { open: "08:00", close: "19:00" },
};
const SLOT_STEP_MINUTES = 30;
const DEFAULT_DURATION_MINUTES = 30;
const MIN_LEAD_MINUTES = 60; // pas de réservation dans l'heure qui suit

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// `appointments.start_time`/`end_time` sont des colonnes `timestamp` SANS fuseau,
// et le reste de l'app (Agenda, src/pages/Appointments.tsx) les relit avec
// `new Date(apt.startTime)` côté NAVIGATEUR — donc interprétés dans le fuseau de
// l'appareil du salon (Afrique centrale/de l'Ouest, WAT = UTC+1, pas d'heure d'été —
// vrai pour le Cameroun comme pour Brazzaville). La convention de fait de toute la
// base est donc : les chiffres stockés SONT littéralement l'heure murale locale, sans
// aucune conversion. On s'y conforme : on ne convertit jamais réellement vers/depuis
// UTC pour le stockage, on manipule les chiffres tels quels via Date.UTC()/ISO (ce
// qui les laisse inchangés quel que soit le fuseau du serveur Node qui exécute ce
// code — Date.UTC() et toISOString() sont des opérations inverses TZ-indépendantes).
// Le SEUL endroit où l'écart réel avec UTC (+1h, WAT) compte est la comparaison avec
// l'instant réel "maintenant" (anti-réservation dans le passé).
const LOCAL_UTC_OFFSET_MIN = 60;

// Encode date+heure "telles quelles" (chiffres muraux) dans un nombre comparable/
// additionnable — PAS un vrai instant UTC, juste une représentation TZ-indépendante
// des mêmes chiffres qui seront stockés tels quels dans la colonne `timestamp`.
function wallClockMs(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, hh, mm);
}
function wallClockMsToTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
// Convertit un instant réel (Date.now()) en "chiffres muraux locaux" comparables
// aux valeurs produites par wallClockMs — c'est ici, et uniquement ici, qu'on
// applique le vrai décalage WAT (+1h) par rapport à un instant UTC réel.
function nowAsWallClockMs(): number {
  return Date.now() + LOCAL_UTC_OFFSET_MIN * 60000;
}
function localDayOfWeek(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}
// Rejette les dates syntaxiquement valides (format vérifié par zod) mais
// calendairement impossibles, ex. "2026-02-30".
function isValidCalendarDate(date: string): boolean {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// --- Anti-spam : best-effort en mémoire (par instance serverless) + vérification
// en base (source de vérité, résiste aux redémarrages/instances multiples). ---
const ipAttempts = new Map<string, number[]>();
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_ATTEMPTS = 8;

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = (ipAttempts.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  attempts.push(now);
  ipAttempts.set(ip, attempts);
  // Nettoyage occasionnel pour ne pas fuiter de mémoire indéfiniment.
  if (ipAttempts.size > 5000) {
    for (const [key, times] of ipAttempts) {
      if (times.every((t) => now - t >= IP_WINDOW_MS)) ipAttempts.delete(key);
    }
  }
  return attempts.length <= IP_MAX_ATTEMPTS;
}

function normalizePhoneDigits(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

export function registerPublicRoutes(app: express.Express) {
  // Catalogue complet : catégories + prestations + horaires. Un seul appel pour
  // limiter les allers-retours depuis le site (mobile-first, réseau parfois lent).
  app.get("/api/public/catalog", async (_req, res) => {
    try {
      const [categories, services] = await Promise.all([
        supabase.from("categories").select("id, name").eq("business_id", PUBLIC_BUSINESS_ID),
        supabase
          .from("services")
          .select("id, name, category_id, category, price, duration, description")
          .eq("business_id", PUBLIC_BUSINESS_ID),
      ]);
      const catRows = unwrap(categories);
      const svcRows = unwrap(services);
      res.json({
        categories: toCamelCaseArray(catRows || []),
        services: toCamelCaseArray(svcRows || []).map((s: any) => ({ ...s, price: s.price / 100 })),
        hours: OPENING_HOURS,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Employés actifs uniquement, et seulement les champs utiles pour choisir une
  // personne au moment de la réservation — jamais le téléphone.
  app.get("/api/public/employees", async (_req, res) => {
    try {
      const rows = unwrap(
        await supabase.from("employees").select("id, name, role, status").eq("business_id", PUBLIC_BUSINESS_ID)
      );
      const active = (rows || []).filter((e: any) => e.status === "active");
      res.json(toCamelCaseArray(active).map((e: any) => ({ id: e.id, name: e.name, role: e.role })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const slotsQuerySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
    duration: z.coerce.number().int().min(1).max(1440).optional(),
    employeeId: z.coerce.number().int().positive().optional(),
  });

  // Calcule, côté serveur (source de vérité unique), les créneaux réellement
  // réservables pour une date donnée : horaires d'ouverture, durée totale des
  // prestations choisies, et chevauchement avec l'agenda existant.
  app.get("/api/public/slots", async (req, res) => {
    try {
      const parsed = slotsQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
      const { date, employeeId } = parsed.data;
      const duration = parsed.data.duration ?? DEFAULT_DURATION_MINUTES;

      if (!isValidCalendarDate(date)) return res.status(400).json({ error: "Date invalide" });
      const hours = OPENING_HOURS[localDayOfWeek(date)];
      if (!hours) return res.json({ slots: [], closed: true });

      let employees = unwrap(
        await supabase.from("employees").select("id, status").eq("business_id", PUBLIC_BUSINESS_ID)
      ) as any[];
      employees = (employees || []).filter((e) => e.status === "active");
      if (employeeId) employees = employees.filter((e) => e.id === employeeId);
      if (employees.length === 0) return res.json({ slots: [] });

      // Fenêtre [00:00, 23:59] "chiffres muraux" de la date demandée.
      const dayStartFilter = new Date(wallClockMs(date, "00:00")).toISOString();
      const dayEndFilter = new Date(wallClockMs(date, "23:59")).toISOString();
      const appts = unwrap(
        await supabase
          .from("appointments")
          .select("employee_id, start_time, end_time, status")
          .eq("business_id", PUBLIC_BUSINESS_ID)
          .gte("start_time", dayStartFilter)
          .lte("start_time", dayEndFilter)
      ) as any[];
      const busyByEmployee = new Map<number, { start: number; end: number }[]>();
      for (const a of appts || []) {
        if (a.status === "cancelled" || a.employee_id == null) continue;
        const list = busyByEmployee.get(a.employee_id) || [];
        // `a.start_time`/`a.end_time` reviennent sans "Z" (colonne `timestamp` sans
        // fuseau) : on l'ajoute nous-mêmes pour forcer un parsing TZ-indépendant des
        // chiffres littéraux, cohérent avec wallClockMs (sinon `new Date(str)` sans
        // suffixe se ferait réinterpréter dans le fuseau du process Node).
        list.push({ start: new Date(a.start_time + "Z").getTime(), end: new Date(a.end_time + "Z").getTime() });
        busyByEmployee.set(a.employee_id, list);
      }

      const now = nowAsWallClockMs();
      const openMin = timeToMinutes(hours.open);
      const closeMin = timeToMinutes(hours.close);
      const slots: string[] = [];
      for (let t = openMin; t + duration <= closeMin; t += SLOT_STEP_MINUTES) {
        const slotStart = wallClockMs(date, minutesToTime(t));
        const slotEnd = slotStart + duration * 60000;
        if (slotStart < now + MIN_LEAD_MINUTES * 60000) continue;
        const hasFreeEmployee = employees.some((e) => {
          const busy = busyByEmployee.get(e.id) || [];
          return busy.every((b) => slotEnd <= b.start || slotStart >= b.end);
        });
        if (hasFreeEmployee) slots.push(minutesToTime(t));
      }
      res.json({ slots });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const createPublicAppointmentSchema = z.object({
    serviceIds: z.array(z.coerce.number().int().positive()).min(1).max(10),
    employeeId: z.coerce.number().int().positive().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide"),
    name: z.string().trim().min(2, "Nom trop court").max(200),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => normalizePhoneDigits(v).length >= 8 && normalizePhoneDigits(v).length <= 13, "Numéro de téléphone invalide"),
    notes: z.string().trim().max(500).optional(),
  });

  app.post("/api/public/appointments", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkIpRateLimit(ip)) {
        return res.status(429).json({ error: "Trop de tentatives. Merci de réessayer plus tard, ou de nous écrire directement sur WhatsApp." });
      }

      const parsed = createPublicAppointmentSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
      const { serviceIds, employeeId, date, time, name, phone, notes } = parsed.data;

      if (!isValidCalendarDate(date)) return res.status(400).json({ error: "Date invalide" });
      const hours = OPENING_HOURS[localDayOfWeek(date)];
      if (!hours) return res.status(400).json({ error: "Le salon est fermé ce jour-là." });

      const startTimeMs = wallClockMs(date, time);
      if (startTimeMs < nowAsWallClockMs() + MIN_LEAD_MINUTES * 60000) {
        return res.status(400).json({ error: "Merci de choisir un créneau au moins une heure à l'avance." });
      }
      const openMin = timeToMinutes(hours.open);
      const closeMin = timeToMinutes(hours.close);
      const slotMin = timeToMinutes(time);
      if (slotMin < openMin || slotMin >= closeMin) {
        return res.status(400).json({ error: "Horaire en dehors des heures d'ouverture." });
      }

      // Services : doivent tous appartenir à ce salon.
      const svcRows = unwrap(
        await supabase.from("services").select("id, name, duration").eq("business_id", PUBLIC_BUSINESS_ID).in("id", serviceIds)
      ) as any[];
      if (!svcRows || svcRows.length !== serviceIds.length) {
        return res.status(400).json({ error: "Une ou plusieurs prestations sont introuvables." });
      }
      const servicesById = new Map(svcRows.map((s) => [s.id, s]));
      const orderedServices = serviceIds.map((id) => servicesById.get(id)!);
      const totalDuration = orderedServices.reduce((sum, s) => sum + (s.duration || DEFAULT_DURATION_MINUTES), 0);
      const endTimeMs = startTimeMs + totalDuration * 60000;
      if (slotMin + totalDuration > closeMin) {
        return res.status(400).json({ error: "La durée totale dépasse l'heure de fermeture, choisissez un autre créneau." });
      }

      // Employés actifs éligibles.
      let employees = unwrap(
        await supabase.from("employees").select("id, name, status").eq("business_id", PUBLIC_BUSINESS_ID)
      ) as any[];
      employees = (employees || []).filter((e) => e.status === "active");
      if (employeeId) {
        const chosen = employees.find((e) => e.id === employeeId);
        if (!chosen) return res.status(400).json({ error: "Employé introuvable." });
        employees = [chosen];
      }
      if (employees.length === 0) return res.status(400).json({ error: "Aucun employé disponible." });

      // Chevauchement sur le bloc complet [startTime, endTime).
      const dayStartFilter = new Date(wallClockMs(date, "00:00")).toISOString();
      const dayEndFilter = new Date(wallClockMs(date, "23:59")).toISOString();
      const appts = unwrap(
        await supabase
          .from("appointments")
          .select("employee_id, start_time, end_time, status")
          .eq("business_id", PUBLIC_BUSINESS_ID)
          .gte("start_time", dayStartFilter)
          .lte("start_time", dayEndFilter)
      ) as any[];
      const busyByEmployee = new Map<number, { start: number; end: number }[]>();
      for (const a of appts || []) {
        if (a.status === "cancelled" || a.employee_id == null) continue;
        const list = busyByEmployee.get(a.employee_id) || [];
        list.push({ start: new Date(a.start_time + "Z").getTime(), end: new Date(a.end_time + "Z").getTime() });
        busyByEmployee.set(a.employee_id, list);
      }
      const blockStart = startTimeMs;
      const blockEnd = endTimeMs;
      const assignedEmployee = employees.find((e) => {
        const busy = busyByEmployee.get(e.id) || [];
        return busy.every((b) => blockEnd <= b.start || blockStart >= b.end);
      });
      if (!assignedEmployee) {
        return res.status(409).json({ error: "Ce créneau vient d'être pris. Merci de choisir un autre horaire." });
      }

      // Résolution du client : réutilise la fiche existante si le téléphone correspond
      // déjà à un client du salon, sinon crée une nouvelle fiche (carte de fidélité
      // attribuée automatiquement, comme pour toute nouvelle cliente en caisse).
      const phoneDigits = normalizePhoneDigits(phone);
      const existingCustomers = unwrap(
        await supabase.from("customers").select("id, phone, created_at").eq("business_id", PUBLIC_BUSINESS_ID)
      ) as any[];
      const match = (existingCustomers || []).find((c) => normalizePhoneDigits(c.phone || "") === phoneDigits);

      // Anti-spam base de données : bloque les rafales de demandes pour un même numéro,
      // même si l'attaquant change d'IP ou d'instance serverless.
      const recentCutoff = Date.now() - 30 * 60000;
      if (match) {
        const recentPending = unwrap(
          await supabase
            .from("appointments")
            .select("id, created_at, status")
            .eq("business_id", PUBLIC_BUSINESS_ID)
            .eq("customer_id", match.id)
            .eq("status", "pending")
        ) as any[];
        const tooMany = (recentPending || []).filter((a) => new Date(a.created_at).getTime() > recentCutoff).length >= 3;
        if (tooMany) {
          return res.status(429).json({ error: "Vous avez déjà plusieurs demandes en attente. Le salon va vous contacter — merci de patienter." });
        }
      }

      let customerId: string;
      if (match) {
        customerId = match.id;
      } else {
        customerId = "CARD-" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
        const cardNumber = await generateCardNumber(PUBLIC_BUSINESS_ID);
        const code = await generateCustomerCode(PUBLIC_BUSINESS_ID);
        unwrap(
          await supabase
            .from("customers")
            .insert({ id: customerId, business_id: PUBLIC_BUSINESS_ID, name, phone, card_number: cardNumber, code })
            .select()
            .single()
        );
      }

      // Un créneau bloqué par prestation, à la suite, même employé/client — le statut
      // "pending" (nouveau, additif) signale au salon qu'il doit confirmer depuis l'Agenda.
      let cursor = startTimeMs;
      const created: any[] = [];
      for (const svc of orderedServices) {
        const svcDuration = (svc.duration || DEFAULT_DURATION_MINUTES) * 60000;
        const row = unwrap(
          await supabase
            .from("appointments")
            .insert({
              business_id: PUBLIC_BUSINESS_ID,
              customer_id: customerId,
              employee_id: assignedEmployee.id,
              service_id: svc.id,
              start_time: new Date(cursor).toISOString(),
              end_time: new Date(cursor + svcDuration).toISOString(),
              status: "pending",
            })
            .select()
            .single()
        );
        created.push(row);
        cursor += svcDuration;
      }

      if (notes) {
        // Pas de colonne dédiée aux notes sur appointments : journalisée côté serveur
        // uniquement pour l'instant (le salon rappelle de toute façon la cliente).
        console.log(`[public-booking] note pour rdv ${created[0]?.id}: ${notes}`);
      }

      res.json({
        success: true,
        summary: {
          date,
          time,
          endTime: wallClockMsToTime(cursor),
          services: orderedServices.map((s) => s.name),
          employeeName: assignedEmployee.name,
        },
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
