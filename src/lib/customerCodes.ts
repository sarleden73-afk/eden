import { supabase } from "./supabase-server.js";

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// Génère un numéro de carte court et lisible (ex: "D4451"), unique dans l'entreprise.
// Partagé entre les routes authentifiées (src/api.ts) et publiques (src/publicApi.ts).
export async function generateCardNumber(businessId: number): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const letter = "ABCDEFGHJKLMNPRSTUVWXYZ"[Math.floor(Math.random() * 22)];
    const candidate = letter + Math.floor(1000 + Math.random() * 9000);
    const clash = unwrap(await supabase.from("customers").select("id").eq("business_id", businessId).eq("card_number", candidate).limit(1));
    if (!clash || clash.length === 0) return candidate;
  }
  return "C" + Date.now().toString().slice(-5);
}

// Code client séquentiel unique CL-0001, CL-0002... (jamais réutilisé/dupliqué).
export async function generateCustomerCode(businessId: number): Promise<string> {
  const countRows = unwrap(await supabase.from("customers").select("id").eq("business_id", businessId));
  for (let n = (countRows?.length || 0) + 1; ; n++) {
    const candidate = "CL-" + String(n).padStart(4, "0");
    const clash = unwrap(await supabase.from("customers").select("id").eq("business_id", businessId).eq("code", candidate).limit(1));
    if (!clash || clash.length === 0) return candidate;
  }
}
