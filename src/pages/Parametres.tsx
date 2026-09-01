import { useEffect, useState } from "react";
import { Settings, Save, Building2, Wallet, Check, Info } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Champ, Erreur, Chargement,
} from "../components/ui";
import { getParametres, enregistrerParametres } from "../services/db";
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
      <PageHeader titre="Paramètres" sousTitre="Informations de l'entreprise et réglages de la caisse">
        <Bouton onClick={enregistrer} chargement={envoi} icone={enregistre ? Check : Save}>
          {enregistre ? "Enregistré" : "Enregistrer"}
        </Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <div className="space-y-6 max-w-3xl">
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
              <Champ label="Adresse du logo" aide="URL d'une image hébergée. Le fichier lui-même n'est pas stocké ici.">
                <Saisie
                  value={entreprise.logoUrl}
                  onChange={(e) => setEntreprise({ ...entreprise, logoUrl: e.target.value })}
                  placeholder="https://…"
                />
              </Champ>
            </div>
          </div>

          {entreprise.logoUrl && (
            <div className="mt-4 flex items-center gap-3">
              <img
                src={entreprise.logoUrl}
                alt="Logo de l'entreprise"
                className="h-14 w-14 object-contain border border-gray-200 rounded-lg bg-white"
                // Une URL erronée ne doit pas laisser une icône cassée à l'écran.
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
