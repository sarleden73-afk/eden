// §5.12 « Prévoir idéalement l'exportation en PDF et Excel ».
//
// Excel  : export CSV, ouvert nativement par Excel et LibreOffice. Choisi plutôt
//          qu'un vrai .xlsx pour ne pas embarquer une bibliothèque de plusieurs
//          centaines de kilo-octets dans une app utilisée sur tablette en
//          connexion limitée. Le séparateur est le point-virgule et le fichier
//          porte un BOM UTF-8, sans quoi Excel en français casse les accents et
//          empile tout dans une seule colonne.
// PDF    : impression navigateur (Ctrl+P > Enregistrer en PDF). Les feuilles de
//          style @media print masquent la navigation et les boutons.

/** Échappe une cellule pour le format CSV (RFC 4180, séparateur `;`). */
function cellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "";
  const texte = String(valeur);
  if (/[";\n\r]/.test(texte)) return `"${texte.replace(/"/g, '""')}"`;
  return texte;
}

/**
 * Déclenche le téléchargement d'un tableau au format CSV.
 * @param nomFichier sans extension
 * @param entetes    libellés de la première ligne
 * @param lignes     valeurs, dans le même ordre que les entêtes
 */
export function exporterCSV(nomFichier: string, entetes: string[], lignes: unknown[][]) {
  const contenu = [entetes, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n");

  // ﻿ : BOM UTF-8 requis par Excel pour reconnaître l'encodage.
  const blob = new Blob(["﻿" + contenu], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `${nomFichier}-${horodatage()}.csv`;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);

  // Libère la mémoire une fois le téléchargement lancé.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ouvre la boîte d'impression du navigateur (« Enregistrer au format PDF »). */
export function exporterPDF() {
  window.print();
}

function horodatage(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
