import { useEffect, useState } from "react";
import {
  Save, Building2, Wallet, Check, Info, Palette, Sun, Moon, Laptop, Upload, Trash2,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Champ, Erreur, Chargement,
} from "../components/ui";
import { getParametres, enregistrerParametres } from "../services/db";
import { cn } from "../lib/utils";
import { useTheme, ACCENTS, MODES } from "../contexts/ThemeContext";
import type { EntrepriseSettings, CaisseSettings } from "../types";

const ENTREPRISE_VIDE: EntrepriseSettings = {
  nom: "EDEN MULTI-SERVICES",
  adresse: "", telephone: "", email: "", niu: "", logoUrl: "", devise: "FCFA",
};

const CAISSE_DEFAUT: CaisseSettings = { fondsInitialParDefaut: 0, inactiviteMinutes: 30 };

/**
 * §6 Informations restant à fournir.
 * Ces champs sont volontairement libres et facultatifs : le cahier des charges
 * les liste comme « à préciser », et la plateforme doit fonctionner avant qu'ils
 * ne soient tous connus.
 */
export default function Parametres() {
  const [entreprise, setEntreprise] = useState<EntrepriseSettings>(ENTREPRISE_VIDE);
  const [caisse, setCaisse] = useState<CaisseSettings>(CAISSE_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [erreurLogo, setErreurLogo] = useState<string | null>(null);
  const { accent, mode, choisirAccent, choisirMode } = useTheme();

  useEffect(() => {
    getParametres()
      .then((p) => {
        setEntreprise({ ...ENTREPRISE_VIDE, ...(p.entreprise ?? {}) });
        setCaisse({ ...CAISSE_DEFAUT, ...(p.caisse ?? {}) });
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, []);

  /**
   * Redimensionne le logo avant de l'enregistrer.
   *
   * L'image est stockée dans les paramètres, en base : une photo brute de
   * plusieurs mégaoctets y serait relue à chaque chargement de l'application.
   * On la ramène donc à 256 pixels et on la réencode en JPEG — largement
   * suffisant pour un logo affiché à 56 pixels, et une trentaine de kilo-octets
   * au lieu de plusieurs milliers.
   */
  const chargerLogo = async (fichier: File) => {
    setErreurLogo(null);
    if (!fichier.type.startsWith("image/")) {
      setErreurLogo("Choisissez un fichier image.");
      return;
    }
    if (fichier.size > 8 * 1024 * 1024) {
      setErreurLogo("Image trop lourde : 8 Mo maximum.");
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.onerror = () => reject(new Error("Lecture impossible."));
        lecteur.readAsDataURL(fichier);
      });

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image illisible."));
        img.src = dataUrl;
      });

      const MAX = 256;
      const echelle = Math.min(1, MAX / Math.max(image.width, image.height));
      const largeur = Math.round(image.width * echelle);
      const hauteur = Math.round(image.height * echelle);

      const canvas = document.createElement("canvas");
      canvas.width = largeur;
      canvas.height = hauteur;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Redimensionnement impossible sur cet appareil.");

      // Fond blanc : un PNG transparent réencodé en JPEG virerait au noir.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, largeur, hauteur);
      ctx.drawImage(image, 0, 0, largeur, hauteur);

      setEntreprise((e) => ({ ...e, logoUrl: canvas.toDataURL("image/jpeg", 0.85) }));
    } catch (e) {
      setErreurLogo(e instanceof Error ? e.message : "Image illisible.");
    }
  };

  const enregistrer = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await Promise.all([
        enregistrerParametres("entreprise", entreprise),
        enregistrerParametres("caisse", caisse),
      ]);
      setEnregistre(true);
      window.setTimeout(() => setEnregistre(false), 2500);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  if (chargement) {
    return <Layout><Chargement /></Layout>;
  }

  return (
    <Layout>
      <PageHeader titre="Paramètres" sousTitre="Apparence, identité de l'entreprise et réglages de la caisse">
        <Bouton onClick={enregistrer} chargement={envoi} icone={enregistre ? Check : Save}>
          {enregistre ? "Enregistré" : "Enregistrer"}
        </Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <div className="space-y-6 max-w-3xl">
        {/* --- Apparence --- */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Palette className="h-5 w-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Apparence</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Réglage personnel, appliqué immédiatement et propre à cet appareil : chacun peut
            travailler dans les couleurs qui lui conviennent.
          </p>

          <Champ label="Couleur d'accent">
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.cle}
                  type="button"
                  onClick={() => choisirAccent(a.cle)}
                  title={a.nom}
                  aria-label={a.nom}
                  aria-pressed={accent === a.cle}
                  className={cn(
                    "h-10 w-10 rounded-lg border-2 transition-transform",
                    accent === a.cle
                      ? "border-gray-900 scale-110"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: a.apercu }}
                />
              ))}
            </div>
          </Champ>

          <div className="mt-5">
            <Champ label="Mode d'affichage">
              <div className="grid gap-2 sm:grid-cols-3">
                {MODES.map((m) => (
                  <button
                    key={m.cle}
                    type="button"
                    onClick={() => choisirMode(m.cle)}
                    className={cn(
                      "flex items-start gap-2.5 p-3 rounded-lg border text-left transition-colors",
                      mode === m.cle
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-300 hover:bg-gray-50"
                    )}
                  >
                    {m.cle === "clair" ? <Sun className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
                      : m.cle === "sombre" ? <Moon className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
                      : <Laptop className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{m.nom}</span>
                      <span className="block text-xs text-gray-500">{m.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Champ>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Building2 className="h-5 w-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Identité de l'entreprise</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Champ label="Raison sociale">
                <Saisie
                  value={entreprise.nom}
                  onChange={(e) => setEntreprise({ ...entreprise, nom: e.target.value })}
                />
              </Champ>
            </div>

            <div className="sm:col-span-2">
              <Champ label="Adresse de la boutique">
                <Saisie
                  value={entreprise.adresse}
                  onChange={(e) => setEntreprise({ ...entreprise, adresse: e.target.value })}
                  placeholder="Quartier, avenue, ville"
                />
              </Champ>
            </div>

            <Champ label="Téléphone">
              <Saisie
                value={entreprise.telephone}
                onChange={(e) => setEntreprise({ ...entreprise, telephone: e.target.value })}
                placeholder="06 000 00 00"
              />
            </Champ>

            <Champ label="Adresse e-mail">
              <Saisie
                type="email" value={entreprise.email}
                onChange={(e) => setEntreprise({ ...entreprise, email: e.target.value })}
              />
            </Champ>

            <Champ label="NIU / identifiant fiscal" aide="Facultatif, apparaîtra sur les documents.">
              <Saisie
                value={entreprise.niu}
                onChange={(e) => setEntreprise({ ...entreprise, niu: e.target.value })}
              />
            </Champ>

            <Champ label="Devise">
              <Saisie
                value={entreprise.devise}
                onChange={(e) => setEntreprise({ ...entreprise, devise: e.target.value })}
              />
            </Champ>

            <div className="sm:col-span-2">
              <Champ
                label="Logo"
                aide="Image carrée de préférence. Elle est réduite à 256 pixels avant d'être enregistrée."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                    <Upload className="h-4 w-4" />
                    {entreprise.logoUrl ? "Remplacer" : "Choisir un fichier"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const fichier = e.target.files?.[0];
                        e.target.value = "";
                        if (fichier) void chargerLogo(fichier);
                      }}
                    />
                  </label>
                  {entreprise.logoUrl && (
                    <Bouton
                      variante="secondaire"
                      icone={Trash2}
                      onClick={() => setEntreprise({ ...entreprise, logoUrl: "" })}
                    >
                      Retirer
                    </Bouton>
                  )}
                </div>
              </Champ>
              {erreurLogo && <p className="mt-1.5 text-xs text-red-600">{erreurLogo}</p>}
            </div>
          </div>

          {entreprise.logoUrl && (
            <div className="mt-4 flex items-center gap-3">
              <img
                src={entreprise.logoUrl}
                alt="Logo de l'entreprise"
                className="h-14 w-14 object-contain border border-gray-200 rounded-lg bg-white"
                // Une image invalide ne doit pas laisser une icône cassée à l'écran.
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <span className="text-sm text-gray-500">Aperçu du logo</span>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Wallet className="h-5 w-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Caisse et sécurité</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              label="Fond de caisse initial par défaut (FCFA)"
              aide="Proposé à l'ouverture ; le caissier peut toujours le corriger."
            >
              <Saisie
                type="number" min={0} value={caisse.fondsInitialParDefaut}
                onChange={(e) =>
                  setCaisse({ ...caisse, fondsInitialParDefaut: Number(e.target.value) || 0 })
                }
              />
            </Champ>

            <Champ
              label="Déconnexion après inactivité (minutes)"
              aide="Valeur de référence. La déconnexion effective est fixée à 30 minutes côté application."
            >
              <Saisie
                type="number" min={5} max={240} value={caisse.inactiviteMinutes}
                onChange={(e) =>
                  setCaisse({ ...caisse, inactiviteMinutes: Number(e.target.value) || 30 })
                }
              />
            </Champ>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start gap-2.5">
            <Info className="h-5 w-5 text-indigo-600 shrink-0 mt-px" />
            <div className="text-sm text-gray-700 space-y-2">
              <p className="font-medium text-gray-900">Informations encore attendues</p>
              <p>
                Le cahier des charges signale plusieurs éléments à préciser, qui n'empêchent pas
                d'utiliser la plateforme mais rendront les chiffres plus justes :
              </p>
              <ul className="space-y-1 ml-1">
                {[
                  "Prix d'achat des articles — sans eux, la marge brute est égale au chiffre d'affaires.",
                  "Quantités initiales en stock — à saisir via un achat ou un ajustement d'inventaire.",
                  "Composition des quatre packs scolaires.",
                  "Moyens de paiement réellement utilisés (les cinq du cahier des charges sont proposés).",
                  "Libellé exact du second article « Crayons de couleur ».",
                  "Formats exacts des boissons à 500 et 1 000 FCFA.",
                  "Cuisinière et agent polyvalent du pôle EDEN FOOD.",
                ].map((x) => (
                  <li key={x} className="flex gap-2">
                    <span className="text-indigo-500 shrink-0">•</span>{x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
