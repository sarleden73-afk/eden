import { useCallback, useEffect, useState } from "react";
import { ReceiptText, Ban, Eye, FileDown } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Zone, Champ, Erreur, Chargement,
  Badge, Modale, Tableau, Vide, SelecteurPeriode,
} from "../components/ui";
import { getVentes, getVente, annulerVente } from "../services/db";
import { fcfa, dateHeure, quantite as fmtQuantite, aujourdhui } from "../lib/format";
import { exporterListePDF } from "../lib/export";
import {
  PAYMENT_LABELS,
  type Sale, type PeriodKey,
} from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useEtablissement } from "../contexts/EtablissementContext";

/** §5.2 Historique des ventes — qui a vendu quoi, à quel prix, à quelle heure. */
export default function Ventes() {
  const { peut } = useAuth();
  const { selection, libelle } = useEtablissement();
  const [periode, setPeriode] = useState<PeriodKey>("jour");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());

  const [ventes, setVentes] = useState<Sale[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [detail, setDetail] = useState<Sale | null>(null);
  const [aAnnuler, setAAnnuler] = useState<Sale | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setVentes(await getVentes(periode, { debut, fin, etablissement: selection }));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [periode, debut, fin, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const validees = ventes.filter((v) => v.statut === "validee");
  const total = validees.reduce((s, v) => s + v.total, 0);

  const exporter = () => {
    exporterListePDF(
      "ventes-eden",
      ["N° reçu", "Date et heure", "Établissement", "Vendeur", "Paiement", "Sous-total", "Remise", "Total", "Statut", "Motif annulation"],
      ventes.map((v) => [
        v.numeroRecu, dateHeure(v.createdAt), v.etablissementNom ?? "—", v.vendeurNom ?? "",
        PAYMENT_LABELS[v.paymentMethod], v.sousTotal, v.remise, v.total,
        v.statut === "validee" ? "Validée" : "Annulée", v.motifAnnulation ?? "",
      ])
    );
  };

  return (
    <Layout>
      <PageHeader
        titre="Ventes"
        sousTitre={`${libelle} — ${validees.length} vente(s) validée(s), ${fcfa(total)}`}
      >
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!ventes.length}>
          PDF
        </Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Card>
        {chargement ? (
          <Chargement />
        ) : ventes.length === 0 ? (
          <Vide
            icone={ReceiptText}
            titre="Aucune vente sur cette période"
            description="Changez la période, ou l'établissement dans le sélecteur."
          />
        ) : (
          <Tableau entetes={["N° reçu", "Date", "Établissement", "Vendeur", "Paiement", " Total", "Statut", ""]}>
            {ventes.map((v) => (
              <tr key={v.id} className={v.statut === "annulee" ? "bg-red-50/40" : "hover:bg-gray-50"}>
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{v.numeroRecu}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(v.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className="text-gray-700">{v.etablissementNom ?? "—"}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">{v.vendeurNom ?? "—"}</td>
                <td className="px-4 py-3 text-gray-500">{PAYMENT_LABELS[v.paymentMethod]}</td>
                <td className={`px-4 py-3 text-right font-medium tabulaire whitespace-nowrap ${
                  v.statut === "annulee" ? "text-gray-400 line-through" : "text-gray-900"
                }`}>
                  {fcfa(v.total)}
                </td>
                <td className="px-4 py-3">
                  <Badge ton={v.statut === "validee" ? "succes" : "danger"}>
                    {v.statut === "validee" ? "Validée" : "Annulée"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => { void getVente(v.id).then(setDetail).catch((e) => setErreur(e.message)); }}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      title="Voir le détail"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {v.statut === "validee" && peut("admin", "responsable") && (
                      <button
                        onClick={() => setAAnnuler(v)}
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"
                        title="Annuler la vente"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Tableau>
        )}
      </Card>

      {/* --- Détail d'une vente --- */}
      <Modale ouverte={!!detail} titre={`Vente ${detail?.numeroRecu ?? ""}`} onFermer={() => setDetail(null)}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Date" valeur={dateHeure(detail.createdAt)} />
              <Info label="Établissement" valeur={detail.etablissementNom ?? "—"} />
              <Info label="Vendeur" valeur={detail.vendeurNom ?? "—"} />
              <Info label="Paiement" valeur={PAYMENT_LABELS[detail.paymentMethod]} />
              {detail.numeroTransaction && <Info label="N° transaction" valeur={detail.numeroTransaction} />}
            </div>

            <Tableau entetes={["Article", " Qté", " P.U.", " Montant"]}>
              {(detail.items ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-gray-900">{l.libelle}</td>
                  <td className="px-4 py-2.5 text-right tabulaire">{fmtQuantite(l.quantite)}</td>
                  <td className="px-4 py-2.5 text-right tabulaire">{fcfa(l.prixUnitaire)}</td>
                  <td className="px-4 py-2.5 text-right tabulaire font-medium">{fcfa(l.montant)}</td>
                </tr>
              ))}
            </Tableau>

            <div className="space-y-1 text-sm pt-2 border-t border-gray-200">
              <div className="flex justify-between text-gray-600">
                <span>Sous-total</span><span className="tabulaire">{fcfa(detail.sousTotal)}</span>
              </div>
              {detail.remise > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Remise</span><span className="tabulaire">− {fcfa(detail.remise)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base">
                <span>Total</span><span className="tabulaire text-amber-600">{fcfa(detail.total)}</span>
              </div>
            </div>

            {detail.statut === "annulee" && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                <p className="font-medium text-red-900">Vente annulée</p>
                <p className="mt-1 text-red-800">Motif : {detail.motifAnnulation}</p>
                <p className="mt-0.5 text-xs text-red-700">Le {dateHeure(detail.annuleLe)}</p>
              </div>
            )}
          </div>
        )}
      </Modale>

      <ModaleAnnulation
        vente={aAnnuler}
        onFermer={() => setAAnnuler(null)}
        onSucces={() => { setAAnnuler(null); void recharger(); }}
      />
    </Layout>
  );
}

function Info({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-gray-900 font-medium">{valeur}</p>
    </div>
  );
}

/**
 * §5.10 : l'annulation exige un motif, conservé avec son auteur et l'heure.
 * La vente n'est pas supprimée — le stock est restitué et une contre-passation
 * est écrite en caisse si celle-ci est encore ouverte.
 */
function ModaleAnnulation({
  vente, onFermer, onSucces,
}: { vente: Sale | null; onFermer: () => void; onSucces: () => void }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { setMotif(""); setErreur(null); }, [vente]);

  if (!vente) return null;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await annulerVente(vente.id, motif.trim());
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Annulation impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte titre={`Annuler la vente ${vente.numeroRecu}`} onFermer={onFermer}>
      <Erreur message={erreur} />

      <div className="p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
        Cette opération est tracée : votre nom, la date et le motif seront conservés au journal.
        Le stock sera restitué et la caisse corrigée si elle est encore ouverte.
      </div>

      <Champ label="Motif de l'annulation" aide="Au moins 3 caractères. Soyez précis.">
        <Zone
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder="Ex. : erreur de saisie sur la quantité, client s'est ravisé…"
          autoFocus
        />
      </Champ>

      <div className="flex gap-2 mt-4">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Retour</Bouton>
        <Bouton
          variante="danger"
          onClick={soumettre}
          chargement={envoi}
          disabled={motif.trim().length < 3}
          icone={Ban}
          className="flex-1"
        >
          Confirmer l'annulation
        </Bouton>
      </div>
    </Modale>
  );
}
