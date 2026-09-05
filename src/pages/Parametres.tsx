import { useEffect, useState } from "react";
import {
  Save, Building2, Wallet, Check, Info, Palette, Sun, Moon, Laptop, Upload, Trash2,
  MapPin, Crosshair, Package,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Champ, Erreur, Chargement,
} from "../components/ui";
import { getParametres, enregistrerParametres } from "../services/db";
import { cn } from "../lib/utils";
import { useTheme, ACCENTS, MODES } from "../contexts/ThemeContext";
import type {
  EntrepriseSettings, CaisseSettings, LocalisationSettings, CommandeSettings,
} from "../types";
import { obtenirPosition, oublierPosition, distanceMetres } from "../lib/position";

const ENTREPRISE_VIDE: EntrepriseSettings = {
  nom: "EDEN MULTI-SERVICES",
  adresse: "", telephone: "", email: "", niu: "", logoUrl: "", devise: "FCFA",
};

const CAISSE_DEFAUT: CaisseSettings = { fondsInitialParDefaut: 0, inactiviteMinutes: 30 };

/**
 * Périmètre par défaut : la papeterie de Kintélé, trente mètres.
 *
 * La tolérance de soixante mètres n'élargit pas le périmètre — elle crédite
 * l'imprécision que l'appareil annonce lui-même. En intérieur, un téléphone
 * donne couramment quarante mètres d'incertitude : sans ce crédit, un agent
 * debout derrière le comptoir serait refusé. Le crédit est plafonné, sinon une
 * position déduite de l'adresse IP ouvrirait le périmètre au pays entier.
 */
const LOCALISATION_DEFAUT: LocalisationSettings = {
  latitude: -4.12436,
  longitude: 15.35937,
  rayonMetres: 30,
  toleranceMetres: 60,
  actif: false,
};

const COMMANDE_DEFAUT: CommandeSettings = { joursDeGarde: 10 };

/**
 * Retire le fond uni d'un logo, en place.
 *
 * Le logo de l'entreprise est posé sur un aplat bleu ; sur une facture, cet
 * aplat forme un rectangle qui ne ressemble à rien. On part des quatre coins,
 * qui sont du fond par construction, et on efface de proche en proche tout ce
 * qui leur ressemble. Un simple « efface tous les pixels bleus » mangerait le
 * bleu à l'intérieur du dessin ; la propagation depuis les bords, non.
 *
 * Le seuil est volontairement tolérant : les aplats sont rarement parfaitement
 * uniformes après compression JPEG.
 */
function retirerLeFond(ctx: CanvasRenderingContext2D, largeur: number, hauteur: number) {
  const image = ctx.getImageData(0, 0, largeur, hauteur);
  const px = image.data;
  const SEUIL = 60;

  const indice = (x: number, y: number) => (y * largeur + x) * 4;
  const coin = indice(0, 0);
  const fond = [px[coin], px[coin + 1], px[coin + 2]];

  const proche = (i: number) =>
    Math.abs(px[i] - fond[0]) + Math.abs(px[i + 1] - fond[1]) + Math.abs(px[i + 2] - fond[2]) < SEUIL * 3;

  // Parcours en largeur depuis les quatre bords. Une pile explicite plutôt
  // qu'une récursion : sur une image de 384 pixels de côté, la récursion
  // dépasse la pile d'appels du navigateur.
  const vus = new Uint8Array(largeur * hauteur);
  const pile: number[] = [];
  const empiler = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= largeur || y >= hauteur) return;
    const p = y * largeur + x;
    if (vus[p]) return;
    vus[p] = 1;
    pile.push(x, y);
  };

  for (let x = 0; x < largeur; x++) { empiler(x, 0); empiler(x, hauteur - 1); }
  for (let y = 0; y < hauteur; y++) { empiler(0, y); empiler(largeur - 1, y); }

  while (pile.length) {
    const y = pile.pop()!;
    const x = pile.pop()!;
    const i = indice(x, y);
    if (!proche(i)) continue;
    px[i + 3] = 0;
    empiler(x + 1, y); empiler(x - 1, y); empiler(x, y + 1); empiler(x, y - 1);
  }

  ctx.putImageData(image, 0, 0);
}

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
  const [detourerLeFond, setDetourerLeFond] = useState(false);
  const [localisation, setLocalisation] = useState<LocalisationSettings>(LOCALISATION_DEFAUT);
  const [commande, setCommande] = useState<CommandeSettings>(COMMANDE_DEFAUT);
  const [positionRelevee, setPositionRelevee] = useState<string | null>(null);
  const { accent, mode, choisirAccent, choisirMode } = useTheme();

  useEffect(() => {
    getParametres()
      .then((p) => {
        setEntreprise({ ...ENTREPRISE_VIDE, ...(p.entreprise ?? {}) });
        setCaisse({ ...CAISSE_DEFAUT, ...(p.caisse ?? {}) });
        setLocalisation({ ...LOCALISATION_DEFAUT, ...(p.localisation ?? {}) });
        setCommande({ ...COMMANDE_DEFAUT, ...(p.commande ?? {}) });
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
  const chargerLogo = async (fichier: File, detourer = false) => {
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

      // 384 plutôt que 256 : le logo sert aussi de vignette sur les factures
      // imprimées, où 256 pixels tirés sur 34 mm se voient.
      const MAX = 384;
      const echelle = Math.min(1, MAX / Math.max(image.width, image.height));
      const largeur = Math.round(image.width * echelle);
      const hauteur = Math.round(image.height * echelle);

      const canvas = document.createElement("canvas");
      canvas.width = largeur;
      canvas.height = hauteur;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Redimensionnement impossible sur cet appareil.");

      if (detourer) {
        ctx.drawImage(image, 0, 0, largeur, hauteur);
        retirerLeFond(ctx, largeur, hauteur);
        // PNG obligatoire : le JPEG ne sait pas être transparent, et le fond
        // qu'on vient de retirer reviendrait en noir.
        setEntreprise((e) => ({ ...e, logoUrl: canvas.toDataURL("image/png") }));
      } else {
        // Fond blanc : un PNG transparent réencodé en JPEG virerait au noir.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, largeur, hauteur);
        ctx.drawImage(image, 0, 0, largeur, hauteur);
        setEntreprise((e) => ({ ...e, logoUrl: canvas.toDataURL("image/jpeg", 0.85) }));
      }
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
        enregistrerParametres("localisation", localisation),
        enregistrerParametres("commande", commande),
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
                aide="Image carrée de préférence. Elle est réduite avant d'être enregistrée, et sert aussi d'en-tête aux factures."
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
                        if (fichier) void chargerLogo(fichier, detourerLeFond);
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

                {/* Le logo de la papeterie est posé sur un aplat bleu : sur une
                    facture, cet aplat forme un rectangle qui ne ressemble à
                    rien. Le détourage part des bords, il ne mange donc pas les
                    couleurs présentes à l'intérieur du dessin. */}
                <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={detourerLeFond}
                    onChange={(e) => setDetourerLeFond(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">
                    Retirer le fond uni
                    <span className="block text-xs text-gray-500">
                      À cocher <strong>avant</strong> de choisir le fichier, pour un logo posé sur un
                      aplat de couleur. Le fond devient transparent sur les factures.
                    </span>
                  </span>
                </label>
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

        {/* --- Périmètre de travail --- */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-5 w-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Périmètre de travail</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Limite les opérations du personnel de terrain à l'établissement. L'encadrement n'est
            jamais bloqué : corriger une écriture le soir fait partie de son travail.
          </p>

          <label className="flex items-start gap-2.5 cursor-pointer mb-5">
            <input
              type="checkbox"
              checked={localisation.actif}
              onChange={(e) => setLocalisation({ ...localisation, actif: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600"
            />
            <span className="text-sm text-gray-900">
              Exiger la présence sur place
              <span className="block text-xs text-gray-500">
                Le caissier et le technicien ne peuvent alors ni pointer, ni enregistrer une vente,
                une dépense ou un achat depuis l'extérieur. La consultation, elle, reste libre.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Latitude">
              <Saisie
                type="number" step="0.00001" value={localisation.latitude}
                onChange={(e) => setLocalisation({ ...localisation, latitude: Number(e.target.value) })}
              />
            </Champ>
            <Champ label="Longitude">
              <Saisie
                type="number" step="0.00001" value={localisation.longitude}
                onChange={(e) => setLocalisation({ ...localisation, longitude: Number(e.target.value) })}
              />
            </Champ>
            <Champ label="Rayon autorisé (mètres)" aide="30 m couvre la boutique et son entrée.">
              <Saisie
                type="number" min={10} max={2000} value={localisation.rayonMetres}
                onChange={(e) => setLocalisation({ ...localisation, rayonMetres: Number(e.target.value) || 30 })}
              />
            </Champ>
            <Champ
              label="Tolérance GPS (mètres)"
              aide="Marge accordée à l'imprécision annoncée par l'appareil. En intérieur, un téléphone se trompe couramment de 40 m."
            >
              <Saisie
                type="number" min={0} max={300} value={localisation.toleranceMetres}
                onChange={(e) => setLocalisation({ ...localisation, toleranceMetres: Number(e.target.value) || 0 })}
              />
            </Champ>
          </div>

          {/* Relever le point depuis la boutique vaut mieux que recopier des
              coordonnées : ce qui compte, c'est ce que voit l'appareil sur
              place, pas ce qu'affiche une carte. */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Bouton
              variante="secondaire"
              icone={Crosshair}
              onClick={async () => {
                setPositionRelevee("Relevé en cours…");
                oublierPosition();
                const p = await obtenirPosition();
                if (!p) {
                  setPositionRelevee("Position indisponible : autorisez la localisation dans le navigateur.");
                  return;
                }
                const ecart = distanceMetres(
                  p.latitude, p.longitude, localisation.latitude, localisation.longitude
                );
                setLocalisation((l) => ({ ...l, latitude: p.latitude, longitude: p.longitude }));
                setPositionRelevee(
                  `Point relevé à ${Math.round(p.precision)} m près, `
                  + `à ${Math.round(ecart)} m du point précédent.`
                );
              }}
            >
              Relever ma position actuelle
            </Bouton>
            <a
              href={`https://www.google.com/maps?q=${localisation.latitude},${localisation.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-600 hover:underline"
            >
              Vérifier le point sur une carte
            </a>
          </div>
          {positionRelevee && (
            <p className="mt-2 text-sm text-gray-600">{positionRelevee}</p>
          )}

          <div className="flex items-start gap-2.5 mt-5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <Info className="h-5 w-5 text-amber-600 shrink-0 mt-px" />
            <p className="text-sm text-amber-900">
              Un téléphone qui ne capte pas le GPS se rabat sur le Wi-Fi, voire sur l'adresse
              Internet — parfois à plusieurs kilomètres. Si l'équipe se retrouve bloquée sans
              raison, décochez la case ci-dessus : l'effet est immédiat, sans redémarrage.
            </p>
          </div>
        </Card>

        {/* --- Commandes --- */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-5 w-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Commandes</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Ce délai est imprimé sur chaque bon de commande, sous le total.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              label="Jours de garde après la date de retrait"
              aide="Passé ce délai, la conservation n'est plus garantie et l'acompte reste acquis."
            >
              <Saisie
                type="number" min={1} max={180} value={commande.joursDeGarde}
                onChange={(e) => setCommande({ joursDeGarde: Number(e.target.value) || 10 })}
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
