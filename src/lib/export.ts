// §5.12 « Prévoir l'exportation en PDF ».
//
// jsPDF est chargé dynamiquement : il pèse plusieurs centaines de kilo-octets
// et ne sert qu'au moment où l'on clique sur Exporter. L'app tourne beaucoup
// sur tablette en connexion limitée — pas question de le télécharger à chaque
// ouverture d'écran.

import { fcfa } from "./format";

export interface SectionPdf {
  titre?: string;
  entetes: string[];
  lignes: (string | number)[][];
  /** Index des colonnes à aligner à droite (montants, quantités). */
  colonnesChiffrees?: number[];
}

export interface OptionsPdf {
  /** Nom du fichier, sans extension. */
  fichier: string;
  titre: string;
  sousTitre?: string;
  /** Établissement ou périmètre concerné, imprimé en tête. */
  perimetre?: string;
  sections: SectionPdf[];
  /** Lignes clés mises en avant avant les tableaux. */
  synthese?: { libelle: string; valeur: string }[];
  /** Portrait par défaut ; paysage pour les tableaux très larges. */
  paysage?: boolean;
}

const VERT = [31, 160, 102] as const;
const GRIS_FONCE = [42, 39, 36] as const;
const GRIS_CLAIR = [244, 243, 241] as const;

/**
 * Génère et télécharge un PDF.
 *
 * Le document tient sur une seule page tant que le contenu le permet : la
 * taille de police et l'interligne se resserrent progressivement selon le
 * nombre de lignes, plutôt que de déborder sur une deuxième page à moitié
 * vide. Au-delà, autoTable pagine proprement en répétant les entêtes.
 */
export async function exporterPDF(options: OptionsPdf): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({
    orientation: options.paysage ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });

  const largeur = doc.internal.pageSize.getWidth();
  const marge = 12;

  // --- Entête ---
  doc.setFillColor(...GRIS_FONCE);
  doc.rect(0, 0, largeur, 22, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(options.titre, marge, 10);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 195);
  const ligneContexte = [options.perimetre, options.sousTitre].filter(Boolean).join("  ·  ");
  if (ligneContexte) doc.text(ligneContexte, marge, 16);

  doc.setFontSize(7.5);
  doc.text(
    `Édité le ${new Date().toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    })}`,
    largeur - marge, 16, { align: "right" }
  );

  let y = 28;

  // --- Synthèse en bandeaux ---
  if (options.synthese?.length) {
    const nb = options.synthese.length;
    const largeurCase = (largeur - marge * 2 - (nb - 1) * 3) / nb;
    options.synthese.forEach((s, i) => {
      const x = marge + i * (largeurCase + 3);
      doc.setFillColor(...GRIS_CLAIR);
      doc.roundedRect(x, y, largeurCase, 15, 1.5, 1.5, "F");
      doc.setTextColor(110, 105, 98);
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.text(s.libelle.toUpperCase(), x + 3, y + 5.5);
      doc.setTextColor(...GRIS_FONCE);
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      doc.text(s.valeur, x + 3, y + 11.5);
    });
    y += 21;
  }

  // Densité choisie d'après le volume total : l'objectif est une page.
  const totalLignes = options.sections.reduce((s, x) => s + x.lignes.length + 2, 0);
  const dense = totalLignes > 45;
  const tresDense = totalLignes > 75;
  const police = tresDense ? 6 : dense ? 6.8 : 7.6;
  const padding = tresDense ? 0.9 : dense ? 1.3 : 1.8;

  for (const section of options.sections) {
    if (section.titre) {
      doc.setTextColor(...VERT);
      doc.setFontSize(dense ? 8 : 9);
      doc.setFont("helvetica", "bold");
      doc.text(section.titre, marge, y);
      y += dense ? 3.5 : 4.5;
    }

    const alignements: Record<number, { halign: "right" }> = {};
    for (const i of section.colonnesChiffrees ?? []) alignements[i] = { halign: "right" };

    autoTable(doc, {
      startY: y,
      head: [section.entetes],
      body: section.lignes.map((l) => l.map((c) => (c === null || c === undefined ? "" : String(c)))),
      margin: { left: marge, right: marge },
      styles: {
        font: "helvetica",
        fontSize: police,
        cellPadding: padding,
        lineColor: [230, 228, 224],
        lineWidth: 0.1,
        textColor: [42, 39, 36],
      },
      headStyles: {
        fillColor: [...GRIS_CLAIR],
        textColor: [90, 86, 80],
        fontStyle: "bold",
        fontSize: police,
      },
      alternateRowStyles: { fillColor: [251, 250, 249] },
      columnStyles: alignements,
      theme: "grid",
    });

    // @ts-expect-error — autoTable expose sa position finale sur le document.
    y = (doc.lastAutoTable?.finalY ?? y) + (dense ? 5 : 7);
  }

  // --- Pied de page ---
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(6.5);
    doc.setTextColor(150, 146, 140);
    doc.text(
      pages > 1 ? `Page ${p} / ${pages}` : "Document généré automatiquement",
      largeur - marge,
      doc.internal.pageSize.getHeight() - 6,
      { align: "right" }
    );
  }

  doc.save(`${options.fichier}-${horodatage()}.pdf`);
}

/** Titres par défaut, dérivés du nom de fichier. */
const TITRES: Record<string, string> = {
  "ventes-eden": "Journal des ventes",
  "stocks-eden": "État des stocks",
  "depenses-eden": "Journal des dépenses",
  "achats-eden": "Journal des achats",
  "commandes-eden": "Commandes en cours",
  "catalogue-eden": "Catalogue des articles",
  "personnel-eden": "Personnel",
  "journal-eden": "Journal des opérations",
};

/**
 * Export d'une liste simple.
 *
 * Signature volontairement identique à l'ancien export CSV : les écrans n'ont
 * eu qu'à changer le nom de la fonction, sans que la forme de leurs données
 * bouge. Les colonnes chiffrées sont détectées automatiquement à partir du
 * contenu, ce qui évite d'énumérer des index dans chaque appel.
 */
export function exporterListePDF(
  fichier: string,
  entetes: string[],
  lignes: (string | number)[][],
  options: { titre?: string; perimetre?: string; sousTitre?: string; paysage?: boolean } = {}
): Promise<void> {
  // Une colonne est « chiffrée » si toutes ses valeurs non vides sont des
  // nombres : elle est alors alignée à droite, comme dans les tableaux à
  // l'écran.
  const colonnesChiffrees: number[] = [];
  for (let c = 0; c < entetes.length; c++) {
    const valeurs = lignes.map((l) => l[c]).filter((v) => v !== "" && v !== null && v !== undefined);
    if (valeurs.length && valeurs.every((v) => typeof v === "number")) colonnesChiffrees.push(c);
  }

  return exporterPDF({
    fichier,
    titre: options.titre ?? TITRES[fichier] ?? fichier,
    sousTitre: options.sousTitre,
    perimetre: options.perimetre,
    // Au-delà de six colonnes, le portrait comprime trop les libellés.
    paysage: options.paysage ?? entetes.length > 6,
    sections: [{ entetes, lignes, colonnesChiffrees }],
  });
}

/** Raccourci pour un export à une seule table. */
export function exporterTablePDF(
  fichier: string,
  titre: string,
  entetes: string[],
  lignes: (string | number)[][],
  options: { perimetre?: string; sousTitre?: string; colonnesChiffrees?: number[]; paysage?: boolean } = {}
): Promise<void> {
  return exporterPDF({
    fichier,
    titre,
    sousTitre: options.sousTitre,
    perimetre: options.perimetre,
    paysage: options.paysage,
    sections: [{ entetes, lignes, colonnesChiffrees: options.colonnesChiffrees }],
  });
}

/** Formate un montant pour un tableau PDF (sans espace insécable). */
export const montantPdf = (v: number) => fcfa(v).replace(/ /g, " ");

function horodatage(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------
// Le PDF sert à imprimer et à transmettre ; le CSV sert à recalculer. Un
// comptable qui reçoit un PDF ressaisit les chiffres à la main, avec les
// erreurs que cela suppose. Les deux formats partent donc des mêmes données au
// même moment : ils ne peuvent pas raconter deux histoires différentes.

/**
 * Une cellule CSV.
 *
 * Point-virgule plutôt que virgule, et marque d'ordre des octets en tête :
 * c'est ce qu'attend Excel en configuration française. Avec une virgule, il
 * range toute la ligne dans une seule colonne ; sans la marque, il lit l'UTF-8
 * comme du latin-1 et « Dépenses » devient « DÃ©penses ».
 */
function cellule(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined) return "";

  // Les nombres partent bruts, avec la virgule décimale française : c'est ce
  // qui les rend calculables à l'arrivée. Un montant déjà formaté en
  // « 12 500 FCFA » serait du texte, et aucune somme ne fonctionnerait dessus.
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) ? String(valeur).replace(".", ",") : "";
  }

  const texte = String(valeur);
  // Guillemets, point-virgule et sauts de ligne cassent le découpage : la
  // cellule est alors encadrée de guillemets, ceux qu'elle contient doublés.
  return /[";\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

const ligneCsv = (cellules: (string | number | null | undefined)[]) =>
  cellules.map(cellule).join(";");

function telechargerCsv(fichier: string, contenu: string) {
  const blob = new Blob([`﻿${contenu}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `${fichier}-${horodatage()}.csv`;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

/** Export CSV d'une liste simple — pendant exact de `exporterListePDF`. */
export function exporterListeCSV(
  fichier: string,
  entetes: string[],
  lignes: (string | number)[][],
  // `paysage` n'a pas de sens ici mais reste accepté : les deux exports sont
  // appelés avec le même objet d'options, et le refuser obligerait chaque
  // écran à en construire deux.
  options: { titre?: string; perimetre?: string; sousTitre?: string; paysage?: boolean } = {}
): void {
  const tete = [ligneCsv([options.titre ?? TITRES[fichier] ?? fichier])];
  if (options.perimetre) tete.push(ligneCsv([options.perimetre]));
  if (options.sousTitre) tete.push(ligneCsv([options.sousTitre]));

  telechargerCsv(fichier, [
    ...tete, "", ligneCsv(entetes), ...lignes.map(ligneCsv),
  ].join("\r\n"));
}

/**
 * Export CSV d'un document à plusieurs tableaux — pendant de `exporterPDF`.
 *
 * Les sections sont empilées, séparées par une ligne vide et leur titre. Un
 * fichier par section serait plus propre pour un tableur, mais obligerait à
 * en ouvrir quatre pour lire un seul compte de résultat.
 */
export function exporterCSV(options: OptionsPdf): void {
  const lignes = [ligneCsv([options.titre])];
  if (options.perimetre) lignes.push(ligneCsv([options.perimetre]));
  if (options.sousTitre) lignes.push(ligneCsv([options.sousTitre]));

  if (options.synthese?.length) {
    lignes.push("", ligneCsv(["Synthèse"]));
    for (const s of options.synthese) lignes.push(ligneCsv([s.libelle, s.valeur]));
  }

  for (const section of options.sections) {
    lignes.push("");
    if (section.titre) lignes.push(ligneCsv([section.titre]));
    lignes.push(ligneCsv(section.entetes));
    for (const l of section.lignes) lignes.push(ligneCsv(l));
  }

  telechargerCsv(options.fichier, lignes.join("\r\n"));
}
