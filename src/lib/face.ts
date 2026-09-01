// Reconnaissance faciale côté navigateur (gratuit, via @vladmandic/face-api).
// Les modèles sont servis EN LOCAL depuis /models (copiés dans public/models) : pas de
// dépendance à un CDN externe au moment du pointage — chargement fiable, mis en cache
// par le navigateur, et fonctionnel même en cas de connexion instable après le 1er accès.

let faceapi: any = null;
let modelsPromise: Promise<any> | null = null;

// SSD MobileNet = détecteur le plus fiable pour retrouver un visage dans des conditions
// variées (éclairage de salon, angle, téléphone). TinyFaceDetector sert de secours rapide.
const MODEL_URL = "/models";
// Seuil standard face-api : distance <= 0.6 = même personne. En dessous, on refuse.
const MATCH_THRESHOLD = 0.6;

export async function loadFaceModels() {
  if (!faceapi) faceapi = await import("@vladmandic/face-api");
  if (!modelsPromise) {
    modelsPromise = (async () => {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((e) => {
      // Réinitialise pour permettre une nouvelle tentative au prochain appel.
      modelsPromise = null;
      throw e;
    });
  }
  await modelsPromise;
  return faceapi;
}

// Calcule l'empreinte (descripteur) d'un visage. Essaie d'abord SSD MobileNet (précis),
// puis TinyFaceDetector en secours si aucun visage n'est trouvé.
async function descriptorFromUrl(url: string): Promise<Float32Array | null> {
  const fa = await loadFaceModels();
  const img = await fa.fetchImage(url);

  // 1) SSD MobileNet, confiance modérée pour tolérer un éclairage imparfait.
  let det = await fa
    .detectSingleFace(img, new fa.SsdMobilenetv1Options({ minConfidence: 0.35 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  // 2) Secours : TinyFaceDetector à haute résolution d'entrée.
  if (!det) {
    det = await fa
      .detectSingleFace(img, new fa.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
  }

  return det ? det.descriptor : null;
}

// Vérifie qu'un visage exploitable est présent sur une photo (utilisé à l'inscription
// d'un employé pour éviter d'enregistrer une photo de référence inutilisable).
export async function hasDetectableFace(dataUrl: string): Promise<boolean> {
  try {
    const d = await descriptorFromUrl(dataUrl);
    return !!d;
  } catch {
    return false;
  }
}

// Compare une photo prise en direct (data URL) à la photo d'inscription (data URL).
// Renvoie matched=true si les visages concordent (distance <= MATCH_THRESHOLD).
export async function matchFaces(
  liveDataUrl: string,
  refUrl: string
): Promise<{ matched: boolean; distance: number; error?: string }> {
  try {
    await loadFaceModels();
  } catch {
    return {
      matched: false,
      distance: 1,
      error: "Impossible de charger les modèles de reconnaissance faciale. Vérifiez la connexion puis rechargez la page.",
    };
  }
  try {
    const live = await descriptorFromUrl(liveDataUrl);
    if (!live) return { matched: false, distance: 1, error: "Aucun visage détecté sur la photo en direct. Placez bien votre visage face à la caméra, dans un endroit éclairé." };
    const ref = await descriptorFromUrl(refUrl);
    if (!ref) return { matched: false, distance: 1, error: "Aucun visage détectable sur la photo d'inscription de l'employé. Reprenez sa photo de profil bien de face." };
    const fa = await loadFaceModels();
    const distance = fa.euclideanDistance(live, ref);
    return { matched: distance <= MATCH_THRESHOLD, distance };
  } catch (e: any) {
    return { matched: false, distance: 1, error: e?.message || "Erreur lors de la reconnaissance faciale." };
  }
}

// Identifie QUI est sur la photo parmi une liste de candidats (1:N), au lieu de
// vérifier une identité déjà annoncée (1:1, voir matchFaces ci-dessus). Utile pour un
// terminal partagé : on prend juste la photo, sans chercher son nom dans une liste.
// Calcule l'empreinte de la photo en direct UNE seule fois, puis la compare à chaque
// candidat — plus rapide qu'appeler matchFaces en boucle.
export async function identifyFace(
  liveDataUrl: string,
  candidates: { id: number; refUrl: string }[]
): Promise<{ id: number | null; distance: number; error?: string }> {
  try {
    await loadFaceModels();
  } catch {
    return {
      id: null,
      distance: 1,
      error: "Impossible de charger les modèles de reconnaissance faciale. Vérifiez la connexion puis rechargez la page.",
    };
  }
  try {
    const live = await descriptorFromUrl(liveDataUrl);
    if (!live) return { id: null, distance: 1, error: "Aucun visage détecté sur la photo. Placez bien votre visage face à la caméra, dans un endroit éclairé." };
    const fa = await loadFaceModels();
    let best: { id: number; distance: number } | null = null;
    for (const c of candidates) {
      const ref = await descriptorFromUrl(c.refUrl);
      if (!ref) continue;
      const distance = fa.euclideanDistance(live, ref);
      if (distance <= MATCH_THRESHOLD && (!best || distance < best.distance)) best = { id: c.id, distance };
    }
    if (!best) return { id: null, distance: 1, error: "Visage non reconnu parmi les employés inscrits. Sélectionnez votre nom dans la liste, ou reprenez la photo dans un endroit bien éclairé." };
    return best;
  } catch (e: any) {
    return { id: null, distance: 1, error: e?.message || "Erreur lors de la reconnaissance faciale." };
  }
}
