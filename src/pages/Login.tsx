import { useEffect, useState, type FormEvent, type ButtonHTMLAttributes } from "react";
import {
  Sprout, LogIn, ShieldCheck, ArrowLeft, Delete, User, ScanFace, KeyRound, Check,
  CameraOff, Clock,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Bouton, Champ, Saisie, Erreur } from "../components/ui";
import Camera from "../components/Camera";
import {
  getEtablissementsConnexion, getPersonnelConnexion, getMarque, ApiError,
} from "../services/db";
import { cn } from "../lib/utils";
import { heure } from "../lib/format";
import { ESSAIS_AVANT_REPLI } from "../lib/visage";
import type { AgentConnexion } from "../types";

type Panneau = "personnel" | "administration";

/**
 * §5.1 Connexion.
 *
 * Deux publics, deux écrans. Le personnel de terrain touche son nom puis se
 * présente à la caméra : la première identification de la journée vaut
 * pointage. Les connexions suivantes se font au code — il serait absurde de
 * refaire une photo à chaque retour derrière le comptoir.
 *
 * Cette règle n'est pas qu'une préférence d'affichage : le serveur refuse le
 * code tant que l'arrivée du jour n'est pas enregistrée. Sans cela, chacun
 * déclarerait sa propre heure d'arrivée et le suivi de ponctualité ne vaudrait
 * rien. L'écran se contente donc de suivre ce que le serveur répond.
 *
 * Le propriétaire et les responsables passent par l'espace administrateur,
 * avec adresse et mot de passe : ils atteignent la comptabilité et les comptes,
 * cela justifie une authentification plus exigeante.
 */
export default function Login() {
  const [panneau, setPanneau] = useState<Panneau>("personnel");
  const [marque, setMarque] = useState({ nom: "EDEN MULTI-SERVICES", logoUrl: "" });

  // Le logo est facultatif : son absence laisse simplement l'icône par défaut.
  useEffect(() => { getMarque().then(setMarque).catch(() => {}); }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          {marque.logoUrl ? (
            <img
              src={marque.logoUrl}
              alt=""
              className="h-16 w-16 rounded-2xl object-contain bg-white p-1"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <div className="p-3 bg-indigo-950 rounded-2xl">
              <Sprout className="h-8 w-8 text-indigo-400" />
            </div>
          )}
          <h1 className="mt-4 text-xl font-bold text-[#fff] tracking-wide text-center">
            {marque.nom}
          </h1>
          <p className="mt-1 text-sm text-gray-500 text-center">
            {panneau === "personnel" ? "Connexion du personnel" : "Espace administrateur"}
          </p>
        </div>

        {panneau === "personnel" ? (
          <PanneauPersonnel onAdministration={() => setPanneau("administration")} />
        ) : (
          <PanneauAdministration onRetour={() => setPanneau("personnel")} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personnel : nom, puis visage ou code
// ---------------------------------------------------------------------------

const LONGUEUR_CODE = 6;

type Etape = "choix" | "visage" | "code";

function PanneauPersonnel({ onAdministration }: { onAdministration: () => void }) {
  const { connexionAgent, connexionVisage } = useAuth();

  const [etablissements, setEtablissements] = useState<{ id: number; nom: string; couleur: string }[]>([]);
  const [etablissementId, setEtablissementId] = useState<number | null>(null);
  const [agents, setAgents] = useState<AgentConnexion[]>([]);
  const [agentId, setAgentId] = useState("");
  const [etape, setEtape] = useState<Etape>("choix");
  const [echecs, setEchecs] = useState(0);
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [pointage, setPointage] = useState<{ arriveA: string } | null>(null);

  // Le serveur a renvoyé « pointage_requis » : le code est bon, mais l'arrivée
  // du jour n'est pas encore enregistrée. On garde le code sous la main pour
  // ouvrir la session dès que le visage aura été reconnu, ou par la porte de
  // secours si la caméra est hors d'usage.
  const [codeEnAttente, setCodeEnAttente] = useState<string | null>(null);
  const [secours, setSecours] = useState(false);
  const [raisonSecours, setRaisonSecours] = useState("");

  useEffect(() => {
    let annule = false;
    Promise.all([getEtablissementsConnexion(), getPersonnelConnexion()])
      .then(([etabs, personnes]) => {
        if (annule) return;
        setEtablissements(etabs);
        setAgents(personnes);
        if (etabs.length === 1) setEtablissementId(etabs[0].id);
        setErreur(null);
      })
      .catch((e) => { if (!annule) setErreur(e.message); })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, []);

  const agentsVisibles = etablissementId
    ? agents.filter((a) => a.establishmentId === etablissementId)
    : agents;
  const agentChoisi = agents.find((a) => a.id === agentId) ?? null;

  const reinitialiser = () => {
    setCode("");
    setEchecs(0);
    setErreur(null);
    setCodeEnAttente(null);
    setSecours(false);
    setRaisonSecours("");
  };

  const choisir = (a: AgentConnexion) => {
    setAgentId(a.id);
    reinitialiser();
    // Sans visage enregistré, ouvrir la caméra ne mènerait nulle part.
    setEtape(a.visageEnregistre ? "visage" : "code");
  };

  const revenir = () => {
    setAgentId("");
    setEtape("choix");
    reinitialiser();
  };

  const parVisage = async (empreinte: number[]) => {
    if (envoi) return;
    setEnvoi(true);
    try {
      const r = await connexionVisage(etablissementId, empreinte);
      if (r.pointage) setPointage({ arriveA: r.pointage.arriveA });
      // La session est posée : AuthContext prend le relais et l'écran change.
    } catch (e) {
      const restants = echecs + 1;
      setEchecs(restants);

      if (restants < ESSAIS_AVANT_REPLI) {
        setErreur(e instanceof Error ? e.message : "Visage non reconnu.");
        return;
      }

      // Après plusieurs échecs, deux situations. Le code a déjà été saisi et
      // renvoyé ici : la porte de secours apparaît juste en dessous. Sinon on
      // demande le code — le serveur le refusera et ramènera à la caméra, ce
      // qui ouvrira cette même porte, sans jamais laisser le code se
      // substituer discrètement au visage.
      if (codeEnAttente) {
        setErreur("Reconnaissance impossible après plusieurs essais. Replacez-vous face à la caméra, dans un meilleur éclairage.");
      } else {
        setErreur("Reconnaissance impossible. Saisissez votre code : la suite vous sera indiquée.");
        setEtape("code");
      }
    } finally {
      setEnvoi(false);
    }
  };

  const parCode = async (raison?: string) => {
    const chiffres = raison ? codeEnAttente : code;
    if (!agentId || chiffres?.length !== LONGUEUR_CODE || envoi) return;

    setEnvoi(true);
    setErreur(null);
    try {
      const r = await connexionAgent(agentId, chiffres, raison ? { raison } : undefined);
      if (r.pointage) setPointage({ arriveA: r.pointage.arriveA });
    } catch (e) {
      // Le code est bon, mais l'arrivée du jour n'est pas enregistrée : on
      // renvoie vers la caméra sans faire ressaisir le code.
      if (e instanceof ApiError && e.code === "pointage_requis") {
        setCodeEnAttente(chiffres);
        setCode("");
        setEtape("visage");
        setErreur(null);
      } else {
        setErreur(e instanceof Error ? e.message : "Connexion impossible.");
        setCode("");
      }
    } finally {
      setEnvoi(false);
    }
  };

  // Le code part dès qu'il est complet : au comptoir, un bouton de plus à
  // viser, c'est une seconde perdue à chaque connexion.
  useEffect(() => {
    if (code.length === LONGUEUR_CODE && agentId) void parCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const ouvrirParSecours = async () => {
    const raison = raisonSecours.trim();
    if (raison.length < 3) {
      setErreur("Indiquez en quelques mots pourquoi la caméra ne peut pas servir.");
      return;
    }
    await parCode(raison);
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-xl">
      <Erreur message={erreur} />

      {pointage && (
        <div className="flex items-center gap-2.5 p-3 mb-4 bg-green-50 border border-green-200 rounded-lg">
          <Check className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-900">
            Arrivée enregistrée à <strong>{heure(pointage.arriveA)}</strong>.
          </p>
        </div>
      )}

      {chargement ? (
        <p className="py-8 text-sm text-center text-gray-500">Chargement…</p>
      ) : agents.length === 0 ? (
        <div className="py-6 text-center">
          <User className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="mt-3 text-sm text-gray-600">
            Aucun compte de personnel n'est encore enregistré.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            L'administrateur les crée depuis l'écran Personnel.
          </p>
        </div>
      ) : etape === "choix" ? (
        <>
          {etablissements.length > 1 && (
            <div className="flex gap-2 mb-4">
              {etablissements.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEtablissementId(e.id)}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors",
                    etablissementId === e.id
                      ? "text-[#fff] border-transparent"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  )}
                  style={etablissementId === e.id ? { backgroundColor: e.couleur } : undefined}
                >
                  {e.nom.replace(/^EDEN\s+/i, "")}
                </button>
              ))}
            </div>
          )}

          <p className="text-sm font-medium text-gray-700 mb-2">Qui êtes-vous ?</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {agentsVisibles.length === 0 ? (
              <p className="py-6 text-sm text-center text-gray-500">
                Aucun compte pour cet établissement.
              </p>
            ) : (
              agentsVisibles.map((a) => (
                <button
                  key={a.id}
                  onClick={() => choisir(a)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 hover:border-indigo-400 hover:bg-gray-50 text-left transition-colors"
                >
                  <span className="h-9 w-9 rounded-full bg-indigo-50 text-indigo-700 font-semibold flex items-center justify-center shrink-0">
                    {a.fullName[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{a.fullName}</span>
                    {a.fonction && (
                      <span className="block text-xs text-gray-500 truncate">{a.fonction}</span>
                    )}
                  </span>
                  {a.visageEnregistre && <ScanFace className="h-4 w-4 text-gray-400 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={revenir}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Changer de nom
          </button>

          <p className="text-center text-sm text-gray-600">Bonjour</p>
          <p className="text-center text-lg font-semibold text-gray-900 mb-4">
            {agentChoisi?.fullName}
          </p>

          {etape === "visage" ? (
            <>
              {codeEnAttente && (
                <div className="flex items-start gap-2.5 p-3 mb-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                  <Clock className="h-5 w-5 text-indigo-600 shrink-0 mt-px" />
                  <p className="text-sm text-indigo-950">
                    Votre code est bon, mais c'est votre <strong>première connexion du jour</strong> :
                    l'arrivée s'enregistre par la caméra. Vous n'aurez pas à ressaisir votre code.
                  </p>
                </div>
              )}

              <Camera
                automatique
                onLecture={({ empreinte }) => parVisage(empreinte)}
                message="Regardez la caméra. Votre arrivée sera enregistrée automatiquement."
              />

              {/* Porte de secours : seulement après plusieurs échecs, et jamais
                  sans motif. Une issue trop facile redeviendrait le chemin
                  normal, et l'heure d'arrivée ne vaudrait plus rien. */}
              {codeEnAttente && echecs >= ESSAIS_AVANT_REPLI ? (
                secours ? (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2.5">
                    <p className="text-sm text-amber-900">
                      Votre arrivée sera enregistrée comme <strong>non vérifiée</strong> et signalée
                      à la direction avec ce motif.
                    </p>
                    <Saisie
                      value={raisonSecours}
                      onChange={(e) => setRaisonSecours(e.target.value)}
                      placeholder="Caméra en panne, objectif cassé…"
                      maxLength={120}
                      autoFocus
                    />
                    <Bouton
                      variante="secondaire"
                      chargement={envoi}
                      onClick={ouvrirParSecours}
                      className="w-full"
                    >
                      Entrer sans reconnaissance
                    </Bouton>
                  </div>
                ) : (
                  <button
                    onClick={() => { setSecours(true); setErreur(null); }}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-amber-700 hover:text-amber-800"
                  >
                    <CameraOff className="h-4 w-4" />
                    La caméra ne fonctionne pas
                  </button>
                )
              ) : !codeEnAttente ? (
                <button
                  onClick={() => { setEtape("code"); setErreur(null); }}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500 hover:text-indigo-700"
                >
                  <KeyRound className="h-4 w-4" />
                  Déjà pointé aujourd'hui — utiliser mon code
                </button>
              ) : null}
            </>
          ) : (
            <>
              {/* Points de progression : on voit combien de chiffres restent
                  sans jamais afficher le code lui-même. */}
              <div className="flex justify-center gap-2.5 mb-5">
                {Array.from({ length: LONGUEUR_CODE }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-3 w-3 rounded-full border-2 transition-colors",
                      i < code.length ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                    )}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                  <TouchePave
                    key={n}
                    disabled={envoi}
                    onClick={() => {
                      setErreur(null);
                      setCode((c) => (c.length >= LONGUEUR_CODE ? c : c + n));
                    }}
                  >
                    {n}
                  </TouchePave>
                ))}
                <div />
                <TouchePave
                  disabled={envoi}
                  onClick={() => {
                    setErreur(null);
                    setCode((c) => (c.length >= LONGUEUR_CODE ? c : c + "0"));
                  }}
                >
                  0
                </TouchePave>
                <TouchePave
                  disabled={envoi || code.length === 0}
                  onClick={() => { setErreur(null); setCode((c) => c.slice(0, -1)); }}
                  aria-label="Effacer le dernier chiffre"
                >
                  <Delete className="h-5 w-5 mx-auto" />
                </TouchePave>
              </div>

              {agentChoisi?.visageEnregistre && echecs < ESSAIS_AVANT_REPLI && (
                <button
                  onClick={() => { setEtape("visage"); setErreur(null); }}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500 hover:text-indigo-700"
                >
                  <ScanFace className="h-4 w-4" />
                  Pointer avec mon visage
                </button>
              )}

              {envoi && <p className="mt-4 text-sm text-center text-gray-500">Connexion…</p>}
            </>
          )}
        </>
      )}

      <div className="mt-5 pt-4 border-t border-gray-200">
        <button
          onClick={onAdministration}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500 hover:text-indigo-700 transition-colors"
        >
          <ShieldCheck className="h-4 w-4" />
          Espace administrateur
        </button>
      </div>
    </div>
  );
}

function TouchePave({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      // Cibles larges : la saisie se fait au doigt, souvent debout au comptoir.
      className="py-4 text-xl font-semibold text-gray-900 rounded-lg border border-gray-200 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Administration : e-mail + mot de passe
// ---------------------------------------------------------------------------

function PanneauAdministration({ onRetour }: { onRetour: () => void }) {
  const { connexion, erreurProfil } = useAuth();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      await connexion(email.trim(), motDePasse);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={soumettre} className="bg-white rounded-xl p-5 shadow-xl space-y-4">
      <Erreur message={erreur ?? erreurProfil} />

      <Champ label="Adresse e-mail">
        <Saisie
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="username" placeholder="adresse@exemple.com" required autoFocus
        />
      </Champ>

      <Champ label="Mot de passe">
        <Saisie
          type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
          autoComplete="current-password" required
        />
      </Champ>

      <Bouton type="submit" icone={LogIn} chargement={envoi} className="w-full">
        Se connecter
      </Bouton>

      <div className="pt-2 border-t border-gray-200">
        <button
          type="button"
          onClick={onRetour}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500 hover:text-indigo-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Connexion du personnel
        </button>
      </div>
    </form>
  );
}
