import { useCallback, useEffect, useState } from "react";
import {
  Wallet, LockOpen, Lock, ArrowDownCircle, ArrowUpCircle,
  History, Scale,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide,
} from "../components/ui";
import {
  getCaisseCourante, ouvrirCaisse, fermerCaisse, ajouterMouvementCaisse,
  getSessionsCaisse, type CaisseCourante,
} from "../services/db";
import { fcfa, dateHeure, heure } from "../lib/format";
import { cn } from "../lib/utils";
import {
  CASH_MOVEMENT_LABELS, PAYMENT_LABELS,
  type CashSession,
} from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useEtablissement } from "../contexts/EtablissementContext";
import Aide from "../components/Aide";

/** §5.3 Gestion de la caisse : ouverture, mouvements de la journée, fermeture. */
export default function Caisse() {
  const { peut } = useAuth();
  const { pourEcriture, libelle, selection } = useEtablissement();
  const [caisse, setCaisse] = useState<CaisseCourante>(null);
  const [historique, setHistorique] = useState<CashSession[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [modaleOuverture, setModaleOuverture] = useState(false);
  const [modaleFermeture, setModaleFermeture] = useState(false);
  const [modaleMouvement, setModaleMouvement] = useState(false);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const courante = pourEcriture === null ? null : await getCaisseCourante(pourEcriture);
      setCaisse(courante);
      // L'historique n'est accessible qu'aux profils qui valident (§5.1).
      if (peut("admin", "responsable")) setHistorique(await getSessionsCaisse(selection));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [pourEcriture, selection, peut]);

  useEffect(() => { void recharger(); }, [recharger]);

  return (
    <Layout>
      <PageHeader titre="Caisse" sousTitre={`${libelle} — ouverture, mouvements et rapprochement`} />

      <Erreur message={erreur} />

      <Aide cle="caisse">
        <p>
          Ouvrir une caisse déclare le fonds présent dans le tiroir en début de service. À la
          fermeture, comptez l'argent réellement présent : l'<strong>écart</strong> entre ce compte
          et le solde théorique est ce qui doit être expliqué.
        </p>
        <p>
          Une caisse ouverte n'est pas obligatoire pour vendre, mais sans elle le rapprochement de
          fin de journée n'a plus de point de comparaison.
        </p>
      </Aide>

      {chargement ? (
        <Chargement />
      ) : !caisse ? (
        <Card>
          <Vide
            icone={Wallet}
            titre={`La caisse de ${libelle} est fermée`}
            description="Ouvrez la caisse en déclarant le fond de caisse initial. Tant qu'elle est fermée, aucune vente ne peut être enregistrée dans cet établissement."
          >
            <Bouton icone={LockOpen} onClick={() => setModaleOuverture(true)}>
              Ouvrir la caisse
            </Bouton>
          </Vide>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* --- Situation de la caisse ouverte --- */}
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge ton="succes">Ouverte</Badge>
                  <span className="text-sm text-gray-500">{libelle}</span>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  Ouverte le {dateHeure(caisse.openedAt)} par{" "}
                  <span className="font-medium text-gray-900">{caisse.openedByNom}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Bouton variante="secondaire" icone={ArrowDownCircle} onClick={() => setModaleMouvement(true)}>
                  Mouvement
                </Bouton>
                <Bouton icone={Lock} onClick={() => setModaleFermeture(true)}>
                  Fermer la caisse
                </Bouton>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 mt-5 pt-5 border-t border-gray-200">
              <div>
                <p className="text-sm text-gray-500">Fond de caisse initial</p>
                <p className="mt-1 text-xl font-bold text-gray-900 tabulaire">{fcfa(caisse.fondsInitial)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Mouvements en espèces</p>
                <p className="mt-1 text-xl font-bold text-gray-900 tabulaire">
                  {fcfa(caisse.soldeTheorique - caisse.fondsInitial)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Solde théorique</p>
                <p className="mt-1 text-xl font-bold text-amber-600 tabulaire">{fcfa(caisse.soldeTheorique)}</p>
              </div>
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Le solde théorique ne compte que les espèces : Mobile Money, carte et virement
              n'entrent pas dans le tiroir et ne doivent donc pas peser sur l'écart de fermeture.
            </p>
          </Card>

          {/* --- Journal des mouvements --- */}
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Mouvements de la journée</h2>
            </div>
            {caisse.mouvements.length === 0 ? (
              <Vide titre="Aucun mouvement pour l'instant" icone={History} />
            ) : (
              <Tableau entetes={["Heure", "Type", "Motif", "Paiement", " Montant"]}>
                {caisse.mouvements.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{heure(m.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge ton={m.montant >= 0 ? "succes" : "danger"}>
                        {CASH_MOVEMENT_LABELS[m.type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{m.motif ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{PAYMENT_LABELS[m.paymentMethod]}</td>
                    <td className={cn(
                      "px-4 py-3 text-right font-medium tabulaire whitespace-nowrap",
                      m.montant >= 0 ? "text-green-700" : "text-red-700"
                    )}>
                      {m.montant >= 0 ? "+" : "−"} {fcfa(Math.abs(m.montant))}
                    </td>
                  </tr>
                ))}
              </Tableau>
            )}
          </Card>
        </div>
      )}

      {/* --- Historique des sessions fermées (§5.12 « écarts de caisse ») --- */}
      {peut("admin", "responsable") && historique.length > 0 && (
        <Card className="mt-5">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Historique des caisses</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Un écart persistant, même faible, mérite une explication.
            </p>
          </div>
          <Tableau entetes={["Ouverture", "Fermeture", "Par", " Théorique", " Physique", " Écart"]}>
            {historique.filter((s) => s.statut === "fermee").map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(s.openedAt)}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateHeure(s.closedAt)}</td>
                <td className="px-4 py-3 text-gray-700">{s.closedByNom ?? "—"}</td>
                <td className="px-4 py-3 text-right tabulaire">{fcfa(s.soldeTheorique ?? 0)}</td>
                <td className="px-4 py-3 text-right tabulaire">{fcfa(s.soldePhysique ?? 0)}</td>
                <td className="px-4 py-3 text-right">
                  <Badge ton={!s.ecart ? "succes" : Math.abs(s.ecart) < 500 ? "alerte" : "danger"}>
                    {(s.ecart ?? 0) > 0 ? "+" : ""}{fcfa(s.ecart ?? 0)}
                  </Badge>
                </td>
              </tr>
            ))}
          </Tableau>
        </Card>
      )}

      <ModaleOuverture
        ouverte={modaleOuverture} etablissementId={pourEcriture} libelle={libelle}
        onFermer={() => setModaleOuverture(false)}
        onSucces={() => { setModaleOuverture(false); void recharger(); }}
      />
      {caisse && (
        <>
          <ModaleFermeture
            ouverte={modaleFermeture} caisse={caisse}
            onFermer={() => setModaleFermeture(false)}
            onSucces={() => { setModaleFermeture(false); void recharger(); }}
          />
          <ModaleMouvement
            ouverte={modaleMouvement} sessionId={caisse.id}
            onFermer={() => setModaleMouvement(false)}
            onSucces={() => { setModaleMouvement(false); void recharger(); }}
          />
        </>
      )}
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function ModaleOuverture({
  ouverte, etablissementId, libelle, onFermer, onSucces,
}: { ouverte: boolean; etablissementId: number | null; libelle: string; onFermer: () => void; onSucces: () => void }) {
  const [fonds, setFonds] = useState("");
  const [notes, setNotes] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await ouvrirCaisse({ establishmentId: etablissementId as number, fondsInitial: Number(fonds) || 0, notes: notes.trim() || undefined });
      setFonds(""); setNotes("");
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Ouverture impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouverte} titre={`Ouvrir la caisse — ${libelle}`} onFermer={onFermer}>
      <Erreur message={erreur} />
      <div className="space-y-4">
        <Champ
          label="Fond de caisse initial (FCFA)"
          aide="Montant réellement présent dans le tiroir au moment de l'ouverture."
        >
          <Saisie type="number" min={0} value={fonds} onChange={(e) => setFonds(e.target.value)} placeholder="0" autoFocus />
        </Champ>
        <Champ label="Observations" aide="Facultatif">
          <Zone value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remarque sur l'ouverture…" />
        </Champ>
        <Bouton onClick={soumettre} chargement={envoi} icone={LockOpen} className="w-full">
          Ouvrir la caisse
        </Bouton>
      </div>
    </Modale>
  );
}

function ModaleFermeture({
  ouverte, caisse, onFermer, onSucces,
}: {
  ouverte: boolean;
  caisse: NonNullable<CaisseCourante>;
  onFermer: () => void;
  onSucces: () => void;
}) {
  const [physique, setPhysique] = useState("");
  const [notes, setNotes] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // L'écart est affiché en direct pendant la saisie : le caissier voit
  // immédiatement s'il s'est trompé en comptant, avant de valider.
  const compte = Number(physique);
  const ecart = physique === "" ? null : compte - caisse.soldeTheorique;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await fermerCaisse({
        sessionId: caisse.id,
        soldePhysique: compte || 0,
        notes: notes.trim() || undefined,
      });
      setPhysique(""); setNotes("");
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Fermeture impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouverte} titre="Fermer la caisse" onFermer={onFermer}>
      <Erreur message={erreur} />

      <div className="p-4 bg-gray-50 rounded-lg mb-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Fond initial</span>
          <span className="tabulaire">{fcfa(caisse.fondsInitial)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Mouvements en espèces</span>
          <span className="tabulaire">{fcfa(caisse.soldeTheorique - caisse.fondsInitial)}</span>
        </div>
        <div className="flex justify-between font-semibold pt-1.5 border-t border-gray-200">
          <span>Solde théorique</span>
          <span className="tabulaire">{fcfa(caisse.soldeTheorique)}</span>
        </div>
      </div>

      <div className="space-y-4">
        <Champ
          label="Solde physique compté (FCFA)"
          aide="Comptez le tiroir avant de saisir. Ce montant ne doit pas être ajusté pour tomber juste."
        >
          <Saisie
            type="number" min={0} value={physique}
            onChange={(e) => setPhysique(e.target.value)}
            placeholder="0" autoFocus
          />
        </Champ>

        {ecart !== null && (
          <div className={cn(
            "flex items-center gap-2.5 p-3 rounded-lg border",
            ecart === 0
              ? "bg-green-50 border-green-200"
              : Math.abs(ecart) < 500
                ? "bg-amber-50 border-amber-200"
                : "bg-red-50 border-red-200"
          )}>
            <Scale className={cn(
              "h-5 w-5 shrink-0",
              ecart === 0 ? "text-green-600" : Math.abs(ecart) < 500 ? "text-amber-600" : "text-red-600"
            )} />
            <p className="text-sm">
              {ecart === 0 ? (
                <span className="text-green-900 font-medium">Caisse juste, aucun écart.</span>
              ) : (
                <span className={Math.abs(ecart) < 500 ? "text-amber-900" : "text-red-900"}>
                  Écart de <strong>{ecart > 0 ? "+" : "−"} {fcfa(Math.abs(ecart))}</strong>
                  {ecart > 0 ? " (excédent)" : " (manquant)"} — expliquez-le en observation.
                </span>
              )}
            </p>
          </div>
        )}

        <Champ
          label="Observations"
          aide={ecart !== null && ecart !== 0 ? "Obligatoire en cas d'écart." : "Facultatif"}
        >
          <Zone
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Explication de l'écart, incident de la journée…"
          />
        </Champ>

        <Bouton
          onClick={soumettre}
          chargement={envoi}
          disabled={physique === "" || (ecart !== null && ecart !== 0 && !notes.trim())}
          icone={Lock}
          className="w-full"
        >
          Confirmer la fermeture
        </Bouton>
      </div>
    </Modale>
  );
}

function ModaleMouvement({
  ouverte, sessionId, onFermer, onSucces,
}: { ouverte: boolean; sessionId: number; onFermer: () => void; onSucces: () => void }) {
  const [type, setType] = useState("entree");
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Les dépenses passent par l'écran Dépenses (elles exigent une catégorie et
  // une validation) ; on ne propose ici que les mouvements de trésorerie purs.
  const types = ["entree", "retrait", "depot", "remboursement", "autre"] as const;
  const sortie = ["retrait", "remboursement"].includes(type);

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await ajouterMouvementCaisse({
        sessionId, type, montant: Number(montant) || 0, motif: motif.trim(),
      });
      setMontant(""); setMotif("");
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouverte} titre="Mouvement de caisse" onFermer={onFermer}>
      <Erreur message={erreur} />
      <div className="space-y-4">
        <Champ label="Type de mouvement">
          <Liste value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>{CASH_MOVEMENT_LABELS[t]}</option>
            ))}
          </Liste>
        </Champ>

        <Champ label="Montant (FCFA)" aide="Toujours un montant positif : le sens est donné par le type.">
          <Saisie type="number" min={0} value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" />
        </Champ>

        <Champ label="Motif" aide="Obligatoire — tout mouvement de caisse doit être justifié.">
          <Saisie value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. : appoint de monnaie, versement au patron…" />
        </Champ>

        <div className="flex items-center gap-2 text-sm text-gray-600">
          {sortie ? <ArrowUpCircle className="h-4 w-4 text-red-600" /> : <ArrowDownCircle className="h-4 w-4 text-green-600" />}
          <span>
            Ce mouvement {sortie ? "diminuera" : "augmentera"} le solde théorique de{" "}
            {fcfa(Math.abs(Number(montant) || 0))}.
          </span>
        </div>

        <Bouton
          onClick={soumettre}
          chargement={envoi}
          disabled={!motif.trim() || !(Number(montant) > 0)}
          className="w-full"
        >
          Enregistrer le mouvement
        </Bouton>
      </div>
    </Modale>
  );
}
