import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Search, Phone, MapPin, Eye, FileDown, Pencil } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Champ, Zone, Erreur, Chargement,
  Badge, Modale, Tableau, Vide,
} from "../components/ui";
import { getClients, getClient, creerClient, modifierClient } from "../services/db";
import { fcfa, dateCourte, dateHeure } from "../lib/format";
import { exporterCSV } from "../lib/export";
import { ORDER_STATUS_LABELS, POLE_SHORT, type Customer, type Sale, type Order } from "../types";

type FicheClient = Customer & { ventes: Sale[]; commandes: Order[] };

/** §5.9 Gestion des clients : fiche, historique d'achats, commandes en cours. */
export default function Clients() {
  const [clients, setClients] = useState<Customer[]>([]);
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fiche, setFiche] = useState<FicheClient | null>(null);
  const [edite, setEdite] = useState<Customer | "nouveau" | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setClients(await getClients(recherche));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [recherche]);

  // Recherche différée : une requête par frappe saturerait l'API.
  useEffect(() => {
    const timer = window.setTimeout(() => { void recharger(); }, 250);
    return () => window.clearTimeout(timer);
  }, [recharger]);

  const ouvrirFiche = async (id: number) => {
    try {
      setFiche(await getClient(id));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Fiche inaccessible.");
    }
  };

  const exporter = () =>
    exporterCSV(
      "clients-eden",
      ["Nom", "Téléphone", "Adresse", "Client depuis", "Notes"],
      clients.map((c) => [c.nom, c.telephone ?? "", c.adresse ?? "", dateCourte(c.createdAt), c.notes ?? ""])
    );

  return (
    <Layout>
      <PageHeader titre="Clients" sousTitre="Fiches, historique d'achats et commandes en cours">
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!clients.length}>
          Excel
        </Bouton>
        <Bouton icone={Plus} onClick={() => setEdite("nouveau")}>Nouveau client</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Saisie
          value={recherche} onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher par nom ou téléphone…" className="pl-9"
        />
      </div>

      <Card>
        {chargement ? (
          <Chargement />
        ) : clients.length === 0 ? (
          <Vide
            icone={Users}
            titre={recherche ? "Aucun client ne correspond" : "Aucun client enregistré"}
            description="Rattacher un client à une vente permet de suivre son historique et son montant total dépensé."
          />
        ) : (
          <Tableau entetes={["Nom", "Téléphone", "Adresse", "Client depuis", ""]}>
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{c.nom}</td>
                <td className="px-4 py-3 text-gray-600">
                  {c.telephone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-gray-400" />{c.telephone}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                  {c.adresse ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />{c.adresse}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(c.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => void ouvrirFiche(c.id)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      title="Voir la fiche"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEdite(c)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      title="Modifier"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Tableau>
        )}
      </Card>

      <ModaleFiche fiche={fiche} onFermer={() => setFiche(null)} />
      <ModaleClient
        cible={edite} onFermer={() => setEdite(null)}
        onSucces={() => { setEdite(null); void recharger(); }}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function ModaleFiche({ fiche, onFermer }: { fiche: FicheClient | null; onFermer: () => void }) {
  if (!fiche) return null;

  const commandesEnCours = fiche.commandes.filter(
    (c) => c.statut === "en_attente" || c.statut === "en_cours"
  );

  return (
    <Modale ouverte titre={fiche.nom} onFermer={onFermer} taille="xl">
      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500">Total dépensé</p>
          <p className="mt-1 text-xl font-bold text-amber-600 tabulaire">{fcfa(fiche.totalDepense ?? 0)}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500">Nombre d'achats</p>
          <p className="mt-1 text-xl font-bold text-gray-900 tabulaire">{fiche.nbAchats ?? 0}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500">Commandes en cours</p>
          <p className="mt-1 text-xl font-bold text-gray-900 tabulaire">{commandesEnCours.length}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm mb-5">
        {fiche.telephone && (
          <div><p className="text-xs text-gray-500">Téléphone</p><p className="font-medium">{fiche.telephone}</p></div>
        )}
        {fiche.adresse && (
          <div><p className="text-xs text-gray-500">Adresse</p><p className="font-medium">{fiche.adresse}</p></div>
        )}
        <div><p className="text-xs text-gray-500">Client depuis</p><p className="font-medium">{dateCourte(fiche.createdAt)}</p></div>
      </div>

      {fiche.notes && (
        <div className="p-3 mb-5 bg-gray-50 rounded-lg text-sm text-gray-700">{fiche.notes}</div>
      )}

      {commandesEnCours.length > 0 && (
        <div className="mb-5">
          <h3 className="font-medium text-gray-900 mb-2">Commandes en cours</h3>
          <Tableau entetes={["N°", "Prestation", "Livraison", " Reste", "Statut"]}>
            {commandesEnCours.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{c.numero}</td>
                <td className="px-4 py-2.5 text-gray-700">{c.typePrestation}</td>
                <td className="px-4 py-2.5 text-gray-500">{dateCourte(c.dateLivraisonPrevue)}</td>
                <td className="px-4 py-2.5 text-right tabulaire">{fcfa(c.reste)}</td>
                <td className="px-4 py-2.5"><Badge ton="info">{ORDER_STATUS_LABELS[c.statut]}</Badge></td>
              </tr>
            ))}
          </Tableau>
        </div>
      )}

      <h3 className="font-medium text-gray-900 mb-2">Historique des achats</h3>
      {fiche.ventes.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">Aucun achat enregistré pour ce client.</p>
      ) : (
        <Tableau entetes={["N° reçu", "Date", "Pôle", "Vendeur", " Total", "Statut"]}>
          {fiche.ventes.map((v) => (
            <tr key={v.id}>
              <td className="px-4 py-2.5 font-medium text-gray-900">{v.numeroRecu}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{dateHeure(v.createdAt)}</td>
              <td className="px-4 py-2.5 text-gray-600">{POLE_SHORT[v.pole]}</td>
              <td className="px-4 py-2.5 text-gray-600">{v.vendeurNom ?? "—"}</td>
              <td className={`px-4 py-2.5 text-right tabulaire ${v.statut === "annulee" ? "text-gray-400 line-through" : "font-medium"}`}>
                {fcfa(v.total)}
              </td>
              <td className="px-4 py-2.5">
                <Badge ton={v.statut === "validee" ? "succes" : "danger"}>
                  {v.statut === "validee" ? "Validée" : "Annulée"}
                </Badge>
              </td>
            </tr>
          ))}
        </Tableau>
      )}
    </Modale>
  );
}

function ModaleClient({
  cible, onFermer, onSucces,
}: { cible: Customer | "nouveau" | null; onFermer: () => void; onSucces: () => void }) {
  const nouveau = cible === "nouveau";
  const client = nouveau ? null : cible;

  const [form, setForm] = useState({ nom: "", telephone: "", adresse: "", notes: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm({
      nom: client?.nom ?? "", telephone: client?.telephone ?? "",
      adresse: client?.adresse ?? "", notes: client?.notes ?? "",
    });
  }, [cible, client]);

  if (!cible) return null;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = {
        nom: form.nom.trim(),
        telephone: form.telephone.trim() || null,
        adresse: form.adresse.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (client) await modifierClient(client.id, corps);
      else await creerClient(corps);
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte titre={nouveau ? "Nouveau client" : `Modifier — ${client?.nom}`} onFermer={onFermer}>
      <Erreur message={erreur} />
      <div className="space-y-4">
        <Champ label="Nom">
          <Saisie value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} autoFocus />
        </Champ>
        <Champ label="Téléphone">
          <Saisie
            value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })}
            placeholder="06 000 00 00"
          />
        </Champ>
        <Champ label="Adresse" aide="Facultatif">
          <Saisie value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} />
        </Champ>
        <Champ label="Notes">
          <Zone value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Champ>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!form.nom.trim()} className="w-full">
          {nouveau ? "Créer le client" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}
