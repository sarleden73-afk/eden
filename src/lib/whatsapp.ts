import { supabase } from "./supabase-server.js";
import { toSnakeCase } from "./caseConvert.js";

// Notifications WhatsApp (Meta WhatsApp Business Cloud API). Désactivé tant que
// WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN ne sont pas renseignés — ce
// fichier peut donc être déployé avant que les vraies clés Meta n'existent.
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const ENABLED = !!(PHONE_NUMBER_ID && ACCESS_TOKEN);

export type WhatsappTemplate = "reward_unlocked" | "tier_reached" | "welcome_new_client" | "inactive_reminder";

// Les numéros sont stockés en format local (9 chiffres, avec ou sans le 0 initial) ;
// l'API WhatsApp exige l'E.164 (+242...). Indicatif Congo-Brazzaville en dur pour
// l'instant (application mono-tenant, un seul pays concerné — confirmé par le numéro
// WhatsApp du salon lui-même : +242 069570399).
function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("242") && digits.length === 12) return digits;
  if (digits.length === 9) return "242" + digits;
  if (digits.startsWith("0") && digits.length === 10) return "242" + digits.slice(1);
  return null;
}

interface SendResult { ok: boolean; messageId: string | null; error: string | null }

async function sendTemplate(toRaw: string, template: WhatsappTemplate, params: string[]): Promise<SendResult> {
  const to = normalizePhone(toRaw);
  if (!to) return { ok: false, messageId: null, error: "Numéro de téléphone non exploitable pour WhatsApp." };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: "fr" },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
        },
      }),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, messageId: null, error: json?.error?.message || `HTTP ${res.status}` };
    return { ok: true, messageId: json?.messages?.[0]?.id || "", error: null };
  } catch (e) {
    return { ok: false, messageId: null, error: (e as Error).message };
  }
}

// Envoie une notification WhatsApp au plus une fois par (client, type, référence).
// L'insert dans whatsapp_notifications sert de verrou anti-doublon : si un autre
// appel a déjà réservé cette référence (contrainte unique), on ne renvoie rien.
// Best-effort : ne lève jamais — un échec d'envoi ne doit jamais casser une vente
// ou une création de client (même pattern que l'écriture comptable automatique).
export async function notifyOnce(opts: {
  businessId: number;
  customerId: string;
  phone: string;
  type: WhatsappTemplate;
  referenceId: string;
  params: string[];
}): Promise<void> {
  if (!ENABLED) return;
  try {
    const { data: row, error } = await supabase
      .from("whatsapp_notifications")
      .insert(
        toSnakeCase({
          businessId: opts.businessId,
          customerId: opts.customerId,
          type: opts.type,
          referenceId: opts.referenceId,
          templateName: opts.type,
          payload: opts.params,
          status: "pending",
        })
      )
      .select()
      .single();
    if (error || !row) return; // déjà tenté pour cette référence (contrainte unique) ou erreur — on n'insiste pas
    const result = await sendTemplate(opts.phone, opts.type, opts.params);
    const update = {
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.messageId,
      error: result.error,
    };
    await supabase.from("whatsapp_notifications").update(toSnakeCase(update)).eq("id", (row as any).id);
  } catch (e) {
    console.error("Notification WhatsApp échouée:", (e as Error).message);
  }
}
