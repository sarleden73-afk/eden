import { useCallback, useEffect, useState } from "react";
import { ScanFace, Check, Clock, UserX, AlertTriangle } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Erreur, Chargement, Badge, Vide, BandeauChoisirEtablissement,
} from "../components/ui";
import Camera from "../components/Camera";
import Aide from "../components/Aide";
import { getPointagesDuJour, pointerParVisage } from "../services/db";
import { heure, dateCourte } from "../lib/format";
import { useEtablissement } from "../contexts/EtablissementContext";
import type { PointageDuJour } from "../types";

/**
 * Pointage des arrivées.
 *
 * Un collègue peut pointer depuis un poste déjà ouvert, sans que la personne
 * connectée ait à se déconnecter : au comptoir, faire fermer la caisse pour
 * enregistrer une arrivée ferait perdre du temps à deux personnes.
 *
 * L'écran reste en analyse continue : on se présente devant la caméra, on est
 * reconnu, c'est enregistré. Rien à toucher.
 */
export default function Pointage() {
  const { selection, pourEcriture, libelle } = useEtablissement();

  const [jour, setJour] = useState<PointageDuJour | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<{ nom: string; deja: boolean } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const recharger = useCallback(async () => {
    try {
      setJour(await getPointagesDuJour(selection));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, [selection]);

  useEffect(() => { void recharger(); }, [recharger]);

  const pointer = async (empreinte: number[]) => {
    if (pourEcriture === null || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await pointerParVisage(pourEcriture, empreinte);
      setSucces({ nom: r.nom, deja: r.dejaPointe });
      void recharger();
      // Le message s'efface seul : l'écran doit redevenir disponible pour la
      // personne suivante sans qu'on ait à cliquer.
      window.setTimeout(() => setSucces(null), 4000);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Visage non reconnu.");
      window.setTimeout(() => setErreur(null), 4000);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Layout>
      <PageHeader
        titre="Pointage"
        sousTitre={`${libelle} — arrivées du ${dateCourte(jour?.jour ?? new Date().toISOString())}`}
      />

      <Aide
        cle="pointage"
        pour={["admin", "responsable", "caissier", "technicien"]}
        titre="À quoi sert cet onglet"
      >
        <p>
          Un collègue peut pointer son arrivée ici <strong>sans que vous vous déconnectiez</strong> :
          il se présente à la caméra, le logiciel le reconnaît, c'est enregistré. Votre session
          reste ouverte, la caisse aussi.
        </p>
        <p>
          Si la personne n'est pas reconnue, faites-la se replacer face à l'objectif dans un
          meilleur éclairage. À défaut, elle peut se connecter avec son code : l'arrivée est alors
          enregistrée comme <strong>non vérifiée</strong> et signalée à la direction.
        </p>
      </Aide>

      {pourEcriture === null ? (
        <BandeauChoisirEtablissement action="enregistrer un pointage" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* --- Caméra --- */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <ScanFace className="h-5 w-5 text-indigo-600" />
              <h2 className="font-semibold text-gray-900">Se présenter à la caméra</h2>
            </div>

            {succes ? (
              <div className="py-10 text-center">
                <div className="mx-auto h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <Check className="h-8 w-8 text-green-700" />
                </div>
                <p className="mt-4 text-lg font-semibold text-gray-900">{succes.nom}</p>
                <p className="mt-1 text-sm text-gray-600">
                  {succes.deja
                    ? "Vous aviez déjà pointé aujourd'hui."
                    : "Arrivée enregistrée. Bonne journée."}
                </p>
              </div>
            ) : (
              <>
                <Camera
                  automatique
                  onLecture={({ empreinte }) => pointer(empreinte)}
                  message="Le pointage se fait tout seul dès que le visage est reconnu."
                />
                {erreur && (
                  <p className="mt-3 text-sm text-center text-amber-700">{erreur}</p>
                )}
              </>
            )}
          </Card>

          {/* --- Arrivées du jour --- */}
          <div className="space-y-5">
            <Card>
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">Déjà arrivés</h2>
              </div>

              {chargement ? (
                <Chargement />
              ) : !jour?.pointages.length ? (
                <Vide
                  icone={Clock}
                  titre="Personne n'a encore pointé"
                  description="La première identification de la journée enregistre l'arrivée."
                />
              ) : (
                <div className="divide-y divide-gray-100">
                  {jour.pointages.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="h-9 w-9 rounded-full bg-green-100 text-green-800 font-semibold flex items-center justify-center shrink-0">
                        {p.nom?.[0]?.toUpperCase() ?? "?"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.nom}</p>
                        <p className="text-xs text-gray-500">
                          Arrivé à {heure(p.arriveA)}
                        </p>
                      </div>
                      {p.verifie ? (
                        <Badge ton="succes">Visage</Badge>
                      ) : (
                        <Badge ton="alerte">
                          <AlertTriangle className="inline h-3 w-3 mr-1" />
                          Code
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {!!jour?.absents.length && (
              <Card>
                <div className="px-5 py-4 border-b border-gray-200">
                  <h2 className="font-semibold text-gray-900">Pas encore arrivés</h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {jour.absents.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="h-9 w-9 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0">
                        <UserX className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{a.fullName}</p>
                        {a.fonction && <p className="text-xs text-gray-500">{a.fonction}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      <Erreur message={pourEcriture !== null ? null : erreur} />
    </Layout>
  );
}
