import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, FileDown, AlertTriangle, Clock, Users } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Erreur, Chargement, Badge, Tableau, Vide,
  StatCard, SelecteurPeriode,
} from "../components/ui";
import Aide from "../components/Aide";
import { getPointages } from "../services/db";
import { heure, dateCourte, aujourdhui } from "../lib/format";
import { exporterListePDF } from "../lib/export";
import { useEtablissement } from "../contexts/EtablissementContext";
import type { Pointage, BilanPresence, PeriodKey } from "../types";

/**
 * Suivi des arrivées du personnel.
 *
 * L'objet n'est pas de fliquer mais de pouvoir répondre à une question simple :
 * qui était là, et à quelle heure. Le bilan par personne donne l'heure moyenne
 * d'arrivée ainsi que la plus tôt et la plus tardive : une moyenne seule
 * masquerait un retard isolé.
 */
export default function Presence() {
  const { selection, libelle } = useEtablissement();
  const [periode, setPeriode] = useState<PeriodKey>("mois");
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(aujourdhui());

  const [pointages, setPointages] = useState<Pointage[]>([]);
  const [bilan, setBilan] = useState<BilanPresence[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await getPointages(periode, { debut, fin, etablissement: selection });
      setPointages(r.pointages);
      setBilan(r.bilan);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [periode, debut, fin, selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const nonVerifies = pointages.filter((p) => !p.verifie).length;
  const jours = new Set(pointages.map((p) => p.jour)).size;

  const exporter = () =>
    exporterListePDF(
      "presence-eden",
      ["Employé", "Jours travaillés", "Arrivée moyenne", "Plus tôt", "Plus tard", "Non vérifiées"],
      bilan.map((b) => [b.nom, b.jours, b.arriveeMoyenne, b.plusTot, b.plusTard, b.nonVerifies]),
      { titre: "Assiduité du personnel", perimetre: libelle }
    );

  return (
    <Layout>
      <PageHeader titre="Présence du personnel" sousTitre={`${libelle} — arrivées et ponctualité`}>
        <SelecteurPeriode
          periode={periode} debut={debut} fin={fin}
          onChange={(v) => { setPeriode(v.periode); setDebut(v.debut); setFin(v.fin); }}
        />
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!bilan.length}>
          PDF
        </Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="presence">
        <p>
          L'arrivée est enregistrée automatiquement à la première identification de la journée, par
          reconnaissance du visage. Personne n'a de bouton à presser, et personne ne peut pointer
          pour quelqu'un d'autre.
        </p>
        <p>
          Une arrivée <strong>non vérifiée</strong> est une entrée faite au code parce que le visage
          n'a pas été reconnu. Ce n'est pas une faute en soi — mauvais éclairage, caméra occupée —
          mais un compteur qui grimpe pour une seule personne mérite qu'on regarde.
        </p>
      </Aide>

      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <StatCard titre="Personnes pointées" valeur={bilan.length} icone={Users} />
        <StatCard titre="Jours couverts" valeur={jours} icone={CalendarCheck} />
        <StatCard
          titre="Arrivées non vérifiées"
          valeur={nonVerifies}
          icone={AlertTriangle}
          ton={nonVerifies ? "danger" : "neutre"}
          detail="Entrées par code, sans reconnaissance"
        />
      </div>

      {chargement ? (
        <Chargement />
      ) : bilan.length === 0 ? (
        <Card>
          <Vide
            icone={Clock}
            titre="Aucun pointage sur cette période"
            description="Une arrivée est enregistrée à la première identification de la journée."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Assiduité par personne</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                L'écart entre l'arrivée la plus tôt et la plus tardive en dit souvent plus que la
                moyenne.
              </p>
            </div>
            <Tableau
              entetes={["Employé", " Jours", " Arrivée moyenne", " Plus tôt", " Plus tard", " Non vérifiées"]}
            >
              {bilan.map((b) => (
                <tr key={b.profileId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{b.nom}</td>
                  <td className="px-4 py-3 text-right tabulaire">{b.jours}</td>
                  <td className="px-4 py-3 text-right tabulaire font-medium">{b.arriveeMoyenne}</td>
                  <td className="px-4 py-3 text-right tabulaire text-gray-600">{b.plusTot}</td>
                  <td className="px-4 py-3 text-right tabulaire text-gray-600">{b.plusTard}</td>
                  <td className="px-4 py-3 text-right">
                    {b.nonVerifies > 0
                      ? <Badge ton="alerte">{b.nonVerifies}</Badge>
                      : <span className="text-gray-400 tabulaire">0</span>}
                  </td>
                </tr>
              ))}
            </Tableau>
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Détail des arrivées</h2>
            </div>
            <Tableau entetes={["Date", "Heure", "Employé", "Établissement", "Méthode"]}>
              {pointages.map((p) => (
                <tr key={p.id} className={p.verifie ? "hover:bg-gray-50" : "bg-amber-50/40"}>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(p.jour)}</td>
                  <td className="px-4 py-3 tabulaire font-medium whitespace-nowrap">{heure(p.arriveA)}</td>
                  <td className="px-4 py-3 text-gray-900">{p.nom}</td>
                  <td className="px-4 py-3 text-gray-600">{p.etablissementNom}</td>
                  <td className="px-4 py-3">
                    {p.verifie
                      ? <Badge ton="succes">Visage reconnu</Badge>
                      : <Badge ton="alerte">Code — non vérifiée</Badge>}
                  </td>
                </tr>
              ))}
            </Tableau>
          </Card>
        </div>
      )}
    </Layout>
  );
}
