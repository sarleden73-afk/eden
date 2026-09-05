// ============================================================================
// Position de l'appareil.
//
// Le serveur refuse les écritures du personnel de terrain faites hors de
// l'établissement. C'est ici qu'on obtient la position à lui transmettre, dans
// l'en-tête `X-Position` de chaque appel.
//
// Deux principes tiennent ce module :
//
//   * On ne demande jamais la position en boucle. Un relevé vaut deux minutes :
//     une boutique ne se déplace pas, et solliciter le GPS à chaque vente vide
//     la batterie d'une tablette en une matinée.
//
//   * L'échec n'est jamais silencieux mais ne bloque rien ici. Si la position
//     est refusée ou indisponible, l'appel part sans en-tête et c'est le
//     serveur qui tranche — lui seul sait si le périmètre est actif. Décider
//     dans le navigateur reviendrait à laisser le contrôle à la machine qu'on
//     cherche justement à contrôler.
// ============================================================================

export interface Position {
  latitude: number;
  longitude: number;
  /** Rayon d'incertitude annoncé par l'appareil, en mètres. */
  precision: number;
  obtenueA: number;
}

/** Un relevé reste valable deux minutes. */
const VALIDITE_MS = 120_000;
const DELAI_MS = 12_000;

let derniere: Position | null = null;
let enCours: Promise<Position | null> | null = null;

/** Dernier relevé connu, sans en déclencher un nouveau. */
export const positionConnue = (): Position | null =>
  derniere && Date.now() - derniere.obtenueA < VALIDITE_MS ? derniere : null;

/**
 * Position courante, relevée si besoin.
 *
 * Les appels concurrents partagent la même demande : au chargement d'un écran,
 * cinq requêtes partent ensemble et ne doivent pas ouvrir cinq relevés GPS.
 */
export function obtenirPosition(): Promise<Position | null> {
  const connue = positionConnue();
  if (connue) return Promise.resolve(connue);
  if (enCours) return enCours;

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  enCours = new Promise<Position | null>((resoudre) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        derniere = {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precision: p.coords.accuracy ?? 0,
          obtenueA: Date.now(),
        };
        resoudre(derniere);
      },
      () => resoudre(null),
      { enableHighAccuracy: true, timeout: DELAI_MS, maximumAge: VALIDITE_MS }
    );
  }).finally(() => { enCours = null; });

  return enCours;
}

/** Valeur de l'en-tête `X-Position`, ou rien si la position est inconnue. */
export async function entetePosition(): Promise<Record<string, string>> {
  const p = await obtenirPosition();
  if (!p) return {};
  return {
    "X-Position": `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)},${Math.round(p.precision)}`,
  };
}

/** Oublie le relevé courant — après un déplacement, ou pour réessayer. */
export function oublierPosition() {
  derniere = null;
}

/** Distance en mètres entre deux points (haversine), pour l'affichage. */
export function distanceMetres(
  aLat: number, aLng: number, bLat: number, bLng: number
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
