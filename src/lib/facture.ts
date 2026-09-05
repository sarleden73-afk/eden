// ============================================================================
// Facture de vente et bon de commande.
//
// Le ticket de caisse suffit au comptoir ; il ne suffit pas à un client qui
// doit justifier une dépense, ni à une commande qu'on vient retirer trois
// semaines plus tard. Ces deux documents reprennent la maquette de
// l'entreprise : logo, raison sociale soulignée d'or, nature du document,
// numéro, dates, puis les coordonnées en pied de page.
//
// Un seul générateur pour les deux : ils ne diffèrent que par leur titre, leur
// bloc de dates et ce qui suit le total. Les faire diverger en deux fichiers,
// c'est se réveiller un jour avec deux mises en page qui ne se ressemblent
// plus.
// ============================================================================

import { fcfa, dateCourte } from "./format";

/** Or de la charte, repris du liseré et du pied de page. */
const OR = [212, 160, 23] as const;
const ENCRE = [17, 17, 17] as const;
const GRIS = [110, 110, 110] as const;
const GRIS_CLAIR = [243, 243, 243] as const;

export interface LigneDocument {
  libelle: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

export interface Entreprise {
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  niu?: string;
  logoUrl?: string;
}

export interface DocumentCommercial {
  /** « FACTURE » ou « BON DE COMMANDE ». */
  nature: "facture" | "commande";
  numero: string;
  entreprise: Entreprise;
  etablissement: string;
  /** Date de l'opération : vente encaissée, ou commande prise. */
  dateOperation: string;
  /** Date d'émission du document, souvent la même. */
  dateEmission?: string;
  client?: { nom?: string; telephone?: string | null };
  lignes: LigneDocument[];
  remise?: number;
  /** Commande : ce qui a déjà été versé. */
  acompte?: number;
  moyenPaiement?: string;
  /** Commande : date de retrait prévue. */
  dateLivraison?: string | null;
  /** Commande : nombre de jours avant expiration de la garde. */
  joursDeGarde?: number;
  vendeur?: string | null;
  /** Mention libre imprimée sous le total. */
  note?: string;
}

/**
 * Dessine et télécharge le document.
 *
 * jsPDF est importé à l'appel : il pèse plusieurs centaines de kilo-octets et
 * l'application tourne sur tablette en connexion limitée. Le charger à
 * l'ouverture de l'écran de vente serait le payer à chaque fois pour un
 * document qu'on n'imprime pas toujours.
 */
export async function genererDocument(doc_: DocumentCommercial): Promise<void> {
  const pdf = await composerDocument(doc_);
  pdf.save(`${doc_.nature === "commande" ? "bon-de-commande" : "facture"}-${doc_.numero}.pdf`);
}

/**
 * Compose le document sans le télécharger.
 *
 * Séparé de `genererDocument` pour que la mise en page puisse être produite
 * hors navigateur : c'est ce qui permet de relire une facture réelle sans
 * ouvrir l'application, et de vérifier que rien ne déborde.
 */
export async function composerDocument(
  doc_: DocumentCommercial
): Promise<import("jspdf").jsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const L = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const MARGE = 14;

  const estCommande = doc_.nature === "commande";
  const titre = estCommande ? "BON DE COMMANDE" : "FACTURE";

  // --- Logo -----------------------------------------------------------------
  // Le format est déduit du préfixe de la donnée : un PNG détouré garde sa
  // transparence, un JPEG non. Un logo illisible ne doit pas empêcher
  // d'imprimer la facture, d'où le filet de sécurité.
  let xTitre = MARGE;
  if (doc_.entreprise.logoUrl) {
    try {
      const format = doc_.entreprise.logoUrl.includes("image/png") ? "PNG" : "JPEG";
      pdf.addImage(doc_.entreprise.logoUrl, format, MARGE, 10, 34, 34);
      xTitre = MARGE + 40;
    } catch {
      /* logo inexploitable : le document reste correct sans lui */
    }
  }

  // --- Raison sociale et liseré --------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...ENCRE);
  const largeurDispo = L - xTitre - MARGE;
  pdf.setFontSize(ajusterPolice(pdf, doc_.entreprise.nom, largeurDispo, 21, 13));
  pdf.text(doc_.entreprise.nom.toUpperCase(), xTitre, 26);

  pdf.setFillColor(...OR);
  pdf.rect(xTitre + 4, 31, Math.min(largeurDispo - 8, 118), 2.2, "F");

  // --- Nature et numéro ----------------------------------------------------
  pdf.setFontSize(17);
  pdf.text(titre, L / 2, 44, { align: "center" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(`N° ${estCommande ? "COMMANDE" : "FACTURE"} : ${doc_.numero}`, L / 2, 51, {
    align: "center",
  });

  // --- Dates, à gauche ------------------------------------------------------
  pdf.setFontSize(8);
  pdf.setTextColor(...ENCRE);
  let y = 62;
  const ligneInfo = (etiquette: string, valeur: string) => {
    pdf.text(`${etiquette} : ${valeur}`, MARGE, y);
    y += 4.4;
  };

  ligneInfo(
    estCommande ? "DATE DE LA COMMANDE" : "DATE DE LA VENTE",
    dateCourte(doc_.dateOperation)
  );
  ligneInfo(
    estCommande ? "DATE DU BON" : "DATE DE LA FACTURE",
    dateCourte(doc_.dateEmission ?? doc_.dateOperation)
  );
  if (estCommande && doc_.dateLivraison) {
    ligneInfo("RETRAIT PRÉVU LE", dateCourte(doc_.dateLivraison));
  }
  ligneInfo("ÉTABLISSEMENT", doc_.etablissement);
  if (doc_.entreprise.niu) ligneInfo("NIU", doc_.entreprise.niu);

  // --- Client, à droite -----------------------------------------------------
  if (doc_.client?.nom) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("CLIENT", L - MARGE, 62, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.text(doc_.client.nom, L - MARGE, 67.5, { align: "right" });
    if (doc_.client.telephone) {
      pdf.setFontSize(8);
      pdf.setTextColor(...GRIS);
      pdf.text(doc_.client.telephone, L - MARGE, 72.5, { align: "right" });
      pdf.setTextColor(...ENCRE);
    }
  }

  // --- Lignes ---------------------------------------------------------------
  autoTable(pdf, {
    startY: Math.max(y + 6, 84),
    margin: { left: MARGE, right: MARGE },
    head: [["DÉSIGNATION", "QTÉ", "PRIX UNITAIRE", "MONTANT"]],
    body: doc_.lignes.map((l) => [
      l.libelle,
      formaterQuantite(l.quantite),
      montant(l.prixUnitaire),
      montant(l.montant),
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2.6, lineColor: [225, 225, 225] },
    headStyles: {
      fillColor: [...ENCRE] as [number, number, number],
      textColor: 255, fontStyle: "bold", fontSize: 8.5, halign: "left",
    },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 18, halign: "right" },
      2: { cellWidth: 34, halign: "right" },
      3: { cellWidth: 36, halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: [...GRIS_CLAIR] as [number, number, number] },
  });

  // --- Totaux ---------------------------------------------------------------
  const sousTotal = doc_.lignes.reduce((s, l) => s + l.montant, 0);
  const remise = doc_.remise ?? 0;
  const total = sousTotal - remise;
  const acompte = doc_.acompte ?? 0;
  const reste = total - acompte;

  // @ts-expect-error autoTable pose lastAutoTable sur le document.
  let yTot = (pdf.lastAutoTable?.finalY ?? 120) + 8;
  const xEtiq = L - MARGE - 76;
  const xVal = L - MARGE;

  const totalLigne = (
    etiquette: string, valeur: string, gras = false,
    couleur: readonly [number, number, number] = ENCRE
  ) => {
    pdf.setFont("helvetica", gras ? "bold" : "normal");
    pdf.setFontSize(gras ? 11 : 9.5);
    pdf.setTextColor(...couleur);
    pdf.text(etiquette, xEtiq, yTot);
    pdf.text(valeur, xVal, yTot, { align: "right" });
    yTot += gras ? 7 : 5.4;
  };

  if (remise > 0) {
    totalLigne("Sous-total", montant(sousTotal));
    totalLigne("Remise", `− ${montant(remise)}`);
  }

  // Trait d'or au-dessus du total : c'est le chiffre qu'on cherche des yeux.
  pdf.setDrawColor(...OR);
  pdf.setLineWidth(0.7);
  pdf.line(xEtiq, yTot - 3.5, xVal, yTot - 3.5);
  totalLigne("TOTAL", montant(total), true);

  if (estCommande || acompte > 0) {
    totalLigne("Acompte versé", montant(acompte));
    totalLigne("RESTE À PAYER", montant(reste), true, reste > 0 ? [155, 40, 40] : ENCRE);
  }

  if (doc_.moyenPaiement) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...GRIS);
    pdf.text(`Réglé par ${doc_.moyenPaiement.toLowerCase()}`, xEtiq, yTot);
    yTot += 5;
  }

  // --- Conditions de retrait (bon de commande) ------------------------------
  if (estCommande && doc_.joursDeGarde) {
    pdf.setFillColor(...GRIS_CLAIR);
    pdf.setDrawColor(...OR);
    pdf.setLineWidth(0.4);
    const yCadre = Math.max(yTot + 4, 200);
    pdf.rect(MARGE, yCadre, L - MARGE * 2, 20, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...ENCRE);
    pdf.text("CONDITIONS DE RETRAIT", MARGE + 4, yCadre + 6);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...GRIS);
    const conditions = pdf.splitTextToSize(
      `La commande est gardée ${doc_.joursDeGarde} jours à compter de la date de retrait prévue. `
      + `Passé ce délai, l'établissement ne peut plus en garantir la conservation et aucune `
      + `réclamation n'est recevable. L'acompte versé reste acquis.`,
      L - MARGE * 2 - 8
    );
    pdf.text(conditions, MARGE + 4, yCadre + 11);
    yTot = yCadre + 26;
  }

  if (doc_.note) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GRIS);
    pdf.text(pdf.splitTextToSize(doc_.note, L - MARGE * 2), MARGE, yTot + 2);
  }

  // --- Pied de page ---------------------------------------------------------
  piedDePage(pdf, doc_, L, H, MARGE);

  return pdf;
}

// ---------------------------------------------------------------------------

function piedDePage(
  pdf: import("jspdf").jsPDF,
  doc_: DocumentCommercial,
  L: number,
  H: number,
  MARGE: number
) {
  const e = doc_.entreprise;
  let y = H - 30;

  pdf.setDrawColor(...OR);
  pdf.setLineWidth(1.4);
  pdf.line(L / 2 - 30, y - 6, L / 2 + 30, y - 6);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...ENCRE);

  if (e.telephone) { pdf.text(e.telephone, L / 2, y, { align: "center" }); y += 5; }
  if (e.email) { pdf.text(e.email, L / 2, y, { align: "center" }); y += 5; }

  if (e.adresse) {
    pdf.setTextColor(...OR);
    pdf.setFontSize(8.5);
    // L'adresse peut tenir sur deux lignes dans la charte : on respecte les
    // retours saisis plutôt que de tout aplatir sur une ligne illisible.
    for (const ligne of e.adresse.split("\n").slice(0, 2)) {
      pdf.text(ligne.toUpperCase(), L / 2, y, { align: "center" });
      y += 4.5;
    }
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(...GRIS);
  pdf.text(
    doc_.vendeur ? `Établi par ${doc_.vendeur}` : "",
    MARGE, H - 8
  );
  pdf.text(`Édité le ${dateCourte(new Date().toISOString())}`, L - MARGE, H - 8, { align: "right" });
}

/** Réduit la police jusqu'à ce que le texte tienne dans la largeur donnée. */
function ajusterPolice(
  pdf: import("jspdf").jsPDF, texte: string, largeur: number, max: number, min: number
): number {
  for (let taille = max; taille > min; taille -= 0.5) {
    pdf.setFontSize(taille);
    if (pdf.getTextWidth(texte.toUpperCase()) <= largeur) return taille;
  }
  return min;
}

/** Montant sans espace insécable : jsPDF ne sait pas la rendre. */
const montant = (v: number) => fcfa(v).replace(/ | /g, " ");

/**
 * Coordonnées de l'entreprise pour l'en-tête et le pied des documents.
 *
 * Lues au moment d'imprimer plutôt que gardées en mémoire : elles changent
 * rarement, mais quand elles changent — un numéro de téléphone, une adresse —
 * on ne veut pas qu'une facture parte avec l'ancien.
 */
export async function entrepriseCourante(): Promise<Entreprise> {
  const { getParametres } = await import("../services/db");
  const p = await getParametres().catch(() => ({} as Record<string, never>));
  const e = p.entreprise;
  return {
    nom: e?.nom || "EDEN MULTI-SERVICES",
    adresse: e?.adresse || "",
    telephone: e?.telephone || "",
    email: e?.email || "",
    niu: e?.niu || "",
    logoUrl: e?.logoUrl || "",
  };
}

const formaterQuantite = (q: number) =>
  Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
