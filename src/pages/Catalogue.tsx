import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Plus, Pencil, Search, Layers, Tag, FileDown, Lock } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide, BandeauChoisirEtablissement,
} from "../components/ui";
import {
  getProduits, getPacks, getCategories, getFournisseurs,
  creerProduit, modifierProduit, creerPack, modifierPack, creerCategorie,
} from "../services/db";
import { fcfa, quantite as fmtQuantite } from "../lib/format";
import { exporterCSV } from "../lib/export";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { useEtablissement } from "../contexts/EtablissementContext";
import type { Product, Pack, Category, Supplier } from "../types";

type Onglet = "produits" | "packs" | "categories";

/**
 * §2, §3 Catalogue.
 *
 * Chaque établissement a son propre catalogue : les articles de la papeterie
 * n'apparaissent pas au restaurant, et inversement. La consultation est ouverte
 * à tous (le caissier doit voir les tarifs), la modification est réservée à
 * l'administrateur (§5.1) et journalisée (§5.10).
 */
export default function Catalogue() {
  const { peut } = useAuth();
  const { selection, libelle, pourEcriture, nomDe } = useEtablissement();
  const modifiable = peut("admin");

  const [onglet, setOnglet] = useState<Onglet>("produits");
  const [produits, setProduits] = useState<Product[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Supplier[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [recherche, setRecherche] = useState("");
  const [produitEdite, setProduitEdite] = useState<Product | "nouveau" | null>(null);
  const [packEdite, setPackEdite] = useState<Pack | "nouveau" | null>(null);
  const [categorieNouvelle, setCategorieNouvelle] = useState(false);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const [p, pk, c] = await Promise.all([
        getProduits(selection, { tous: true }),
        getPacks(selection),
        getCategories(selection),
      ]);
      setProduits(p); setPacks(pk); setCategories(c);
      // Les fournisseurs ne sont listés que pour les profils qui y ont droit.
      if (peut("admin", "responsable")) setFournisseurs(await getFournisseurs().catch(() => []));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [peut, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const produitsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return produits.filter((p) => !terme || p.nom.toLowerCase().includes(terme));
  }, [produits, recherche]);

  const exporter = () =>
    exporterCSV(
      "catalogue-eden",
      ["Article", "Catégorie", "Établissement", "Type", "Prix de vente", "Prix d'achat", "Marge", "Stock", "Seuil", "Actif"],
      produitsFiltres.map((p) => [
        p.nom, p.categorieNom ?? "", nomDe(p.establishmentId),
        p.kind === "produit" ? "Produit" : "Prestation",
        p.prixVente, p.prixAchat, p.prixVente - p.prixAchat,
        p.gereStock ? p.quantite : "", p.gereStock ? p.seuilAlerte : "",
        p.actif ? "Oui" : "Non",
      ])
    );

  const onglets: { cle: Onglet; label: string; icone: typeof Package; nb: number }[] = [
    { cle: "produits", label: "Articles et prestations", icone: Package, nb: produits.length },
    { cle: "packs", label: "Packs", icone: Layers, nb: packs.length },
    { cle: "categories", label: "Catégories", icone: Tag, nb: categories.length },
  ];

  // En vue consolidée on peut tout consulter, mais pas créer : un article
  // appartient à un établissement, encore faut-il savoir lequel.
  const creationPossible = modifiable && pourEcriture !== null;

  return (
    <Layout>
      <PageHeader titre="Catalogue" sousTitre={`${libelle} — articles, prestations, packs et catégories`}>
        {!modifiable && (
          <Badge ton="neutre"><Lock className="inline h-3 w-3 mr-1" />Consultation seule</Badge>
        )}
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter}>Excel</Bouton>
        {creationPossible && onglet === "produits" && (
          <Bouton icone={Plus} onClick={() => setProduitEdite("nouveau")}>Nouvel article</Bouton>
        )}
        {creationPossible && onglet === "packs" && (
          <Bouton icone={Plus} onClick={() => setPackEdite("nouveau")}>Nouveau pack</Bouton>
        )}
        {creationPossible && onglet === "categories" && (
          <Bouton icone={Plus} onClick={() => setCategorieNouvelle(true)}>Nouvelle catégorie</Bouton>
        )}
      </PageHeader>

      <Erreur message={erreur} />

      {modifiable && pourEcriture === null && (
        <BandeauChoisirEtablissement action="créer un article, un pack ou une catégorie" />
      )}

      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {onglets.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              onglet === o.cle
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            <o.icone className="h-4 w-4" />
            {o.label}
            <span className="text-xs text-gray-400">({o.nb})</span>
          </button>
        ))}
      </div>

      {chargement ? (
        <Chargement />
      ) : onglet === "produits" ? (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Saisie
              value={recherche} onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un article…" className="pl-9"
            />
          </div>

          <Card>
            {produitsFiltres.length === 0 ? (
              <Vide titre="Aucun article ne correspond" icone={Package} />
            ) : (
              <Tableau
                entetes={["Article", "Catégorie", "Établissement", " Prix vente", " Prix achat", " Marge", " Stock", ""]}
              >
                {produitsFiltres.map((p) => {
                  const marge = p.prixVente - p.prixAchat;
                  return (
                    <tr key={p.id} className={cn("hover:bg-gray-50", !p.actif && "opacity-50")}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.nom}</div>
                        {p.kind === "prestation" && <span className="text-xs text-gray-500">Prestation</span>}
                        {!p.actif && <Badge ton="neutre">Retiré</Badge>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.categorieNom ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{nomDe(p.establishmentId)}</td>
                      <td className="px-4 py-3 text-right tabulaire font-medium text-amber-600 whitespace-nowrap">
                        {fcfa(p.prixVente)}
                      </td>
                      <td className="px-4 py-3 text-right tabulaire text-gray-600 whitespace-nowrap">
                        {p.prixAchat > 0 ? fcfa(p.prixAchat) : <span className="text-gray-400">à saisir</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabulaire whitespace-nowrap">
                        {p.prixAchat > 0
                          ? <span className={marge >= 0 ? "text-green-700" : "text-red-700"}>{fcfa(marge)}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabulaire">
                        {p.gereStock ? (
                          <span className={cn(
                            p.quantite <= 0 ? "text-red-600 font-medium"
                              : p.quantite <= p.seuilAlerte ? "text-amber-600 font-medium" : "text-gray-700"
                          )}>
                            {fmtQuantite(p.quantite)}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {modifiable && (
                          <button
                            onClick={() => setProduitEdite(p)}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Tableau>
            )}
          </Card>
        </>
      ) : onglet === "packs" ? (
        <Card>
          {packs.length === 0 ? (
            <Vide
              icone={Layers}
              titre="Aucun pack"
              description="Un pack regroupe plusieurs articles sous un prix unique, modifiable indépendamment de la somme de ses composants."
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {packs.map((p) => {
                const valeurComposants = (p.items ?? []).reduce(
                  (s, i) => s + (i.prixVente ?? 0) * i.quantite, 0
                );
                return (
                  <div key={p.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{p.nom}</h3>
                          {!p.actif && <Badge ton="neutre">Retiré</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          {(p.items ?? []).length} article(s) — {nomDe(p.establishmentId)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="font-bold text-amber-600 tabulaire">{fcfa(p.prixVente)}</p>
                          {valeurComposants > 0 && (
                            <p className="text-xs text-gray-500">
                              détail : {fcfa(valeurComposants)}
                              {valeurComposants > p.prixVente && (
                                <span className="text-green-600"> (−{fcfa(valeurComposants - p.prixVente)})</span>
                              )}
                            </p>
                          )}
                        </div>
                        {modifiable && (
                          <button
                            onClick={() => setPackEdite(p)}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                            title="Composer"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {(p.items ?? []).length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(p.items ?? []).map((i) => (
                          <span key={i.id} className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-700">
                            {i.produitNom} × {fmtQuantite(i.quantite)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-amber-700">
                        Composition non définie — le pack se vend au prix indiqué mais ne décrémentera
                        aucun stock tant qu'aucun article ne lui est rattaché.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <Tableau entetes={["Catégorie", "Établissement", "Type", " Ordre"]}>
            {categories.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{c.nom}</td>
                <td className="px-4 py-3 text-gray-600">{nomDe(c.establishmentId)}</td>
                <td className="px-4 py-3 text-gray-600">
                  {c.kind === "produit" ? "Produits" : "Prestations"}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 tabulaire">{c.ordre}</td>
              </tr>
            ))}
          </Tableau>
        </Card>
      )}

      <ModaleProduit
        cible={produitEdite}
        categories={categories}
        fournisseurs={fournisseurs}
        etablissementId={pourEcriture}
        libelleEtablissement={libelle}
        onFermer={() => setProduitEdite(null)}
        onSucces={() => { setProduitEdite(null); void recharger(); }}
      />
      <ModalePack
        cible={packEdite}
        produits={produits.filter((p) => p.actif)}
        etablissementId={pourEcriture}
        onFermer={() => setPackEdite(null)}
        onSucces={() => { setPackEdite(null); void recharger(); }}
      />
      <ModaleCategorie
        ouverte={categorieNouvelle}
        etablissementId={pourEcriture}
        libelleEtablissement={libelle}
        onFermer={() => setCategorieNouvelle(false)}
        onSucces={() => { setCategorieNouvelle(false); void recharger(); }}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function ModaleProduit({
  cible, categories, fournisseurs, etablissementId, libelleEtablissement, onFermer, onSucces,
}: {
  cible: Product | "nouveau" | null;
  categories: Category[];
  fournisseurs: Supplier[];
  etablissementId: number | null;
  libelleEtablissement: string;
  onFermer: () => void;
  onSucces: () => void;
}) {
  const nouveau = cible === "nouveau";
  const produit = nouveau ? null : cible;

  const [form, setForm] = useState({
    nom: "", kind: "produit", categoryId: "", prixVente: "", prixAchat: "",
    unite: "unité", gereStock: true, seuilAlerte: "0", supplierId: "", actif: true, motif: "",
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm(
      produit
        ? {
            nom: produit.nom, kind: produit.kind,
            categoryId: produit.categoryId ? String(produit.categoryId) : "",
            prixVente: String(produit.prixVente), prixAchat: String(produit.prixAchat),
            unite: produit.unite, gereStock: produit.gereStock,
            seuilAlerte: String(produit.seuilAlerte),
            supplierId: produit.supplierId ? String(produit.supplierId) : "",
            actif: produit.actif, motif: "",
          }
        : {
            nom: "", kind: "produit", categoryId: "", prixVente: "", prixAchat: "",
            unite: "unité", gereStock: true, seuilAlerte: "0", supplierId: "", actif: true, motif: "",
          }
    );
  }, [cible, produit]);

  if (!cible) return null;

  // Un changement de prix sur un article existant doit être motivé (§5.10).
  const prixModifie =
    !!produit &&
    (Number(form.prixVente) !== produit.prixVente || Number(form.prixAchat) !== produit.prixAchat);

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = {
        nom: form.nom.trim(),
        kind: form.kind as "produit" | "prestation",
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        prixVente: Number(form.prixVente) || 0,
        prixAchat: Number(form.prixAchat) || 0,
        unite: form.unite.trim() || "unité",
        gereStock: form.kind === "produit" && form.gereStock,
        seuilAlerte: Number(form.seuilAlerte) || 0,
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        actif: form.actif,
      };
      if (produit) {
        await modifierProduit(produit.id, { ...corps, motif: form.motif.trim() || undefined });
      } else {
        // L'établissement n'est pas modifiable après coup : des ventes et des
        // mouvements de stock y renvoient.
        await creerProduit({ ...corps, establishmentId: etablissementId as number });
      }
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  const marge = (Number(form.prixVente) || 0) - (Number(form.prixAchat) || 0);

  return (
    <Modale
      ouverte
      titre={nouveau ? "Nouvel article" : `Modifier — ${produit?.nom}`}
      onFermer={onFermer}
      taille="lg"
    >
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ label="Désignation">
            <Saisie value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} autoFocus />
          </Champ>
        </div>

        <Champ label="Établissement" aide="Défini par le sélecteur, en haut du menu.">
          <Saisie value={libelleEtablissement} disabled />
        </Champ>

        <Champ label="Catégorie">
          <Liste value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Sans catégorie</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Liste>
        </Champ>

        <Champ label="Type" aide="Une prestation ne consomme pas de stock.">
          <Liste value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="produit">Produit (stock suivi)</option>
            <option value="prestation">Prestation</option>
          </Liste>
        </Champ>

        <Champ label="Unité">
          <Saisie value={form.unite} onChange={(e) => setForm({ ...form, unite: e.target.value })} />
        </Champ>

        <Champ label="Prix de vente (FCFA)">
          <Saisie
            type="number" min={0} value={form.prixVente}
            onChange={(e) => setForm({ ...form, prixVente: e.target.value })}
          />
        </Champ>

        <Champ label="Prix d'achat (FCFA)" aide="Nécessaire au calcul de la marge (§5.13).">
          <Saisie
            type="number" min={0} value={form.prixAchat}
            onChange={(e) => setForm({ ...form, prixAchat: e.target.value })}
          />
        </Champ>

        {Number(form.prixAchat) > 0 && (
          <div className="sm:col-span-2 p-3 bg-gray-50 rounded-lg text-sm">
            Marge unitaire :{" "}
            <strong className={marge >= 0 ? "text-green-700" : "text-red-700"}>{fcfa(marge)}</strong>
            {Number(form.prixVente) > 0 && (
              <span className="text-gray-500">
                {" "}({Math.round((marge / Number(form.prixVente)) * 100)} % du prix de vente)
              </span>
            )}
          </div>
        )}

        {form.kind === "produit" && (
          <>
            <Champ label="Seuil d'alerte" aide="Déclenche l'alerte « bientôt en rupture ».">
              <Saisie
                type="number" min={0} value={form.seuilAlerte}
                onChange={(e) => setForm({ ...form, seuilAlerte: e.target.value })}
              />
            </Champ>
            <Champ label="Fournisseur habituel">
              <Liste value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">Non précisé</option>
                {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </Liste>
            </Champ>
          </>
        )}

        <div className="sm:col-span-2 flex flex-wrap gap-5">
          {form.kind === "produit" && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox" checked={form.gereStock}
                onChange={(e) => setForm({ ...form, gereStock: e.target.checked })}
                className="h-4 w-4 rounded accent-indigo-600"
              />
              Suivre le stock de cet article
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox" checked={form.actif}
              onChange={(e) => setForm({ ...form, actif: e.target.checked })}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            Disponible à la vente
          </label>
        </div>

        {prixModifie && (
          <div className="sm:col-span-2">
            <Champ
              label="Motif du changement de prix"
              aide="Conservé au journal avec l'ancien et le nouveau tarif."
            >
              <Saisie
                value={form.motif}
                onChange={(e) => setForm({ ...form, motif: e.target.value })}
                placeholder="Ex. : hausse du prix fournisseur"
              />
            </Champ>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton
          onClick={soumettre} chargement={envoi}
          disabled={!form.nom.trim() || form.prixVente === ""}
          className="flex-1"
        >
          {nouveau ? "Créer l'article" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}

function ModalePack({
  cible, produits, etablissementId, onFermer, onSucces,
}: {
  cible: Pack | "nouveau" | null;
  produits: Product[];
  etablissementId: number | null;
  onFermer: () => void;
  onSucces: () => void;
}) {
  const nouveau = cible === "nouveau";
  const pack = nouveau ? null : cible;

  const [nom, setNom] = useState("");
  const [prix, setPrix] = useState("");
  const [description, setDescription] = useState("");
  const [actif, setActif] = useState(true);
  const [composition, setComposition] = useState<{ productId: number; quantite: number }[]>([]);
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setRecherche("");
    setNom(pack?.nom ?? "");
    setPrix(pack ? String(pack.prixVente) : "");
    setDescription(pack?.description ?? "");
    setActif(pack?.actif ?? true);
    setComposition((pack?.items ?? []).map((i) => ({ productId: i.productId, quantite: i.quantite })));
  }, [cible, pack]);

  if (!cible) return null;

  const parId = new Map(produits.map((p) => [p.id, p]));
  const valeurDetail = composition.reduce(
    (s, c) => s + (parId.get(c.productId)?.prixVente ?? 0) * c.quantite, 0
  );

  // On ne propose que les articles de l'établissement du pack : composer un
  // pack scolaire avec des sandwichs n'aurait aucun sens.
  const etabDuPack = pack?.establishmentId ?? etablissementId;
  const resultats = recherche.trim()
    ? produits
        .filter((p) => p.establishmentId === etabDuPack)
        .filter((p) => p.nom.toLowerCase().includes(recherche.trim().toLowerCase()))
        .filter((p) => !composition.some((c) => c.productId === p.id))
        .slice(0, 8)
    : [];

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = {
        nom: nom.trim(), prixVente: Number(prix) || 0,
        description: description.trim() || null, actif, items: composition,
      };
      if (pack) await modifierPack(pack.id, corps);
      else await creerPack({ ...corps, establishmentId: etablissementId as number });
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte titre={nouveau ? "Nouveau pack" : `Composer — ${pack?.nom}`} onFermer={onFermer} taille="lg">
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Nom du pack">
          <Saisie value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
        </Champ>
        <Champ label="Prix de vente (FCFA)" aide="Indépendant de la somme des articles.">
          <Saisie type="number" min={0} value={prix} onChange={(e) => setPrix(e.target.value)} />
        </Champ>
        <div className="sm:col-span-2">
          <Champ label="Description">
            <Zone value={description} onChange={(e) => setDescription(e.target.value)} />
          </Champ>
        </div>
      </div>

      <div className="mt-5 pt-5 border-t border-gray-200">
        <h3 className="font-medium text-gray-900 mb-3">Composition</h3>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Saisie
            value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder="Ajouter un article au pack…" className="pl-9"
          />
        </div>

        {resultats.length > 0 && (
          <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
            {resultats.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setComposition([...composition, { productId: p.id, quantite: 1 }]);
                  setRecherche("");
                }}
                className="w-full flex justify-between items-center px-3 py-2 text-sm text-left hover:bg-gray-50"
              >
                <span className="text-gray-900">{p.nom}</span>
                <span className="text-gray-500 tabulaire">{fcfa(p.prixVente)}</span>
              </button>
            ))}
          </div>
        )}

        {composition.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Aucun article. Un pack sans composition se vend au prix indiqué mais ne décrémente
            aucun stock.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {composition.map((c) => {
              const p = parId.get(c.productId);
              return (
                <div key={c.productId} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                  <span className="flex-1 text-sm text-gray-900 truncate">
                    {p?.nom ?? `Article ${c.productId}`}
                  </span>
                  <Saisie
                    type="number" min={1} value={c.quantite}
                    onChange={(e) =>
                      setComposition(composition.map((x) =>
                        x.productId === c.productId ? { ...x, quantite: Number(e.target.value) || 1 } : x
                      ))
                    }
                    className="w-20 py-1.5 text-center"
                  />
                  <span className="w-24 text-right text-sm text-gray-600 tabulaire">
                    {fcfa((p?.prixVente ?? 0) * c.quantite)}
                  </span>
                  <button
                    onClick={() => setComposition(composition.filter((x) => x.productId !== c.productId))}
                    className="text-gray-400 hover:text-red-600 text-sm px-1"
                    aria-label="Retirer"
                  >
                    ✕
                  </button>
                </div>
              );
            })}

            <div className="flex justify-between items-baseline pt-2 text-sm">
              <span className="text-gray-600">Valeur au détail</span>
              <span className="tabulaire font-medium">{fcfa(valeurDetail)}</span>
            </div>
            {Number(prix) > 0 && valeurDetail > 0 && (
              <div className="flex justify-between items-baseline text-sm">
                <span className="text-gray-600">Avantage client</span>
                <span className={cn(
                  "tabulaire font-medium",
                  valeurDetail >= Number(prix) ? "text-green-700" : "text-red-700"
                )}>
                  {fcfa(valeurDetail - Number(prix))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
        <input
          type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)}
          className="h-4 w-4 rounded accent-indigo-600"
        />
        Disponible à la vente
      </label>

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!nom.trim() || prix === ""} className="flex-1">
          {nouveau ? "Créer le pack" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}

function ModaleCategorie({
  ouverte, etablissementId, libelleEtablissement, onFermer, onSucces,
}: {
  ouverte: boolean;
  etablissementId: number | null;
  libelleEtablissement: string;
  onFermer: () => void;
  onSucces: () => void;
}) {
  const [nom, setNom] = useState("");
  const [kind, setKind] = useState("produit");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await creerCategorie({
        nom: nom.trim(),
        establishmentId: etablissementId as number,
        kind: kind as "produit" | "prestation",
      });
      setNom("");
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouverte} titre="Nouvelle catégorie" onFermer={onFermer}>
      <Erreur message={erreur} />
      <div className="space-y-4">
        <Champ label="Nom de la catégorie">
          <Saisie value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
        </Champ>
        <Champ label="Établissement" aide="Défini par le sélecteur, en haut du menu.">
          <Saisie value={libelleEtablissement} disabled />
        </Champ>
        <Champ label="Type">
          <Liste value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="produit">Produits</option>
            <option value="prestation">Prestations</option>
          </Liste>
        </Champ>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!nom.trim()} className="w-full">
          Créer la catégorie
        </Bouton>
      </div>
    </Modale>
  );
}
