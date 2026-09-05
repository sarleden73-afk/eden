import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Check, Printer, Package, FileText,
  ChevronUp, Wallet,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Erreur, Chargement, Badge, Modale, Vide,
  BandeauChoisirEtablissement,
} from "../components/ui";
import { getProduits, getPacks, getCaisseCourante, enregistrerVente } from "../services/db";
import { fcfa, nombre, dateHeure } from "../lib/format";
import { genererDocument, entrepriseCourante } from "../lib/facture";
import { cn } from "../lib/utils";
import { useEtablissement } from "../contexts/EtablissementContext";
import { PAYMENT_LABELS, type Product, type Pack, type PaymentMethod } from "../types";

interface LignePanier {
  cle: string;
  productId?: number;
  packId?: number;
  libelle: string;
  prixUnitaire: number;
  quantite: number;
  /** Stock disponible, pour empêcher de dépasser au comptoir. null = non suivi. */
  stockDisponible: number | null;
}

interface TicketEmis {
  numeroRecu: string;
  total: number;
  lignes: LignePanier[];
  remise: number;
  paiement: PaymentMethod;
  etablissement: string;
  date: string;
}

/**
 * §5.2 Enregistrement des ventes.
 *
 * L'établissement vient du sélecteur global : on ne vend jamais « chez tous »,
 * et le catalogue affiché est celui de l'établissement courant, ce qui rend
 * impossible d'encaisser un sandwich sur la caisse de la papeterie.
 *
 * Pas de rattachement client : une imprimerie et un restaurant encaissent au
 * comptoir, sans fiche client à tenir. Les commandes infographie, elles,
 * gardent le nom et le téléphone du donneur d'ordre — c'est là qu'il sert.
 */
export default function Vente() {
  const naviguer = useNavigate();
  const { pourEcriture, libelle, courant, chargement: chargementEtab } = useEtablissement();

  const [produits, setProduits] = useState<Product[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [caisseOuverte, setCaisseOuverte] = useState<boolean | null>(null);
  const [chargement, setChargement] = useState(true);

  const [recherche, setRecherche] = useState("");
  const [categorieActive, setCategorieActive] = useState("");
  const [panier, setPanier] = useState<LignePanier[]>([]);

  const [remise, setRemise] = useState("");
  const [paiement, setPaiement] = useState<PaymentMethod>("especes");
  const [numeroTransaction, setNumeroTransaction] = useState("");

  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [ticket, setTicket] = useState<TicketEmis | null>(null);
  /** Feuille du panier sur mobile : l'écran est trop étroit pour deux colonnes. */
  const [panierOuvert, setPanierOuvert] = useState(false);

  const champRecherche = useRef<HTMLInputElement>(null);

  // Changer d'établissement vide le panier : garder des articles d'une autre
  // entité dans le ticket courant serait la meilleure façon de fausser les deux.
  useEffect(() => {
    if (chargementEtab || pourEcriture === null) { setChargement(false); return; }

    let annule = false;
    setChargement(true);
    setPanier([]);
    setCategorieActive("");

    Promise.all([
      getProduits(pourEcriture),
      getPacks(pourEcriture),
      getCaisseCourante(pourEcriture),
    ])
      .then(([p, pk, caisse]) => {
        if (annule) return;
        setProduits(p);
        setPacks(pk.filter((x) => x.actif));
        setCaisseOuverte(caisse !== null);
        setErreur(null);
      })
      .catch((e) => { if (!annule) setErreur(e.message); })
      .finally(() => { if (!annule) setChargement(false); });

    return () => { annule = true; };
  }, [pourEcriture, chargementEtab]);

  const categories = useMemo(() => {
    const noms = new Set(produits.map((p) => p.categorieNom).filter(Boolean) as string[]);
    return [...noms].sort();
  }, [produits]);

  const produitsAffiches = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return produits.filter(
      (p) =>
        (!categorieActive || p.categorieNom === categorieActive) &&
        (!terme || p.nom.toLowerCase().includes(terme))
    );
  }, [produits, recherche, categorieActive]);

  const packsAffiches = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (categorieActive) return [];
    return packs.filter((p) => !terme || p.nom.toLowerCase().includes(terme));
  }, [packs, recherche, categorieActive]);

  // --- Panier --------------------------------------------------------------

  const ajouter = (ligne: Omit<LignePanier, "quantite">) => {
    setErreur(null);
    setPanier((actuel) => {
      const existante = actuel.find((l) => l.cle === ligne.cle);
      if (existante) {
        return actuel.map((l) => (l.cle === ligne.cle ? { ...l, quantite: l.quantite + 1 } : l));
      }
      return [...actuel, { ...ligne, quantite: 1 }];
    });
  };

  const changerQuantite = (cle: string, delta: number) =>
    setPanier((actuel) =>
      actuel
        .map((l) => (l.cle === cle ? { ...l, quantite: l.quantite + delta } : l))
        .filter((l) => l.quantite > 0)
    );

  const retirer = (cle: string) => setPanier((a) => a.filter((l) => l.cle !== cle));

  const sousTotal = panier.reduce((s, l) => s + l.prixUnitaire * l.quantite, 0);
  const remiseNum = Math.min(Math.max(0, Number(remise) || 0), sousTotal);
  const total = sousTotal - remiseNum;
  const nbArticles = panier.reduce((s, l) => s + l.quantite, 0);

  // Le dépassement est bloqué ici *et* par l'API : l'écran évite au caissier une
  // erreur au moment de valider, l'API garantit la règle.
  const lignesEnDepassement = panier.filter(
    (l) => l.stockDisponible !== null && l.quantite > l.stockDisponible
  );

  const valider = async () => {
    if (pourEcriture === null) return;
    setErreur(null);
    setEnvoi(true);
    try {
      const resultat = await enregistrerVente({
        establishmentId: pourEcriture,
        items: panier.map((l) => ({
          productId: l.productId, packId: l.packId, quantite: l.quantite,
        })),
        paymentMethod: paiement,
        numeroTransaction: numeroTransaction.trim() || undefined,
        remise: remiseNum,
      });

      setTicket({
        numeroRecu: resultat.numeroRecu,
        total: resultat.total,
        lignes: panier,
        remise: remiseNum,
        paiement,
        etablissement: libelle,
        date: new Date().toISOString(),
      });

      setPanier([]);
      setRemise("");
      setNumeroTransaction("");
      setRecherche("");
      setPanierOuvert(false);
      // Le stock affiché a changé : on le recharge sans bloquer l'écran.
      getProduits(pourEcriture).then(setProduits).catch(() => {});
      champRecherche.current?.focus();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
      setPanierOuvert(true);
    } finally {
      setEnvoi(false);
    }
  };

  const contenuPanier = (
    <PanierVente
      panier={panier}
      sousTotal={sousTotal}
      remise={remise}
      setRemise={setRemise}
      total={total}
      paiement={paiement}
      setPaiement={setPaiement}
      numeroTransaction={numeroTransaction}
      setNumeroTransaction={setNumeroTransaction}
      onChangerQuantite={changerQuantite}
      onRetirer={retirer}
      onVider={() => setPanier([])}
      onValider={valider}
      envoi={envoi}
      bloque={lignesEnDepassement.length > 0}
      couleur={courant?.couleur}
    />
  );

  return (
    <Layout>
      <PageHeader titre="Vendre" sousTitre={`Encaissement — ${libelle}`} />

      <Erreur message={erreur} />

      {pourEcriture === null ? (
        <BandeauChoisirEtablissement action="enregistrer une vente" />
      ) : (
        <>
          {/* La caisse n'est plus un préalable : simple rappel, pas un blocage. */}
          {caisseOuverte === false && (
            <div className="flex flex-wrap items-center gap-3 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg">
              <Wallet className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-900 flex-1 min-w-[220px]">
                La caisse de {libelle} n'est pas ouverte. Vous pouvez vendre, mais ces ventes
                n'entreront pas dans le rapprochement de fin de journée.
              </p>
              <Bouton variante="secondaire" onClick={() => naviguer("/caisse")} className="py-1.5">
                Ouvrir la caisse
              </Bouton>
            </div>
          )}

          {chargement ? (
            <Chargement texte="Chargement du catalogue…" />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
              {/* ================= Catalogue ================= */}
              <div className="space-y-4 min-w-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Saisie
                    ref={champRecherche}
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    placeholder="Rechercher un article ou une prestation…"
                    className="pl-9"
                    autoFocus
                  />
                </div>

                {categories.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {["", ...categories].map((c) => (
                      <button
                        key={c || "__tout"}
                        onClick={() => setCategorieActive(c)}
                        className={cn(
                          "px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap border shrink-0 transition-colors",
                          categorieActive === c
                            ? "bg-indigo-600 text-[#fff] border-indigo-600"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        )}
                      >
                        {c || "Tout"}
                      </button>
                    ))}
                  </div>
                )}

                {produitsAffiches.length === 0 && packsAffiches.length === 0 ? (
                  <Card>
                    <Vide
                      titre="Aucun article ne correspond"
                      description={`Le catalogue affiché est celui de ${libelle}.`}
                      icone={Package}
                    />
                  </Card>
                ) : (
                  <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                    {packsAffiches.map((p) => (
                      <button
                        key={`pack-${p.id}`}
                        onClick={() =>
                          ajouter({
                            cle: `pack-${p.id}`, packId: p.id, libelle: p.nom,
                            prixUnitaire: p.prixVente, stockDisponible: null,
                          })
                        }
                        className="text-left p-3 bg-white rounded-xl border-2 border-indigo-200 hover:border-indigo-500 active:scale-[0.98] transition-all"
                      >
                        <Badge ton="info">Pack</Badge>
                        <p className="mt-1.5 text-sm font-medium text-gray-900 line-clamp-2">{p.nom}</p>
                        <p className="mt-1 text-sm font-semibold text-amber-600 tabulaire">{fcfa(p.prixVente)}</p>
                      </button>
                    ))}

                    {produitsAffiches.map((p) => {
                      const enRupture = p.gereStock && p.quantite <= 0;
                      return (
                        <button
                          key={p.id}
                          onClick={() =>
                            ajouter({
                              cle: `prod-${p.id}`, productId: p.id, libelle: p.nom,
                              prixUnitaire: p.prixVente,
                              stockDisponible: p.gereStock ? p.quantite : null,
                            })
                          }
                          disabled={enRupture}
                          className={cn(
                            "text-left p-3 bg-white rounded-xl border transition-all",
                            enRupture
                              ? "border-gray-200 opacity-50 cursor-not-allowed"
                              : "border-gray-200 hover:border-indigo-500 active:scale-[0.98]"
                          )}
                        >
                          <p className="text-sm font-medium text-gray-900 line-clamp-2 min-h-[2.5rem]">{p.nom}</p>
                          <p className="mt-1 text-sm font-semibold text-amber-600 tabulaire">{fcfa(p.prixVente)}</p>
                          {p.gereStock ? (
                            <p className={cn("mt-0.5 text-xs", enRupture ? "text-red-600" : "text-gray-500")}>
                              {enRupture ? "Rupture" : `${nombre(p.quantite)} en stock`}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-xs text-gray-400">Prestation</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Marge de sécurité pour que la barre mobile ne masque rien. */}
                <div className="h-20 lg:hidden" />
              </div>

              {/* ============ Panier : colonne fixe sur grand écran ============ */}
              <div className="hidden lg:block">
                <div className="sticky top-0">{contenuPanier}</div>
              </div>
            </div>
          )}

          {/* ============ Panier : barre + feuille sur mobile ============ */}
          {!chargement && (
            <button
              onClick={() => setPanierOuvert(true)}
              className={cn(
                "lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-center gap-3 px-4 py-3",
                "bg-gray-950 text-[#fff] shadow-[0_-4px_16px_rgba(0,0,0,0.15)] sans-impression"
              )}
            >
              <span className="relative">
                <ShoppingCart className="h-5 w-5" />
                {nbArticles > 0 && (
                  <span className="absolute -top-1.5 -right-2 h-4 min-w-4 px-1 rounded-full bg-indigo-500 text-[10px] font-bold flex items-center justify-center">
                    {nbArticles}
                  </span>
                )}
              </span>
              <span className="flex-1 text-left text-sm">
                {panier.length === 0 ? "Panier vide" : `${nbArticles} article(s)`}
              </span>
              <span className="font-bold tabulaire">{fcfa(total)}</span>
              <ChevronUp className="h-4 w-4 text-gray-400" />
            </button>
          )}

          <Modale
            ouverte={panierOuvert}
            titre="Ticket en cours"
            onFermer={() => setPanierOuvert(false)}
          >
            {contenuPanier}
          </Modale>
        </>
      )}

      <ModaleTicket ticket={ticket} onFermer={() => setTicket(null)} />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

/**
 * Panier. Extrait dans son propre composant pour être rendu à l'identique dans
 * la colonne de droite sur grand écran et dans la feuille mobile — un seul
 * comportement à maintenir, pas deux.
 */
function PanierVente(props: {
  panier: LignePanier[];
  sousTotal: number;
  remise: string;
  setRemise: (v: string) => void;
  total: number;
  paiement: PaymentMethod;
  setPaiement: (v: PaymentMethod) => void;
  numeroTransaction: string;
  setNumeroTransaction: (v: string) => void;
  onChangerQuantite: (cle: string, delta: number) => void;
  onRetirer: (cle: string) => void;
  onVider: () => void;
  onValider: () => void;
  envoi: boolean;
  bloque: boolean;
  couleur?: string;
}) {
  const {
    panier, sousTotal, remise, setRemise, total, paiement, setPaiement,
    numeroTransaction, setNumeroTransaction,
    onChangerQuantite, onRetirer, onVider, onValider, envoi, bloque, couleur,
  } = props;

  return (
    <Card className="flex flex-col max-h-[calc(100vh-9rem)]">
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0"
        style={couleur ? { borderTopColor: couleur, borderTopWidth: 3 } : undefined}
      >
        <ShoppingCart className="h-4 w-4 text-gray-500" />
        <h2 className="font-semibold text-gray-900">Ticket en cours</h2>
        {panier.length > 0 && (
          <button onClick={onVider} className="ml-auto text-xs text-gray-500 hover:text-red-600">
            Vider
          </button>
        )}
      </div>

      {panier.length === 0 ? (
        <p className="px-4 py-10 text-sm text-center text-gray-500">
          Sélectionnez des articles pour composer le ticket.
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
          {panier.map((l) => {
            const depasse = l.stockDisponible !== null && l.quantite > l.stockDisponible;
            return (
              <div key={l.cle} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 flex-1">{l.libelle}</p>
                  <button
                    onClick={() => onRetirer(l.cle)}
                    className="p-1 -m-1 text-gray-400 hover:text-red-600"
                    aria-label={`Retirer ${l.libelle}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onChangerQuantite(l.cle, -1)}
                      className="p-2 rounded-md border border-gray-300 hover:bg-gray-50"
                      aria-label="Diminuer"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-10 text-center text-sm font-medium tabulaire">{l.quantite}</span>
                    <button
                      onClick={() => onChangerQuantite(l.cle, 1)}
                      className="p-2 rounded-md border border-gray-300 hover:bg-gray-50"
                      aria-label="Augmenter"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 tabulaire">
                    {fcfa(l.prixUnitaire * l.quantite)}
                  </span>
                </div>
                {depasse && (
                  <p className="mt-1.5 text-xs text-red-600">
                    Stock insuffisant : {nombre(l.stockDisponible!)} disponible(s).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {panier.length > 0 && (
        <div className="shrink-0 border-t border-gray-200 p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Sous-total</span>
            <span className="tabulaire">{fcfa(sousTotal)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Champ label="Remise (FCFA)">
              <Saisie
                type="number" min={0} max={sousTotal} value={remise}
                onChange={(e) => setRemise(e.target.value)}
                placeholder="0" className="py-2"
              />
            </Champ>
            <Champ label="Paiement">
              <Liste
                value={paiement}
                onChange={(e) => setPaiement(e.target.value as PaymentMethod)}
                className="py-2"
              >
                {Object.entries(PAYMENT_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </Liste>
            </Champ>
          </div>

          {paiement !== "especes" && (
            <Champ label="N° de transaction" aide="Référence Mobile Money ou bancaire">
              <Saisie
                value={numeroTransaction}
                onChange={(e) => setNumeroTransaction(e.target.value)}
                placeholder="Facultatif" className="py-2"
              />
            </Champ>
          )}

          <div className="flex justify-between items-baseline pt-2 border-t border-gray-200">
            <span className="font-semibold text-gray-900">Total</span>
            <span className="text-2xl font-bold text-amber-600 tabulaire">{fcfa(total)}</span>
          </div>

          <Bouton
            onClick={onValider}
            chargement={envoi}
            disabled={bloque}
            icone={Check}
            className="w-full py-3"
          >
            Encaisser {fcfa(total)}
          </Bouton>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ticket de caisse (§5.2 « Numéro de reçu »)
// ---------------------------------------------------------------------------

function ModaleTicket({ ticket, onFermer }: { ticket: TicketEmis | null; onFermer: () => void }) {
  const [editionFacture, setEditionFacture] = useState(false);

  if (!ticket) return null;

  const sousTotal = ticket.lignes.reduce((s, l) => s + l.prixUnitaire * l.quantite, 0);

  /**
   * Facture A4, à distinguer du ticket ci-dessus.
   *
   * Le ticket suffit au client qui repart avec son achat ; il ne suffit pas à
   * celui qui doit justifier une dépense. Les deux existent donc, et c'est le
   * client qui choisit.
   */
  const editerFacture = async () => {
    setEditionFacture(true);
    try {
      const entreprise = await entrepriseCourante();
      await genererDocument({
        nature: "facture",
        numero: ticket.numeroRecu,
        entreprise,
        etablissement: ticket.etablissement,
        dateOperation: ticket.date,
        lignes: ticket.lignes.map((l) => ({
          libelle: l.libelle,
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
          montant: l.prixUnitaire * l.quantite,
        })),
        remise: ticket.remise,
        moyenPaiement: PAYMENT_LABELS[ticket.paiement],
        note: "Merci de votre confiance.",
      });
    } finally {
      setEditionFacture(false);
    }
  };

  return (
    <Modale ouverte titre="Vente enregistrée" onFermer={onFermer}>
      <div className="flex items-center gap-3 p-3 mb-5 bg-green-50 border border-green-200 rounded-lg">
        <Check className="h-5 w-5 text-green-600 shrink-0" />
        <p className="text-sm text-green-900">
          Reçu <strong>{ticket.numeroRecu}</strong> — {fcfa(ticket.total)} encaissés.
        </p>
      </div>

      {/* Zone imprimable : la barre d'actions en est exclue (sans-impression). */}
      <div className="border border-gray-200 rounded-lg p-4 text-sm">
        <div className="text-center pb-3 border-b border-dashed border-gray-300">
          <p className="font-bold tracking-wide">{ticket.etablissement}</p>
          <p className="text-xs text-gray-500 mt-1.5">{ticket.numeroRecu}</p>
          <p className="text-xs text-gray-500">{dateHeure(ticket.date)}</p>
        </div>

        <div className="py-3 space-y-1.5 border-b border-dashed border-gray-300">
          {ticket.lignes.map((l) => (
            <div key={l.cle} className="flex justify-between gap-3">
              <span className="flex-1">
                {l.libelle}
                <span className="text-gray-500"> × {l.quantite}</span>
              </span>
              <span className="tabulaire">{fcfa(l.prixUnitaire * l.quantite)}</span>
            </div>
          ))}
        </div>

        <div className="pt-3 space-y-1">
          <div className="flex justify-between text-gray-600">
            <span>Sous-total</span><span className="tabulaire">{fcfa(sousTotal)}</span>
          </div>
          {ticket.remise > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Remise</span><span className="tabulaire">− {fcfa(ticket.remise)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base pt-1">
            <span>Total</span><span className="tabulaire">{fcfa(ticket.total)}</span>
          </div>
          <div className="flex justify-between text-gray-600 pt-1">
            <span>Paiement</span><span>{PAYMENT_LABELS[ticket.paiement]}</span>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">Merci de votre confiance.</p>
      </div>

      <div className="flex flex-wrap gap-2 mt-5 sans-impression">
        <Bouton variante="secondaire" icone={Printer} onClick={() => window.print()} className="flex-1">
          Ticket
        </Bouton>
        <Bouton
          variante="secondaire"
          icone={FileText}
          chargement={editionFacture}
          onClick={editerFacture}
          className="flex-1"
        >
          Facture
        </Bouton>
        <Bouton onClick={onFermer} className="w-full">Vente suivante</Bouton>
      </div>
    </Modale>
  );
}
