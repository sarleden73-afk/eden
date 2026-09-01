import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useRef, useState } from "react";

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
}

const CONTAINER_ID = "reader";

export default function QRScanner({ onScan, onError }: QRScannerProps) {
  const instanceRef = useRef<Html5Qrcode | null>(null);
  // Refs so the camera never restarts just because the parent re-rendered
  // and passed new onScan/onError function references.
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  onScanRef.current = onScan;
  onErrorRef.current = onError;

  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const qr = new Html5Qrcode(CONTAINER_ID);
    instanceRef.current = qr;

    // Starts the camera immediately — no "click to enable camera" button.
    qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => onScanRef.current(decodedText),
      (errMsg) => onErrorRef.current?.(errMsg)
    )
      .then(() => { if (!cancelled) setStatus("running"); })
      .catch((err) => {
        if (!cancelled) { setStatus("error"); setErrorMsg(String(err?.message || err)); }
      });

    return () => {
      cancelled = true;
      const inst = instanceRef.current;
      instanceRef.current = null;
      if (inst) {
        inst.stop().then(() => inst.clear()).catch(() => {});
      }
    };
  }, []); // monté une seule fois : la caméra ne se relance pas à chaque re-rendu

  return (
    <div className="w-full max-w-md mx-auto">
      <div id={CONTAINER_ID} className="w-full min-h-[280px] rounded-xl overflow-hidden shadow-lg border-2 border-indigo-500 bg-black"></div>
      {status === "starting" && <p className="text-center mt-3 text-sm text-gray-500">Ouverture de la caméra...</p>}
      {status === "error" && (
        <p className="text-center mt-3 text-sm text-red-600">
          Caméra indisponible{errorMsg ? ` : ${errorMsg}` : ""}. Autorisez l'accès à la caméra dans votre navigateur puis rechargez la page.
        </p>
      )}
    </div>
  );
}
