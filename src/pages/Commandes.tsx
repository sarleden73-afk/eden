import { useCallback, useEffect, useState } from "react";
import { Palette, Plus, Pencil, FileDown, Phone, CalendarClock, AlertCircle } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide, StatCard,
} from "../components/ui";
import { getCommandes, creerCommande, modifierCommande, getUtilisateurs } from "../services/db";
import { fcfa, dateCourte, aujourdhui } from "../lib/format";
import { exporterListePDF } from "../lib/export";
import { cn } from "../lib/utils";
import { ORDER_STATUS_LABELS, type Order, type OrderStatus, type Profile } from "../types";
import { useEtablissement } from "../contexts/EtablissementContext";

const TONS_STATUT: Record<OrderStatus, "neutre" | "info" | "succes" | "alerte" | "danger"> = {
  en_attente: "alerte",
  en_cours: "info",
  termine: "succes",
  livre: "neutre",
  annule: "danger",
};

/** §5.8 Gestion des commandes infographie. */
export default function Commandes() {
  const { selection, libelle, pourEcriture } = useEtablissement();
  const [commandes, setCommandes] = useState<Order[]>([]);
  const [techniciens, setTechniciens] = useState<Profile[]>([]);
  const [filtre, setFiltre] = useState<OrderStatus | "">("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [edite, setEdite] = useState<Order | "nouveau" | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setCommandes(await getCommandes(selection, filtre || undefined));
      // La liste des utilisateurs sert à assigner un technicien.
      setTechniciens(await getUtilisateurs().catch(() => []));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [filtre, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const enCours = commandes.filter((c) => c.statut === "en_attente" || c.statut === "en_cours");
  const resteAEncaisser = enCours.reduce((s, c) => s + c.reste, 0);

  // Une commande en retard est la première chose qu'un responsable doit voir.
  const enRetard = enCours.filter(
    (c) => c.dateLivraisonPrevue && new Date(c.dateLivraisonPrevue) < new Date(aujourdhui())
  );

  const exporter = () =>
    exporterListePDF(
      "commandes-eden",
      ["N°", "Client", "Téléphone", "Prestation", "Description", "Qté", "P.U.", "Total", "Acompte", "Reste", "Commandée le", "Livraison prévue", "Statut", "Technicien"],
      commandes.map((c) => [
        c.numero, c.customerNom, c.customerTelephone ?? "", c.typePrestation, c.description ?? "",
        c.quantite, c.prixUnitaire, c.montantTotal, c.acompte, c.reste,
        dateCourte(c.dateCommande), dateCourte(c.dateLivraisonPrevue),
        ORDER_STATUS_LABELS[c.statut], c.technicienNom ?? "",
      ])
    );

  return (
    <Layout>
      <PageHeader titre="Commandes" sousTitre={`${libelle} — prestations sur commande`}>
        <Liste value={filtre} onChange={(e) => setFiltre(e.target.value as OrderStatus | "")} className="w-auto py-1.5">
          <option value="">Tous les statuts</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Liste>
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!commandes.length}>
          PDF
        </Bouton>
        <Bouton icone={Plus} onClick={() => setEdite("nouveau")} disabled={pourEcriture === null} title={pourEcriture === null ? "Choisissez d'abord un établissement" : undefined}>Nouvelle commande</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <StatCard titre="Commandes en cours" valeur={enCours.length} icone={Palette} />
        <StatCard
          titre="En retard" valeur={enRetard.length} icone={AlertCircle}
          ton={enRetard.length ? "danger" : "neutre"} detail="Date de livraison dépassée"
        />
        <StatCard
          titre="Reste à encaisser" valeur={fcfa(resteAEncaisser)} icone={CalendarClock}
          detail="Sur les commandes en cours"
        />
      </div>

      <Card>
        {chargement ? (
          <Chargement />
        ) : commandes.length === 0 ? (
          <Vide
            icone={Palette} titre="Aucune commande"
            description="Cartes de visite, logos, cartes de mariage, livrets… enregistrez ici les travaux à réaliser, leur acompte et leur échéance."
          />
        ) : (
          <Tableau
            entetes={["N°", "Client", "Prestation", "Livraison", " Total", " Acompte", " Reste", "Statut", ""]}
          >
            {commandes.map((c) => {
              const retard =
                c.dateLivraisonPrevue &&
                new Date(c.dateLivraisonPrevue) < new Date(aujourdhui()) &&
                (c.statut === "en_attente" || c.statut === "en_cours");

              return (
                <tr key={c.id} className={cn("hover:bg-gray-50", retard && "bg-red-50/40")}>
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{c.numero}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.customerNom}</div>
                    {c.customerTelephone && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <Phone className="h-3 w-3" />{c.customerTelephone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{c.typePrestation}</div>
                    {c.description && (
                      <div className="text-xs text-gray-500 max-w-xs truncate">{c.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={cn("text-sm", retard ? "text-red-600 font-medium" : "text-gray-600")}>
                      {dateCourte(c.dateLivraisonPrevue)}
                    </span>
                    {retard && <div className="text-xs text-red-600">En retard</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabulaire font-medium whitespace-nowrap">{fcfa(c.montantTotal)}</td>
                  <td className="px-4 py-3 text-right tabulaire text-green-700 whitespace-nowrap">{fcfa(c.acompte)}</td>
                  <td className="px-4 py-3 text-right tabulaire whitespace-nowrap">
                    <span className={c.reste > 0 ? "text-red-700 font-medium" : "text-gray-400"}>
                      {fcfa(c.reste)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge ton={TONS_STATUT[c.statut]}>{ORDER_STATUS_LABELS[c.statut]}</Badge>
                    {c.technicienNom && (
                      <div className="text-xs text-gray-500 mt-0.5">{c.technicienNom}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEdite(c)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      title="Modifier"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </Tableau>
        )}
      </Card>

      <ModaleCommande
        cible={edite} techniciens={techniciens} etablissementId={pourEcriture}
        onFermer={() => setEdite(null)}
        onSucces={() => { setEdite(null); void recharger(); }}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function ModaleCommande({
  cible, techniciens, etablissementId, onFermer, onSucces,
}: {
  cible: Order | "nouveau" | null;
  techniciens: Profile[];
  etablissementId: number | null;
  onFermer: () => void;
  onSucces: () => void;
}) {
  const nouvelle = cible === "nouveau";
  const commande = nouvelle ? null : cible;

  const [form, setForm] = useState({
    customerNom: "", customerTelephone: "", typePrestation: "", description: "",
    quantite: "1", prixUnitaire: "", acompte: "0",
    dateLivraisonPrevue: "", statut: "en_attente" as OrderStatus, technicienId: "",
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm(
      commande
        ? {
            customerNom: commande.customerNom,
            customerTelephone: commande.customerTelephone ?? "",
            typePrestation: commande.typePrestation,
            description: commande.description ?? "",
            quantite: String(commande.quantite),
            prixUnitaire: String(commande.prixUnitaire),
            acompte: String(commande.acompte),
            dateLivraisonPrevue: commande.dateLivraisonPrevue?.slice(0, 10) ?? "",
            statut: commande.statut,
            technicienId: commande.technicienId ?? "",
          }
        : {
            customerNom: "", customerTelephone: "", typePrestation: "", description: "",
            quantite: "1", prixUnitaire: "", acompte: "0",
            dateLivraisonPrevue: "", statut: "en_attente", technicienId: "",
          }
    );
  }, [cible, commande]);

  if (!cible) return null;

  const total = (Number(form.quantite) || 0) * (Number(form.prixUnitaire) || 0);
  const reste = total - (Number(form.acompte) || 0);

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const base = {
        customerNom: form.customerNom.trim(),
        customerTelephone: form.customerTelephone.trim() || undefined,
        typePrestation: form.typePrestation.trim(),
        description: form.description.trim() || undefined,
        quantite: Number(form.quantite) || 1,
        prixUnitaire: Number(form.prixUnitaire) || 0,
        acompte: Number(form.acompte) || 0,
        dateLivraisonPrevue: form.dateLivraisonPrevue || undefined,
        technicienId: form.technicienId || null,
      };
      if (commande) await modifierCommande(commande.id, { ...base, statut: form.statut });
      else await creerCommande({ ...base, establishmentId: etablissementId as number });
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
      titre={nouvelle ? "Nouvelle commande" : `Commande ${commande?.numero}`}
      onFermer={onFermer}
      taille="lg"
    >
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Nom du client">
          <Saisie
            value={form.customerNom}
            onChange={(e) => setForm({ ...form, customerNom: e.target.value })}
            autoFocus
          />
        </Champ>
        <Champ label="Téléphone">
          <Saisie
            value={form.customerTelephone}
            onChange={(e) => setForm({ ...form, customerTelephone: e.target.value })}
            placeholder="06 000 00 00"
          />
        </Champ>

        <div className="sm:col-span-2">
          <Champ label="Type de prestation" aide="Ex. : carte de visite, logo, carte de mariage, livret de loyer…">
            <Saisie
              value={form.typePrestation}
              onChange={(e) => setForm({ ...form, typePrestation: e.target.value })}
            />
          </Champ>
        </div>

        <div className="sm:col-span-2">
          <Champ label="Description">
            <Zone
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Détails du travail demandé, couleurs, textes, format…"
            />
          </Champ>
        </div>

        <Champ label="Quantité">
          <Saisie
            type="number" min={1} value={form.quantite}
            onChange={(e) => setForm({ ...form, quantite: e.target.value })}
          />
        </Champ>
        <Champ label="Prix unitaire (FCFA)">
          <Saisie
            type="number" min={0} value={form.prixUnitaire}
            onChange={(e) => setForm({ ...form, prixUnitaire: e.target.value })}
          />
        </Champ>

        <Champ label="Acompte versé (FCFA)">
          <Saisie
            type="number" min={0} max={total} value={form.acompte}
            onChange={(e) => setForm({ ...form, acompte: e.target.value })}
          />
        </Champ>
        <Champ label="Date de livraison prévue">
          <Saisie
            type="date" value={form.dateLivraisonPrevue}
            onChange={(e) => setForm({ ...form, dateLivraisonPrevue: e.target.value })}
          />
        </Champ>

        <Champ label="Technicien en charge">
          <Liste value={form.technicienId} onChange={(e) => setForm({ ...form, technicienId: e.target.value })}>
            <option value="">Non assignée</option>
            {techniciens.filter((t) => t.actif).map((t) => (
              <option key={t.id} value={t.id}>{t.fullName}</option>
            ))}
          </Liste>
        </Champ>

        {commande && (
          <Champ label="Statut">
            <Liste
              value={form.statut}
              onChange={(e) => setForm({ ...form, statut: e.target.value as OrderStatus })}
            >
              {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Liste>
          </Champ>
        )}
      </div>

      <div className="p-4 mt-5 bg-gray-50 rounded-lg space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Montant total</span>
          <span className="tabulaire font-medium">{fcfa(total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Acompte</span>
          <span className="tabulaire text-green-700">− {fcfa(Number(form.acompte) || 0)}</span>
        </div>
        <div className="flex justify-between font-bold pt-1.5 border-t border-gray-200">
          <span>Reste à payer à la livraison</span>
          <span className="tabulaire text-amber-600">{fcfa(Math.max(0, reste))}</span>
        </div>
      </div>

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton
          onClick={soumettre} chargement={envoi}
          disabled={!form.customerNom.trim() || !form.typePrestation.trim()}
          className="flex-1"
        >
          {nouvelle ? "Créer la commande" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}
