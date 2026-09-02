// ============================================================================
// Reconnaissance faciale, entièrement dans le navigateur.
//
// Rien ne sort de l'appareil pendant l'analyse : l'image de la caméra est
// traitée sur place, et seule l'empreinte — un vecteur de 128 nombres — est
// comparée. C'est ce qui rend le pointage utilisable sans connexion stable une
// fois les modèles en cache.
//
// Les modèles sont servis depuis /models, jamais depuis un CDN : au comptoir,
// un pointage qui dépend d'un service tiers est un pointage qui tombe en panne
// le jour où ce service tombe.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

let faceapi: any = null;
let chargement: Promise<any> | null = null;

const DOSSIER_MODELES = "/models";

/**
 * Seuil de décision. face-api mesure une distance entre deux empreintes :
 * 0 = identique, 1 = sans rapport. 0,55 est un cran plus strict que le 0,6
 * usuel — au pointage, accepter la mauvaise personne coûte plus cher que
 * demander une seconde photo.
 */
export const SEUIL_RECONNAISSANCE = 0.55;

/** Nombre d'échecs avant de proposer le repli par code. */
export const ESSAIS_AVANT_REPLI = 3;

/**
 * Charge les modèles une seule fois par session.
 *
 * Seuls trois réseaux sont chargés — détecteur léger, points du visage,
 * empreinte — soit environ 7 Mo au lieu de 12 : le détecteur lourd
 * (SSD MobileNet) apporte peu sur une photo cadrée volontairement face à la
 * caméra, et doublerait le téléchargement initial sur tablette.
 */
export async function chargerModeles(): Promise<any> {
  if (!faceapi) faceapi = await import("@vladmandic/face-api");
  if (!chargement) {
    chargement = (async () => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(DOSSIER_MODELES),
        faceapi.nets.faceLandmark68Net.loadFromUri(DOSSIER_MODELES),
        faceapi.nets.faceRecognitionNet.loadFromUri(DOSSIER_MODELES),
      ]);
      return faceapi;
    })().catch((e) => {
      // Remis à zéro pour qu'une coupure réseau n'interdise pas de réessayer.
      chargement = null;
      throw e;
    });
  }
  return chargement;
}

/** Les modèles sont-ils déjà en mémoire ? Sert à afficher un état d'attente. */
export const modelesCharges = () => chargement !== null && faceapi !== null;

type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

/**
 * Calcule l'empreinte d'un visage présent dans l'image.
 *
 * Deux passes : une rapide en 320 px, puis une plus fine en 608 px si rien
 * n'a été trouvé. Un visage mal éclairé passe souvent la seconde, et cela
 * évite d'imposer d'emblée le coût de la haute résolution à chaque tentative.
 */
export async function empreinteDepuis(source: Source): Promise<Float32Array | null> {
  const fa = await chargerModeles();

  for (const taille of [320, 608]) {
    const detection = await fa
      .detectSingleFace(source, new fa.TinyFaceDetectorOptions({
        inputSize: taille,
        scoreThreshold: taille === 320 ? 0.5 : 0.3,
      }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) return detection.descriptor as Float32Array;
  }
  return null;
}

/** Empreinte à partir d'une image encodée (data URI ou URL). */
export async function empreinteDepuisImage(url: string): Promise<Float32Array | null> {
  const fa = await chargerModeles();
  const image = await fa.fetchImage(url);
  return empreinteDepuis(image);
}

/** Distance entre deux empreintes : 0 = identique, 1 = sans rapport. */
export function distance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let somme = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    somme += d * d;
  }
  return Math.sqrt(somme);
}

export interface CandidatVisage {
  id: string;
  nom: string;
  empreinte: number[];
}

export interface Reconnaissance {
  candidat: CandidatVisage | null;
  distance: number;
  reconnu: boolean;
}

/**
 * Cherche à qui appartient un visage parmi les empreintes fournies.
 *
 * Renvoie toujours le meilleur candidat et sa distance, même sous le seuil :
 * l'écran peut ainsi dire « je vous vois mal » plutôt que « inconnu », ce qui
 * n'est pas la même information pour quelqu'un qui attend d'ouvrir sa caisse.
 */
export function reconnaitre(
  empreinte: Float32Array,
  candidats: CandidatVisage[]
): Reconnaissance {
  let meilleur: CandidatVisage | null = null;
  let meilleureDistance = Number.POSITIVE_INFINITY;

  for (const c of candidats) {
    if (!c.empreinte?.length) continue;
    const d = distance(empreinte, c.empreinte);
    if (d < meilleureDistance) {
      meilleureDistance = d;
      meilleur = c;
    }
  }

  return {
    candidat: meilleur,
    distance: meilleureDistance,
    reconnu: meilleur !== null && meilleureDistance <= SEUIL_RECONNAISSANCE,
  };
}

/**
 * Capture l'image courante d'un flux vidéo et la réduit.
 *
 * 200 px suffisent largement : l'empreinte est calculée sur un visage recadré
 * bien plus petit, et cette image ne sert qu'à l'affichage sur la fiche.
 */
export function capturer(video: HTMLVideoElement, taille = 200): string {
  const canvas = document.createElement("canvas");
  const cote = Math.min(video.videoWidth, video.videoHeight) || taille;

  canvas.width = taille;
  canvas.height = taille;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Recadrage carré centré : le portrait reste cadré quelle que soit la caméra.
  ctx.drawImage(
    video,
    (video.videoWidth - cote) / 2,
    (video.videoHeight - cote) / 2,
    cote, cote,
    0, 0, taille, taille
  );
  return canvas.toDataURL("image/jpeg", 0.8);
}
