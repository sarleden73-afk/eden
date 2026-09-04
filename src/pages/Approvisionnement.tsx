import { useCallback, useEffect, useState } from "react";
import { Boxes, Truck, TrendingDown, PackageX } from "lucide-react";
import Layout from "../components/Layout";
import { PageHeader, StatCard, Erreur } from "../components/ui";
import Aide from "../components/Aide";
import { PanneauStock } from "./Stocks";
import { PanneauAchats } from "./Achats";
import { getProduits, getAchats } from "../services/db";
import { fcfa } from "../lib/format";
import { cn } from "../lib/utils";
import { useEtablissement } from "../contexts/EtablissementContext";
import { useAuth } from "../contexts/AuthContext";

/**
 * Approvisionnement : ce qui entre, et ce qu'il en reste.
 *
 * Le stock et les achats étaient deux écrans séparés, alors qu'ils décrivent
 * un seul mouvement : on achète chez un fournisseur, la marchandise entre en
 * stock, et le prix payé devient le prix d'achat qui sert à calculer la marge.
 * Séparés, il fallait faire ce lien de tête — et deviner, devant une rupture,
 * si une commande fournisseur était déjà partie.
 *
 * Réunis, les quatre chiffres du haut se lisent ensemble : ce qui manque, ce
 * que vaut le stock, ce qu'on a acheté, et ce qu'on doit encore.
 */
type Onglet = "stock" | "achats";

const ONGLETS: { cle: Onglet; label: string; icone: typeof Boxes; detail: string }[] = [
  { cle: "stock", label: "Stock", icone: Boxes, detail: "État, alertes, inventaire et mouvements" },
  { cle: "achats", label: "Achats et fournisseurs", icone: Truck, detail: "Commandes, réceptions et dettes" },
];

export default function Approvisionnement() {
  const { selection, libelle } = useEtablissement();
  const { profil } = useAuth();

  // Réunir deux écrans ne doit pas réunir leurs droits : le personnel de
  // terrain consulte le stock sans voir les achats, leurs prix ni les dettes
  // fournisseurs. L'API refuse de toute façon ces routes, mais afficher un
  // onglet qui ne renvoie que des refus serait une promesse en l'air.
  const voitLesAchats = !!profil?.ecrans.includes("achats");
  const [onglet, setOnglet] = useState<Onglet>("stock");
  const ongletsVisibles = ONGLETS.filter((o) => o.cle !== "achats" || voitLesAchats);
  const actif = onglet === "achats" && !voitLesAchats ? "stock" : onglet;

  // Les compteurs du haut ne dépendent pas de l'onglet ouvert : le stock
  // manquant reste visible pendant qu'on saisit un achat, et le restant dû
  // pendant qu'on regarde une rupture. C'est tout l'intérêt de les réunir.
  const [ruptures, setRuptures] = useState(0);
  const [valeurStock, setValeurStock] = useState(0);
  const [achatsTotal, setAchatsTotal] = useState(0);
  const [restantDu, setRestantDu] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [produits, achats] = await Promise.all([
        getProduits(selection),
        // Ne pas même demander les achats à qui n'y a pas droit : la requête
        // serait refusée, et l'écran afficherait une erreur pour un compteur
        // qu'on ne comptait de toute façon pas lui montrer.
        voitLesAchats ? getAchats("mois", { etablissement: selection }) : Promise.resolve([]),
      ]);
      const suivis = produits.filter((p) => p.gereStock);
      setRuptures(suivis.filter((p) => p.quantite <= 0).length);
      setValeurStock(suivis.reduce((s, p) => s + p.quantite * p.prixAchat, 0));
      setAchatsTotal(achats.reduce((s, a) => s + a.montantTotal, 0));
      setRestantDu(achats.reduce((s, a) => s + a.montantRestant, 0));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [selection, voitLesAchats]);

  useEffect(() => { void recharger(); }, [recharger]);

  return (
    <Layout>
      <PageHeader
        titre="Approvisionnement"
        sousTitre={`${libelle} — du fournisseur au rayon`}
      />

      <Erreur message={erreur} />

      <Aide cle="approvisionnement">
        <p>
          Un achat réceptionné <strong>entre directement en stock</strong> et fixe le prix d'achat
          de l'article. C'est ce prix qui sert à calculer la marge en comptabilité : tant qu'un
          article n'a jamais été acheté ici, sa marge affichée vaut son prix de vente entier, et le
          résultat est surévalué.
        </p>
        <p>
          Les quatre chiffres du haut restent affichés quel que soit l'onglet : devant une rupture,
          on voit tout de suite si un achat est déjà parti et ce qu'il reste à régler.
        </p>
      </Aide>

      <div className={cn(
        "grid gap-4 sm:grid-cols-2 mb-5",
        voitLesAchats ? "lg:grid-cols-4" : "lg:grid-cols-2"
      )}>
        <StatCard
          titre="Articles en rupture"
          valeur={ruptures}
          icone={PackageX}
          ton={ruptures ? "danger" : "neutre"}
          detail={ruptures ? "À commander" : "Aucune rupture"}
        />
        <StatCard
          titre="Valeur du stock"
          valeur={fcfa(valeurStock)}
          icone={Boxes}
          detail="Au prix d'achat"
        />
        {voitLesAchats && (
          <>
            <StatCard
              titre="Achats du mois"
              valeur={fcfa(achatsTotal)}
              icone={Truck}
            />
            <StatCard
              titre="Restant dû"
              valeur={fcfa(restantDu)}
              icone={TrendingDown}
              ton={restantDu > 0 ? "danger" : "neutre"}
              detail={restantDu > 0 ? "Aux fournisseurs" : "Tout est réglé"}
            />
          </>
        )}
      </div>

      {/* Un seul onglet visible n'est pas un choix : on n'affiche la barre que
          si elle sert à quelque chose. */}
      {ongletsVisibles.length > 1 && (
        <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
          {ongletsVisibles.map((o) => (
            <button
              key={o.cle}
              onClick={() => setOnglet(o.cle)}
              title={o.detail}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px",
                "whitespace-nowrap transition-colors",
                actif === o.cle
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-gray-500 hover:text-gray-900"
              )}
            >
              <o.icone className="h-4 w-4" />
              {o.label}
            </button>
          ))}
        </div>
      )}

      {actif === "stock" ? <PanneauStock /> : <PanneauAchats />}
    </Layout>
  );
}
