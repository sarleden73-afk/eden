import { useCallback, useEffect, useState } from "react";
import { Building2, Plus, Pencil, Info } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Champ, Erreur, Chargement, Badge, Modale, Tableau, Vide,
} from "../components/ui";
import { getEtablissements, creerEtablissement, modifierEtablissement } from "../services/db";
import { cn } from "../lib/utils";
import type { Establishment } from "../types";

const COULEURS = [
  "#1fa066", "#d4a017", "#2563eb", "#c2410c", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f",
];

/**
 * Gestion des établissements.
 *
 * L'entreprise en compte deux aujourd'hui — la papeterie et le restaurant —
 * mais rien n'est figé : en ajouter un troisième se fait ici, sans SQL ni
 * migration. Chaque établissement a ensuite son propre catalogue, sa caisse,
 * son stock et ses résultats.
 */
export default function Etablissements() {
  const [liste, setListe] = useState<Establishment[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [edite, setEdite] = useState<Establishment | "nouveau" | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setListe(await getEtablissements());
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  return (
    <Layout>
      <PageHeader
        titre="Établissements"
        sousTitre="Les entités de l'entreprise, chacune avec son catalogue, sa caisse et ses résultats"
      >
        <Bouton icone={Plus} onClick={() => setEdite("nouveau")}>Nouvel établissement</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Card>
        {chargement ? (
          <Chargement />
        ) : liste.length === 0 ? (
          <Vide icone={Building2} titre="Aucun établissement" />
        ) : (
          <Tableau entetes={["Établissement", "Activité", "Téléphone", "Adresse", " Ordre", "État", ""]}>
            {liste.map((e) => (
              <tr key={e.id} className={cn("hover:bg-gray-50", !e.actif && "opacity-50")}>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: e.couleur }}
                      aria-hidden
                    />
                    <span className="font-medium text-gray-900">{e.nom}</span>
                  </span>
                  <div className="text-xs text-gray-400 mt-0.5 ml-5">{e.slug}</div>
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{e.activite ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{e.telephone ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{e.adresse ?? "—"}</td>
                <td className="px-4 py-3 text-right tabulaire text-gray-500">{e.ordre}</td>
                <td className="px-4 py-3">
                  {e.actif ? <Badge ton="succes">Actif</Badge> : <Badge ton="neutre">Désactivé</Badge>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEdite(e)}
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    title="Modifier"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </Tableau>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <div className="flex items-start gap-2.5">
          <Info className="h-5 w-5 text-indigo-600 shrink-0 mt-px" />
          <div className="text-sm text-gray-700 space-y-2">
            <p className="font-medium text-gray-900">Ce que sépare un établissement</p>
            <p>
              Les ventes, la caisse, les stocks, les achats, les dépenses, les commandes et le
              catalogue appartiennent chacun à un seul établissement et ne sont jamais additionnés
              sans que vous le demandiez.
            </p>
            <p>
              Les clients, les fournisseurs et le journal de traçabilité restent communs : un même
              client peut acheter à la papeterie et au restaurant, avec un seul historique.
            </p>
            <p className="text-gray-500">
              Désactiver un établissement le retire du sélecteur sans rien effacer : son historique
              reste consultable dans les rapports.
            </p>
          </div>
        </div>
      </Card>

      <ModaleEtablissement
        cible={edite}
        onFermer={() => setEdite(null)}
        onSucces={() => { setEdite(null); void recharger(); }}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function ModaleEtablissement({
  cible, onFermer, onSucces,
}: { cible: Establishment | "nouveau" | null; onFermer: () => void; onSucces: () => void }) {
  const nouveau = cible === "nouveau";
  const etab = nouveau ? null : cible;

  const [form, setForm] = useState({
    nom: "", slug: "", activite: "", adresse: "", telephone: "", email: "",
    couleur: COULEURS[0], ordre: "10", actif: true,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm({
      nom: etab?.nom ?? "",
      slug: etab?.slug ?? "",
      activite: etab?.activite ?? "",
      adresse: etab?.adresse ?? "",
      telephone: etab?.telephone ?? "",
      email: etab?.email ?? "",
      couleur: etab?.couleur ?? COULEURS[0],
      ordre: String(etab?.ordre ?? 10),
      actif: etab?.actif ?? true,
    });
  }, [cible, etab]);

  if (!cible) return null;

  /** Identifiant court dérivé du nom : minuscules, sans accent ni espace. */
  const slugDepuisNom = (nom: string) =>
    nom.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = {
        nom: form.nom.trim(),
        activite: form.activite.trim() || null,
        adresse: form.adresse.trim() || null,
        telephone: form.telephone.trim() || null,
        email: form.email.trim() || null,
        couleur: form.couleur,
        ordre: Number(form.ordre) || 10,
        actif: form.actif,
      };
      if (etab) {
        await modifierEtablissement(etab.id, corps);
      } else {
        await creerEtablissement({
          ...corps,
          slug: form.slug.trim() || slugDepuisNom(form.nom),
        });
      }
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale
      ouverte
      titre={nouveau ? "Nouvel établissement" : `Modifier — ${etab?.nom}`}
      onFermer={onFermer}
      taille="lg"
    >
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ label="Nom de l'établissement">
            <Saisie
              value={form.nom}
              onChange={(e) => {
                const nom = e.target.value;
                setForm((f) => ({
                  ...f,
                  nom,
                  // L'identifiant court suit le nom tant qu'on crée ; sur un
                  // établissement existant il est figé, des données y renvoient.
                  slug: nouveau ? slugDepuisNom(nom) : f.slug,
                }));
              }}
              placeholder="Ex. : EDEN FOOD"
              autoFocus
            />
          </Champ>
        </div>

        <div className="sm:col-span-2">
          <Champ label="Activité" aide="Affichée sous le nom dans le sélecteur.">
            <Saisie
              value={form.activite}
              onChange={(e) => setForm({ ...form, activite: e.target.value })}
              placeholder="Ex. : Restauration rapide et boissons"
            />
          </Champ>
        </div>

        <Champ label="Téléphone">
          <Saisie
            value={form.telephone}
            onChange={(e) => setForm({ ...form, telephone: e.target.value })}
          />
        </Champ>

        <Champ label="E-mail">
          <Saisie
            type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Champ>

        <div className="sm:col-span-2">
          <Champ label="Adresse">
            <Saisie
              value={form.adresse}
              onChange={(e) => setForm({ ...form, adresse: e.target.value })}
            />
          </Champ>
        </div>

        <Champ label="Ordre d'affichage" aide="Le plus petit apparaît en premier.">
          <Saisie
            type="number" value={form.ordre}
            onChange={(e) => setForm({ ...form, ordre: e.target.value })}
          />
        </Champ>

        {nouveau && (
          <Champ label="Identifiant court" aide="Généré automatiquement, non modifiable ensuite.">
            <Saisie
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: slugDepuisNom(e.target.value) })}
            />
          </Champ>
        )}

        <div className="sm:col-span-2">
          <Champ
            label="Couleur de repérage"
            aide="Un bandeau de cette couleur rappelle en permanence sur quel établissement vous travaillez."
          >
            <div className="flex flex-wrap gap-2">
              {COULEURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, couleur: c })}
                  aria-label={`Couleur ${c}`}
                  className={cn(
                    "h-9 w-9 rounded-lg border-2 transition-transform",
                    form.couleur === c ? "border-gray-900 scale-110" : "border-transparent"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </Champ>
        </div>
      </div>

      {etab && (
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
          <input
            type="checkbox" checked={form.actif}
            onChange={(e) => setForm({ ...form, actif: e.target.checked })}
            className="h-4 w-4 rounded accent-indigo-600"
          />
          Établissement actif
          <span className="text-xs text-gray-500">— le désactiver le retire du sélecteur sans rien effacer.</span>
        </label>
      )}

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!form.nom.trim()} className="flex-1">
          {nouveau ? "Créer l'établissement" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}
