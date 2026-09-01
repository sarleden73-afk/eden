import { useCallback, useEffect, useState } from "react";
import {
  Truck, Plus, Search, Building2, Eye, Wallet, FileDown, Trash2,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide, StatCard, SelecteurPeriode,
} from "../components/ui";
import {
  getAchats, getAchat, creerAchat, reglerAchat,
  getFournisseurs, creerFournisseur, modifierFournisseur, getProduits,
} from "../services/db";
import { fcfa, dateCourte, quantite as fmtQuantite, aujourdhui } from "../lib/format";
import { exporterCSV } from "../lib/export";
import { cn } from "../lib/utils";
import { useEtablissement } from "../contexts/EtablissementContext";
import {
  PAYMENT_LABELS,
  type Purchase, type Supplier, type Product, type PeriodKey,
} from "../types";

type Onglet = "achats" | "fournisseurs";

/** §5.6 Achats et fournisseurs. */
export default function Achats() {
  const { selection, libelle, pourEcriture } = useEtablissement();
  const [onglet, setOnglet] = useState<Onglet>("achats");
  const [periode, setPeriode] = useState<PeriodKey>("mois");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());

  const [achats, setAchats] = useState<Purchase[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Supplier[]>([]);
  const [produits, setProduits] = useState<Product[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [nouvelAchat, setNouvelAchat] = useState(false);
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [aRegler, setARegler] = useState<Purchase | null>(null);
  const [fournisseurEdite, setFournisseurEdite] = useState<Supplier | "nouveau" | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const [a, f, p] = await Promise.all([
        getAchats(periode, { debut, fin, etablissement: selection }), getFournisseurs(), getProduits(selection),
      ]);
      setAchats(a); setFournisseurs(f); setProduits(p);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [periode, debut, fin, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const total = achats.reduce((s, a) => s + a.montantTotal, 0);
  const restant = achats.reduce((s, a) => s + a.montantRestant, 0);

  const exporter = () =>
    exporterCSV(
      "achats-eden",
      ["N°", "Date", "Fournisseur", "Établissement", "Montant total", "Payé", "Restant dû", "Paiement", "Par", "Justificatif"],
      achats.map((a) => [
        a.numero, dateCourte(a.dateAchat), a.fournisseurNom ?? "", a.etablissementNom ?? "—",
        a.montantTotal, a.montantPaye, a.montantRestant,
        PAYMENT_LABELS[a.paymentMethod], a.effectueParNom ?? "", a.justificatif ?? "",
      ])
    );

  return (
    <Layout>
      <PageHeader titre="Achats et fournisseurs" sousTitre={`${libelle} — approvisionnements, règlements et dettes`}>
        {onglet === "achats" && (
          <>
            <SelecteurPeriode
              periode={periode} debut={debut} fin={fin}
              onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
            />
            <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!achats.length}>
              Excel
            </Bouton>
            <Bouton icone={Plus} onClick={() => setNouvelAchat(true)} disabled={pourEcriture === null} title={pourEcriture === null ? "Choisissez d'abord un établissement" : undefined}>Nouvel achat</Bouton>
          </>
        )}
        {onglet === "fournisseurs" && (
          <Bouton icone={Plus} onClick={() => setFournisseurEdite("nouveau")}>Nouveau fournisseur</Bouton>
        )}
      </PageHeader>

      <Erreur message={erreur} />

      {onglet === "achats" && (
        <div className="grid gap-4 sm:grid-cols-3 mb-5">
          <StatCard titre="Total des achats" valeur={fcfa(total)} icone={Truck} detail={`${achats.length} achat(s)`} />
          <StatCard titre="Déjà réglé" valeur={fcfa(total - restant)} icone={Wallet} ton="succes" />
          <StatCard
            titre="Restant dû" valeur={fcfa(restant)} icone={Wallet}
            ton={restant > 0 ? "danger" : "neutre"} detail="Dettes fournisseurs"
          />
        </div>
      )}

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([["achats", "Achats", Truck], ["fournisseurs", "Fournisseurs", Building2]] as const).map(
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
      ) : onglet === "achats" ? (
        <Card>
          {achats.length === 0 ? (
            <Vide
              icone={Truck} titre="Aucun achat sur cette période"
              description="Enregistrez vos approvisionnements pour alimenter le stock et suivre vos dettes fournisseurs."
            />
          ) : (
            <Tableau entetes={["N°", "Date", "Fournisseur", "Établissement", " Total", " Restant dû", "Par", ""]}>
              {achats.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{a.numero}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(a.dateAchat)}</td>
                  <td className="px-4 py-3 text-gray-700">{a.fournisseurNom ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{a.etablissementNom ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabulaire font-medium whitespace-nowrap">{fcfa(a.montantTotal)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {a.montantRestant > 0
                      ? <Badge ton="danger">{fcfa(a.montantRestant)}</Badge>
                      : <Badge ton="succes">Soldé</Badge>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{a.effectueParNom ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { void getAchat(a.id).then(setDetail).catch((e) => setErreur(e.message)); }}
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        title="Détail"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {a.montantRestant > 0 && (
                        <button
                          onClick={() => setARegler(a)}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-green-50 hover:text-green-700"
                          title="Enregistrer un règlement"
                        >
                          <Wallet className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Tableau>
          )}
        </Card>
      ) : (
        <Card>
          {fournisseurs.length === 0 ? (
            <Vide icone={Building2} titre="Aucun fournisseur enregistré" />
          ) : (
            <Tableau entetes={["Fournisseur", "Contact", "Téléphone", "Adresse", "État", ""]}>
              {fournisseurs.map((f) => (
                <tr key={f.id} className={cn("hover:bg-gray-50", !f.actif && "opacity-50")}>
                  <td className="px-4 py-3 font-medium text-gray-900">{f.nom}</td>
                  <td className="px-4 py-3 text-gray-600">{f.contact ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{f.telephone ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{f.adresse ?? "—"}</td>
                  <td className="px-4 py-3">
                    {f.actif ? <Badge ton="succes">Actif</Badge> : <Badge ton="neutre">Inactif</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setFournisseurEdite(f)}
                      className="text-sm text-indigo-600 hover:underline"
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}
            </Tableau>
          )}
        </Card>
      )}

      <ModaleAchat
        ouverte={nouvelAchat} fournisseurs={fournisseurs} produits={produits}
        onFermer={() => setNouvelAchat(false)}
        onSucces={() => { setNouvelAchat(false); void recharger(); }}
      />
      <ModaleDetailAchat achat={detail} onFermer={() => setDetail(null)} />
      <ModaleReglement
        achat={aRegler} onFermer={() => setARegler(null)}
        onSucces={() => { setARegler(null); void recharger(); }}
      />
      <ModaleFournisseur
        cible={fournisseurEdite} onFermer={() => setFournisseurEdite(null)}
        onSucces={() => { setFournisseurEdite(null); void recharger(); }}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

interface LigneAchat {
  cle: number;
  productId: number | null;
  libelle: string;
  quantite: string;
  prixUnitaire: string;
}

function ModaleAchat({
  ouverte, fournisseurs, produits, onFermer, onSucces,
}: {
  ouverte: boolean; fournisseurs: Supplier[]; produits: Product[];
  onFermer: () => void; onSucces: () => void;
}) {
  const { pourEcriture, libelle } = useEtablissement();
  const [supplierId, setSupplierId] = useState("");
  const [dateAchat, setDateAchat] = useState(aujourdhui());
  const [paiement, setPaiement] = useState("especes");
  const [montantPaye, setMontantPaye] = useState("");
  const [justificatif, setJustificatif] = useState("");
  const [notes, setNotes] = useState("");
  const [lignes, setLignes] = useState<LigneAchat[]>([]);
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouverte) return;
    setSupplierId(""); setDateAchat(aujourdhui());
    setPaiement("especes"); setMontantPaye(""); setJustificatif(""); setNotes("");
    setLignes([]); setRecherche(""); setErreur(null);
  }, [ouverte]);

  const total = lignes.reduce(
    (s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0), 0
  );

  const resultats = recherche.trim()
    ? produits
        .filter((p) => p.nom.toLowerCase().includes(recherche.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  const ajouterLigne = (p?: Product) =>
    setLignes((l) => [
      ...l,
      {
        cle: Date.now() + l.length,
        productId: p?.id ?? null,
        libelle: p?.nom ?? "",
        quantite: "1",
        // Pré-rempli au dernier prix d'achat connu : le plus souvent inchangé.
        prixUnitaire: p ? String(p.prixAchat || "") : "",
      },
    ]);

  const majLigne = (cle: number, champ: keyof LigneAchat, valeur: string) =>
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, [champ]: valeur } : x)));

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await creerAchat({
        supplierId: supplierId ? Number(supplierId) : null,
        establishmentId: pourEcriture as number,
        dateAchat,
        montantPaye: Number(montantPaye) || 0,
        paymentMethod: paiement,
        justificatif: justificatif.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lignes.map((l) => ({
          productId: l.productId,
          libelle: l.libelle.trim(),
          quantite: Number(l.quantite) || 0,
          prixUnitaire: Number(l.prixUnitaire) || 0,
        })),
      });
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  const lignesValides = lignes.length > 0 && lignes.every(
    (l) => l.libelle.trim() && Number(l.quantite) > 0 && Number(l.prixUnitaire) >= 0
  );

  return (
    <Modale ouverte={ouverte} titre="Nouvel achat" onFermer={onFermer} taille="xl">
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Champ label="Fournisseur">
          <Liste value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Non précisé</option>
            {fournisseurs.filter((f) => f.actif).map((f) => (
              <option key={f.id} value={f.id}>{f.nom}</option>
            ))}
          </Liste>
        </Champ>
        <Champ label="Établissement" aide="Défini par le sélecteur, en haut du menu.">
          <Saisie value={libelle} disabled />
        </Champ>
        <Champ label="Date d'achat">
          <Saisie type="date" value={dateAchat} onChange={(e) => setDateAchat(e.target.value)} />
        </Champ>
        <Champ label="Mode de paiement">
          <Liste value={paiement} onChange={(e) => setPaiement(e.target.value)}>
            {Object.entries(PAYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Liste>
        </Champ>
      </div>

      <div className="mt-5 pt-5 border-t border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">Articles achetés</h3>
          <Bouton variante="secondaire" icone={Plus} onClick={() => ajouterLigne()} className="py-1.5 px-3">
            Ligne libre
          </Bouton>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Saisie
            value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un article du catalogue…" className="pl-9"
          />
        </div>

        {resultats.length > 0 && (
          <div className="mb-3 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
            {resultats.map((p) => (
              <button
                key={p.id}
                onClick={() => { ajouterLigne(p); setRecherche(""); }}
                className="w-full flex justify-between px-3 py-2 text-sm text-left hover:bg-gray-50"
              >
                <span className="text-gray-900">{p.nom}</span>
                <span className="text-gray-500 tabulaire">
                  {p.prixAchat > 0 ? `dernier achat ${fcfa(p.prixAchat)}` : "prix d'achat inconnu"}
                </span>
              </button>
            ))}
          </div>
        )}

        {lignes.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            Recherchez un article du catalogue, ou ajoutez une ligne libre pour un achat hors catalogue
            (matières premières, consommables…).
          </p>
        ) : (
          <div className="space-y-2">
            {lignes.map((l) => (
              <div key={l.cle} className="flex flex-wrap items-end gap-2 p-2.5 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-[180px]">
                  <Saisie
                    value={l.libelle}
                    onChange={(e) => majLigne(l.cle, "libelle", e.target.value)}
                    placeholder="Désignation" className="py-2"
                    disabled={l.productId !== null}
                  />
                </div>
                <Saisie
                  type="number" min={0} step="any" value={l.quantite}
                  onChange={(e) => majLigne(l.cle, "quantite", e.target.value)}
                  className="w-20 py-2 text-center" placeholder="Qté"
                />
                <Saisie
                  type="number" min={0} value={l.prixUnitaire}
                  onChange={(e) => majLigne(l.cle, "prixUnitaire", e.target.value)}
                  className="w-28 py-2 text-right" placeholder="P.U."
                />
                <span className="w-28 text-right text-sm font-medium tabulaire">
                  {fcfa((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0))}
                </span>
                <button
                  onClick={() => setLignes((x) => x.filter((y) => y.cle !== l.cle))}
                  className="p-2 text-gray-400 hover:text-red-600"
                  aria-label="Retirer la ligne"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {lignes.length > 0 && (
          <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-gray-200">
            <span className="font-semibold text-gray-900">Montant total</span>
            <span className="text-xl font-bold text-amber-600 tabulaire">{fcfa(total)}</span>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mt-5 pt-5 border-t border-gray-200">
        <Champ
          label="Montant payé (FCFA)"
          aide={
            total > 0 && Number(montantPaye) < total
              ? `Restera dû : ${fcfa(total - (Number(montantPaye) || 0))}`
              : "Laissez à 0 pour un achat entièrement à crédit."
          }
        >
          <Saisie
            type="number" min={0} max={total} value={montantPaye}
            onChange={(e) => setMontantPaye(e.target.value)} placeholder="0"
          />
        </Champ>
        <Champ label="Référence du justificatif" aide="N° de facture ou de reçu fournisseur.">
          <Saisie value={justificatif} onChange={(e) => setJustificatif(e.target.value)} placeholder="Facultatif" />
        </Champ>
        <div className="sm:col-span-2">
          <Champ label="Notes">
            <Zone value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Facultatif" />
          </Champ>
        </div>
      </div>

      <div className="p-3 mt-4 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-900">
        Les articles rattachés au catalogue entreront automatiquement en stock, et leur prix d'achat
        sera mis à jour au prix payé ici.
      </div>

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!lignesValides} className="flex-1">
          Enregistrer l'achat
        </Bouton>
      </div>
    </Modale>
  );
}

function ModaleDetailAchat({ achat, onFermer }: { achat: Purchase | null; onFermer: () => void }) {
  if (!achat) return null;
  return (
    <Modale ouverte titre={`Achat ${achat.numero}`} onFermer={onFermer} taille="lg">
      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div><p className="text-xs text-gray-500">Date</p><p className="font-medium">{dateCourte(achat.dateAchat)}</p></div>
        <div><p className="text-xs text-gray-500">Fournisseur</p><p className="font-medium">{achat.fournisseurNom ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Établissement</p><p className="font-medium">{achat.etablissementNom ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Paiement</p><p className="font-medium">{PAYMENT_LABELS[achat.paymentMethod]}</p></div>
        {achat.justificatif && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">Justificatif</p><p className="font-medium">{achat.justificatif}</p>
          </div>
        )}
      </div>

      <Tableau entetes={["Article", " Qté", " P.U.", " Montant"]}>
        {(achat.items ?? []).map((l) => (
          <tr key={l.id}>
            <td className="px-4 py-2.5 text-gray-900">{l.libelle}</td>
            <td className="px-4 py-2.5 text-right tabulaire">{fmtQuantite(l.quantite)}</td>
            <td className="px-4 py-2.5 text-right tabulaire">{fcfa(l.prixUnitaire)}</td>
            <td className="px-4 py-2.5 text-right tabulaire font-medium">{fcfa(l.montant)}</td>
          </tr>
        ))}
      </Tableau>

      <div className="space-y-1 text-sm mt-4 pt-3 border-t border-gray-200">
        <div className="flex justify-between"><span className="text-gray-600">Montant total</span><span className="tabulaire font-medium">{fcfa(achat.montantTotal)}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Déjà payé</span><span className="tabulaire text-green-700">{fcfa(achat.montantPaye)}</span></div>
        <div className="flex justify-between font-bold"><span>Restant dû</span><span className={cn("tabulaire", achat.montantRestant > 0 ? "text-red-700" : "text-green-700")}>{fcfa(achat.montantRestant)}</span></div>
      </div>

      {achat.notes && <p className="mt-4 text-sm text-gray-600">{achat.notes}</p>}
    </Modale>
  );
}

function ModaleReglement({
  achat, onFermer, onSucces,
}: { achat: Purchase | null; onFermer: () => void; onSucces: () => void }) {
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    setMontant(achat ? String(achat.montantRestant) : "");
    setErreur(null);
  }, [achat]);

  if (!achat) return null;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await reglerAchat(achat.id, Number(montant) || 0);
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Règlement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte titre={`Règlement — ${achat.numero}`} onFermer={onFermer}>
      <Erreur message={erreur} />
      <div className="p-3 mb-4 bg-gray-50 rounded-lg flex justify-between text-sm">
        <span className="text-gray-600">Restant dû</span>
        <span className="font-semibold text-red-700 tabulaire">{fcfa(achat.montantRestant)}</span>
      </div>
      <Champ label="Montant réglé (FCFA)">
        <Saisie
          type="number" min={0} max={achat.montantRestant} value={montant}
          onChange={(e) => setMontant(e.target.value)} autoFocus
        />
      </Champ>
      <Bouton
        onClick={soumettre} chargement={envoi}
        disabled={!(Number(montant) > 0)} icone={Wallet} className="w-full mt-4"
      >
        Enregistrer le règlement
      </Bouton>
    </Modale>
  );
}

function ModaleFournisseur({
  cible, onFermer, onSucces,
}: { cible: Supplier | "nouveau" | null; onFermer: () => void; onSucces: () => void }) {
  const nouveau = cible === "nouveau";
  const fournisseur = nouveau ? null : cible;

  const [form, setForm] = useState({
    nom: "", contact: "", telephone: "", email: "", adresse: "", notes: "", actif: true,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm({
      nom: fournisseur?.nom ?? "", contact: fournisseur?.contact ?? "",
      telephone: fournisseur?.telephone ?? "", email: fournisseur?.email ?? "",
      adresse: fournisseur?.adresse ?? "", notes: fournisseur?.notes ?? "",
      actif: fournisseur?.actif ?? true,
    });
  }, [cible, fournisseur]);

  if (!cible) return null;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = {
        nom: form.nom.trim(),
        contact: form.contact.trim() || null,
        telephone: form.telephone.trim() || null,
        email: form.email.trim() || null,
        adresse: form.adresse.trim() || null,
        notes: form.notes.trim() || null,
        actif: form.actif,
      };
      if (fournisseur) await modifierFournisseur(fournisseur.id, corps);
      else await creerFournisseur(corps);
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte titre={nouveau ? "Nouveau fournisseur" : `Modifier — ${fournisseur?.nom}`} onFermer={onFermer}>
      <Erreur message={erreur} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ label="Nom / raison sociale">
            <Saisie value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} autoFocus />
          </Champ>
        </div>
        <Champ label="Personne à contacter">
          <Saisie value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        </Champ>
        <Champ label="Téléphone">
          <Saisie value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
        </Champ>
        <Champ label="E-mail">
          <Saisie type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Champ>
        <Champ label="Adresse">
          <Saisie value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} />
        </Champ>
        <div className="sm:col-span-2">
          <Champ label="Notes">
            <Zone value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Champ>
        </div>
      </div>

      <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
        <input
          type="checkbox" checked={form.actif}
          onChange={(e) => setForm({ ...form, actif: e.target.checked })}
          className="h-4 w-4 rounded accent-indigo-600"
        />
        Fournisseur actif
      </label>

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!form.nom.trim()} className="flex-1">
          {nouveau ? "Créer" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}
