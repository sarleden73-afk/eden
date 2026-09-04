import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes, AlertTriangle, PackageX, Search, ClipboardCheck, History, ArrowRight, Truck,
} from "lucide-react";
import {
  Card, Bouton, Saisie, Liste, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide, StatCard, BoutonsExport,
} from "../components/ui";
import {
  getProduits, getMouvementsStock, ajusterStock, getDerniersAchats, type DernierAchat,
} from "../services/db";
import { fcfa, quantite as fmtQuantite, dateHeure, dateCourte } from "../lib/format";
import { exporterListePDF, exporterListeCSV } from "../lib/export";
import { cn } from "../lib/utils";
import type { Product, StockMovement } from "../types";
import { useEtablissement } from "../contexts/EtablissementContext";
import { useAuth } from "../contexts/AuthContext";
import Aide from "../components/Aide";

type Onglet = "etat" | "mouvements";

/**
 * §5.5 État du stock, alertes, inventaire et mouvements.
 *
 * Panneau de l'écran Approvisionnement, et non page autonome : le stock ne se
 * lit pas indépendamment de ce qui le remplit. Voir Approvisionnement.tsx.
 */
export function PanneauStock({ onCommander }: { onCommander?: (p: Product) => void }) {
  const { peut } = useAuth();
  const { selection, libelle, nomDe } = useEtablissement();
  const peutAjuster = peut("admin", "responsable");

  const [onglet, setOnglet] = useState<Onglet>("etat");
  const [produits, setProduits] = useState<Product[]>([]);
  const [mouvements, setMouvements] = useState<StockMovement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [recherche, setRecherche] = useState("");

  const [filtreAlerte, setFiltreAlerte] = useState<"" | "rupture" | "bas">("");
  const [aAjuster, setAAjuster] = useState<Product | null>(null);
  const [derniersAchats, setDerniersAchats] = useState<Record<string, DernierAchat>>({});

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const [p, m, achats] = await Promise.all([
        getProduits(selection),
        getMouvementsStock(selection),
        // L'échec ne doit pas vider l'écran : sans les derniers achats, le
        // stock reste lisible, il est seulement moins renseigné.
        getDerniersAchats(selection).catch(() => ({})),
      ]);
      // Seuls les articles réellement suivis ont leur place ici.
      setProduits(p.filter((x) => x.gereStock));
      setMouvements(m);
      setDerniersAchats(achats);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const ruptures = produits.filter((p) => p.quantite <= 0);
  const bas = produits.filter((p) => p.quantite > 0 && p.quantite <= p.seuilAlerte);

  // §5.13 : la valeur du stock au prix d'achat entre dans le résultat.
  const valeurStock = produits.reduce((s, p) => s + p.quantite * p.prixAchat, 0);

  const affiches = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return produits.filter((p) => {

      if (terme && !p.nom.toLowerCase().includes(terme)) return false;
      if (filtreAlerte === "rupture" && p.quantite > 0) return false;
      if (filtreAlerte === "bas" && !(p.quantite > 0 && p.quantite <= p.seuilAlerte)) return false;
      return true;
    });
  }, [produits, recherche, filtreAlerte]);

  const exporter = (format: "pdf" | "csv") =>
    (format === "pdf" ? exporterListePDF : exporterListeCSV)(
      "stocks-eden",
      ["Article", "Catégorie", "Pôle", "Quantité", "Unité", "Seuil d'alerte", "Prix d'achat", "Valeur du stock", "État"],
      affiches.map((p) => [
        p.nom, p.categorieNom ?? "", nomDe(p.establishmentId), p.quantite, p.unite,
        p.seuilAlerte, p.prixAchat, p.quantite * p.prixAchat,
        p.quantite <= 0 ? "Rupture" : p.quantite <= p.seuilAlerte ? "Stock bas" : "Normal",
      ])
    );

  return (
    <>
      <div className="flex justify-end mb-4">
        <BoutonsExport
          onPdf={() => exporter("pdf")}
          onCsv={() => exporter("csv")}
          desactive={!affiches.length}
        />
      </div>

      <Erreur message={erreur} />

      <Aide cle="stocks">
        <p>
          Les quantités baissent toutes seules à chaque vente. Un <strong>ajustement</strong> ne sert
          qu'à corriger un écart constaté physiquement — casse, perte, erreur de comptage — et il
          est tracé dans le journal avec son motif.
        </p>
        <p>
          Le <strong>seuil d'alerte</strong> déclenche le compteur du menu. Réglez-le sur ce qu'il
          faut vendre le temps d'être réapprovisionné, pas sur zéro.
        </p>
      </Aide>

      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <StatCard
          titre="Articles en rupture" valeur={ruptures.length} icone={PackageX}
          ton={ruptures.length ? "danger" : "neutre"}
          detail={ruptures.length ? "Vente bloquée sur ces articles" : "Aucune rupture"}
        />
        <StatCard
          titre="Bientôt en rupture" valeur={bas.length} icone={AlertTriangle}
          ton={bas.length ? "danger" : "neutre"} detail="Sous le seuil d'alerte"
        />
        <StatCard
          titre="Valeur du stock" valeur={fcfa(valeurStock)} icone={Boxes}
          detail="Au prix d'achat"
        />
      </div>

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([["etat", "État du stock", Boxes], ["mouvements", "Mouvements", History]] as const).map(
          ([cle, label, Icone]) => (
            <button
              key={cle}
              onClick={() => setOnglet(cle)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                onglet === cle
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              )}
            >
              <Icone className="h-4 w-4" />{label}
            </button>
          )
        )}
      </div>

      {chargement ? (
        <Chargement />
      ) : onglet === "etat" ? (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Saisie
                value={recherche} onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher un article…" className="pl-9"
              />
            </div>
            <Liste
              value={filtreAlerte}
              onChange={(e) => setFiltreAlerte(e.target.value as "" | "rupture" | "bas")}
              className="w-auto"
            >
              <option value="">Tous les états</option>
              <option value="rupture">En rupture</option>
              <option value="bas">Stock bas</option>
            </Liste>
          </div>

          <Card>
            {affiches.length === 0 ? (
              <Vide
                icone={Boxes}
                titre="Aucun article suivi ne correspond"
                description="Les prestations et les préparations ne tiennent pas de stock : elles n'apparaissent pas ici."
              />
            ) : (
              <Tableau
                entetes={["Article", "Pôle", " Quantité", " Seuil", " Valeur", "Dernier achat", "État", ""]}
              >
                {affiches.map((p) => {
                  const rupture = p.quantite <= 0;
                  const bas = !rupture && p.quantite <= p.seuilAlerte;
                  const dernier = derniersAchats[p.id];
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.nom}</div>
                        <div className="text-xs text-gray-500">{p.categorieNom ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{nomDe(p.establishmentId)}</td>
                      <td className="px-4 py-3 text-right tabulaire font-medium whitespace-nowrap">
                        <span className={cn(rupture && "text-red-600", bas && "text-amber-600")}>
                          {fmtQuantite(p.quantite)}
                        </span>
                        <span className="text-gray-400 text-xs ml-1">{p.unite}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabulaire text-gray-500">{fmtQuantite(p.seuilAlerte)}</td>
                      <td className="px-4 py-3 text-right tabulaire text-gray-600 whitespace-nowrap">
                        {p.prixAchat > 0 ? fcfa(p.quantite * p.prixAchat) : <span className="text-gray-400">—</span>}
                      </td>
                      {/* Le lien avec les achats : devant une rupture, savoir
                          quand on a commandé pour la dernière fois évite de
                          repasser commande d'une marchandise déjà en route. */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {dernier ? (
                          <>
                            <div className="text-gray-700">{dateCourte(dernier.date)}</div>
                            <div className="text-xs text-gray-500">
                              {dernier.fournisseur ?? "Sans fournisseur"} · {fcfa(dernier.prixUnitaire)}
                            </div>
                            {dernier.restantDu > 0 && (
                              <div className="text-xs text-red-700">
                                Reste dû {fcfa(dernier.restantDu)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400 text-xs">Jamais acheté ici</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {rupture ? <Badge ton="danger">Rupture</Badge>
                          : bas ? <Badge ton="alerte">Stock bas</Badge>
                          : <Badge ton="succes">Normal</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {onCommander && (rupture || bas) && (
                            <button
                              onClick={() => onCommander(p)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                              title="Commander cet article chez un fournisseur"
                            >
                              <Truck className="h-4 w-4" />
                              Commander
                            </button>
                          )}
                          {peutAjuster && (
                            <button
                              onClick={() => setAAjuster(p)}
                              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                              title="Ajuster après inventaire"
                            >
                              <ClipboardCheck className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Tableau>
            )}
          </Card>
        </>
      ) : (
        <Card>
          {mouvements.length === 0 ? (
            <Vide icone={History} titre="Aucun mouvement enregistré" />
          ) : (
            <Tableau entetes={["Date", "Article", "Type", " Quantité", " Avant → Après", "Motif", "Par"]}>
              {mouvements.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(m.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.produitNom ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge ton={m.type === "entree" ? "succes" : m.type === "sortie" ? "info" : "alerte"}>
                      {m.type === "entree" ? "Entrée" : m.type === "sortie" ? "Sortie" : "Ajustement"}
                    </Badge>
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right tabulaire font-medium whitespace-nowrap",
                    m.quantite >= 0 ? "text-green-700" : "text-red-700"
                  )}>
                    {m.quantite >= 0 ? "+" : "−"} {fmtQuantite(Math.abs(m.quantite))}
                  </td>
                  <td className="px-4 py-3 text-right tabulaire text-gray-500 whitespace-nowrap">
                    {fmtQuantite(m.quantiteAvant)}
                    <ArrowRight className="inline h-3 w-3 mx-1 text-gray-400" />
                    {fmtQuantite(m.quantiteApres)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{m.motif ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.createdByNom ?? "—"}</td>
                </tr>
              ))}
            </Tableau>
          )}
        </Card>
      )}

      <ModaleInventaire
        produit={aAjuster}
        onFermer={() => setAAjuster(null)}
        onSucces={() => { setAAjuster(null); void recharger(); }}
      />
    </>
  );
}

/**
 * Ajustement d'inventaire. La quantité ne se modifie jamais « à la main » dans
 * la fiche article : elle se corrige ici, avec un motif obligatoire, et l'écart
 * est écrit au journal des mouvements.
 */
function ModaleInventaire({
  produit, onFermer, onSucces,
}: { produit: Product | null; onFermer: () => void; onSucces: () => void }) {
  const [reelle, setReelle] = useState("");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    setReelle(produit ? String(produit.quantite) : "");
    setMotif("");
    setErreur(null);
  }, [produit]);

  if (!produit) return null;

  const ecart = reelle === "" ? 0 : Number(reelle) - produit.quantite;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await ajusterStock({
        productId: produit.id, quantiteReelle: Number(reelle) || 0, motif: motif.trim(),
      });
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Ajustement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte titre={`Inventaire — ${produit.nom}`} onFermer={onFermer}>
      <Erreur message={erreur} />

      <div className="p-3 mb-4 bg-gray-50 rounded-lg flex justify-between text-sm">
        <span className="text-gray-600">Quantité enregistrée</span>
        <span className="font-medium tabulaire">{fmtQuantite(produit.quantite)} {produit.unite}</span>
      </div>

      <div className="space-y-4">
        <Champ label={`Quantité réellement comptée (${produit.unite})`}>
          <Saisie
            type="number" min={0} step="any" value={reelle}
            onChange={(e) => setReelle(e.target.value)} autoFocus
          />
        </Champ>

        {ecart !== 0 && reelle !== "" && (
          <div className={cn(
            "p-3 rounded-lg border text-sm",
            ecart > 0 ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900"
          )}>
            Écart de <strong>{ecart > 0 ? "+" : "−"} {fmtQuantite(Math.abs(ecart))} {produit.unite}</strong>
            {ecart > 0 ? " (excédent)" : " (manquant)"}
            {produit.prixAchat > 0 && (
              <span> — soit {fcfa(Math.abs(ecart) * produit.prixAchat)} au prix d'achat.</span>
            )}
          </div>
        )}

        <Champ label="Motif" aide="Obligatoire. Un écart de stock non expliqué est un signal d'alerte.">
          <Zone
            value={motif} onChange={(e) => setMotif(e.target.value)}
            placeholder="Ex. : inventaire mensuel, casse, article périmé, erreur de réception…"
          />
        </Champ>

        <Bouton
          onClick={soumettre} chargement={envoi}
          disabled={!motif.trim() || reelle === "" || ecart === 0}
          icone={ClipboardCheck} className="w-full"
        >
          {ecart === 0 ? "Aucun écart à enregistrer" : "Valider l'ajustement"}
        </Bouton>
      </div>
    </Modale>
  );
}
