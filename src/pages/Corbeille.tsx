import { useCallback, useEffect, useState } from "react";
import { Trash2, Undo2, ShieldCheck } from "lucide-react";
import Layout from "../components/Layout";
import { PageHeader, Card, Bouton, Erreur, Chargement, Vide } from "../components/ui";
import Aide from "../components/Aide";
import { getCorbeille, restaurer } from "../services/db";
import { useEtablissement } from "../contexts/EtablissementContext";
import type { GroupeCorbeille } from "../types";

/**
 * Corbeille.
 *
 * Rien n'est effacé de cette application : retirer un article, un pack, une
 * catégorie, un fournisseur, un établissement ou un compte les désactive. Ils
 * disparaissent des écrans courants, mais l'historique qui les mentionne — une
 * vente d'il y a six mois, un achat réglé — reste lisible et juste.
 *
 * Cet écran rend ce mécanisme visible : sans lui, une suppression accidentelle
 * était réversible en théorie et introuvable en pratique.
 */
export default function Corbeille() {
  const { selection, libelle } = useEtablissement();
  const [groupes, setGroupes] = useState<GroupeCorbeille[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await getCorbeille(selection);
      setGroupes(r.groupes);
      setTotal(r.total);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const remettre = async (domaine: string, id: string) => {
    setEnCours(`${domaine}-${id}`);
    setErreur(null);
    try {
      await restaurer(domaine, id);
      await recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Restauration impossible.");
    } finally {
      setEnCours(null);
    }
  };

  const remplis = groupes.filter((g) => g.elements.length > 0);

  return (
    <Layout>
      <PageHeader
        titre="Corbeille"
        sousTitre={`${libelle} — ${total} élément(s) retiré(s), restaurables`}
      />

      <Erreur message={erreur} />

      <Aide cle="corbeille">
        <p>
          Retirer un article, un pack, une catégorie, un fournisseur, un établissement ou un compte
          ne l'efface pas : il est <strong>désactivé</strong> et atterrit ici. Il cesse d'apparaître
          dans les écrans courants, mais les ventes et les achats qui le mentionnent restent justes.
        </p>
        <p>
          <strong>Restaurer</strong> le remet en circulation tel qu'il était. Les ventes, les caisses
          et les écritures comptables ne passent jamais par la corbeille : elles ne se suppriment
          pas du tout — une vente s'annule, avec un motif, et la trace en reste au journal.
        </p>
      </Aide>

      {chargement ? (
        <Chargement />
      ) : remplis.length === 0 ? (
        <Card>
          <Vide
            icone={ShieldCheck}
            titre="La corbeille est vide"
            description="Rien n'a été retiré. Ce qui le sera un jour apparaîtra ici, et pourra être remis en place."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {remplis.map((g) => (
            <Card key={g.cle}>
              <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-gray-400" />
                <h2 className="font-semibold text-gray-900">{g.libelle}</h2>
                <span className="text-sm text-gray-500">— {g.elements.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {g.elements.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{e.nom}</p>
                      {e.etablissement && (
                        <p className="text-xs text-gray-500">{e.etablissement}</p>
                      )}
                    </div>
                    <Bouton
                      variante="secondaire"
                      icone={Undo2}
                      onClick={() => remettre(g.cle, e.id)}
                      disabled={enCours === `${g.cle}-${e.id}`}
                    >
                      Restaurer
                    </Bouton>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
