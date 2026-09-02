import { useCallback, useEffect, useRef, useState } from "react";
import { Camera as IconeCamera, CameraOff, Loader2, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { chargerModeles, empreinteDepuis, capturer } from "../lib/visage";

// ============================================================================
// Caméra et lecture du visage.
//
// Composant unique pour les trois usages : inscription d'un employé, connexion
// du matin et pointage d'un collègue. Le traitement se fait entièrement sur
// l'appareil — seule l'empreinte, un vecteur de 128 nombres, quitte le
// navigateur.
// ============================================================================

export interface LectureVisage {
  empreinte: number[];
  /** Photo réduite, fournie seulement si `capturerPhoto` est demandé. */
  photo?: string;
}

type Etat = "demarrage" | "modeles" | "pret" | "analyse" | "refus" | "erreur";

export default function Camera({
  onLecture,
  capturerPhoto,
  libelleAction = "Analyser",
  automatique,
  message,
}: {
  onLecture: (lecture: LectureVisage) => void | Promise<void>;
  /** Conserver aussi une image : uniquement à l'inscription. */
  capturerPhoto?: boolean;
  libelleAction?: string;
  /** Analyse en continu, sans bouton — utilisé au pointage. */
  automatique?: boolean;
  message?: string | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const minuteur = useRef<number | undefined>(undefined);

  const [etat, setEtat] = useState<Etat>("demarrage");
  const [erreur, setErreur] = useState<string | null>(null);

  // --- Démarrage de la caméra et chargement des modèles ---------------------
  const demarrer = useCallback(async () => {
    setErreur(null);
    setEtat("demarrage");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      flux.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => {});
      }

      // Les modèles pèsent près de 7 Mo : on prévient plutôt que de laisser
      // l'écran figé sans explication au premier usage sur un appareil.
      setEtat("modeles");
      await chargerModeles();
      setEtat("pret");
    } catch (e) {
      setEtat(
        e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
          ? "refus"
          : "erreur"
      );
      setErreur(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "L'accès à la caméra a été refusé."
          : e instanceof Error ? e.message : "Caméra indisponible."
      );
    }
  }, []);

  useEffect(() => {
    void demarrer();
    return () => {
      window.clearTimeout(minuteur.current);
      flux.current?.getTracks().forEach((t) => t.stop());
      flux.current = null;
    };
  }, [demarrer]);

  // --- Analyse --------------------------------------------------------------
  const analyser = useCallback(async () => {
    if (!video.current || etat === "analyse") return;
    setEtat("analyse");
    setErreur(null);
    try {
      const empreinte = await empreinteDepuis(video.current);
      if (!empreinte) {
        setErreur("Aucun visage détecté. Placez-vous face à la caméra, dans un bon éclairage.");
        setEtat("pret");
        return;
      }
      const lecture: LectureVisage = { empreinte: Array.from(empreinte) };
      if (capturerPhoto) lecture.photo = capturer(video.current);
      await onLecture(lecture);
      setEtat("pret");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Analyse impossible.");
      setEtat("pret");
    }
  }, [etat, capturerPhoto, onLecture]);

  // Mode automatique : une tentative toutes les 1,5 seconde. Assez rapide pour
  // qu'on n'attende pas, assez espacé pour ne pas saturer une tablette.
  useEffect(() => {
    if (!automatique || etat !== "pret") return;
    minuteur.current = window.setTimeout(() => { void analyser(); }, 1500);
    return () => window.clearTimeout(minuteur.current);
  }, [automatique, etat, analyser]);

  const occupe = etat === "analyse" || etat === "modeles" || etat === "demarrage";

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full max-w-xs mx-auto rounded-2xl overflow-hidden bg-gray-950">
        <video
          ref={video}
          playsInline
          muted
          // Effet miroir : sans lui, on se voit à l'envers et on se recadre mal.
          className="h-full w-full object-cover scale-x-[-1]"
        />

        {/* Repère de cadrage : sans lui, les gens se placent trop loin. */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            className={cn(
              "h-3/5 w-3/5 rounded-full border-2 transition-colors",
              etat === "analyse" ? "border-indigo-400" : "border-[#fff]/30"
            )}
          />
        </div>

        {(etat === "refus" || etat === "erreur") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/90 p-5 text-center">
            <CameraOff className="h-8 w-8 text-gray-500" />
            <p className="text-sm text-gray-300">{erreur}</p>
            <button
              onClick={() => void demarrer()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-gray-800 text-[#fff] hover:bg-gray-700"
            >
              <RefreshCw className="h-4 w-4" />
              Réessayer
            </button>
          </div>
        )}

        {occupe && etat !== "refus" && etat !== "erreur" && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gray-950/80 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
            <span className="text-xs text-gray-300">
              {etat === "modeles" ? "Préparation de la reconnaissance…"
                : etat === "analyse" ? "Analyse…" : "Ouverture de la caméra…"}
            </span>
          </div>
        )}
      </div>

      {(erreur && etat === "pret") && (
        <p className="text-sm text-center text-amber-700">{erreur}</p>
      )}
      {message && <p className="text-sm text-center text-gray-600">{message}</p>}

      {!automatique && (
        <button
          onClick={() => void analyser()}
          disabled={etat !== "pret"}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg",
            "text-sm font-medium bg-indigo-600 text-[#fff] hover:bg-indigo-700",
            "disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          )}
        >
          <IconeCamera className="h-4 w-4" />
          {libelleAction}
        </button>
      )}
    </div>
  );
}
