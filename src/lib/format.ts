// Formatage partagé par toute l'interface. Centralisé pour que les montants,
// dates et quantités s'affichent partout de la même façon — un rapport et un
// ticket de caisse qui écrivent le même chiffre différemment sèment le doute.

/** Montant en francs CFA : pas de décimale, espace insécable fine comme séparateur. */
export function fcfa(montant: number | null | undefined): string {
  const valeur = Number(montant ?? 0);
  return `${valeur.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
}

/** Variante compacte pour les tableaux denses, sans le suffixe de devise. */
export function nombre(valeur: number | null | undefined): string {
  return Number(valeur ?? 0).toLocaleString("fr-FR").replace(/ | /g, " ");
}

/** Quantité : entière si elle l'est, sinon jusqu'à 3 décimales. */
export function quantite(valeur: number | null | undefined): string {
  const n = Number(valeur ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function dateHeure(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function heure(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Date du jour au format attendu par <input type="date">. */
export function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
