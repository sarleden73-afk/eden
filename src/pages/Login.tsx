import { useEffect, useState, type FormEvent, type ButtonHTMLAttributes } from "react";
import { Sprout, LogIn, ShieldCheck, ArrowLeft, Delete, User } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Bouton, Champ, Saisie, Erreur } from "../components/ui";
import { getEtablissementsConnexion, getPersonnelConnexion } from "../services/db";
import { cn } from "../lib/utils";
import type { AgentConnexion } from "../types";

type Panneau = "personnel" | "administration";

/**
 * §5.1 Connexion.
 *
 * Deux publics, deux écrans. Le personnel de terrain touche son nom dans une
 * liste et compose un code à six chiffres : rien à taper, rien à retenir de
 * plus, et l'application sait toujours qui encaisse. Le propriétaire et les
 * responsables passent par l'espace administrateur, avec adresse et mot de
 * passe — ils atteignent la comptabilité et les comptes, cela justifie une
 * authentification plus exigeante.
 */
export default function Login() {
  const [panneau, setPanneau] = useState<Panneau>("personnel");

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-7">
          <div className="p-3 bg-indigo-950 rounded-2xl">
            <Sprout className="h-8 w-8 text-indigo-400" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-white tracking-wide text-center">
            EDEN MULTI-SERVICES
          </h1>
          <p className="mt-1 text-sm text-gray-500 text-center">
            {panneau === "personnel"
              ? "Connexion du personnel"
              : "Espace administrateur"}
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
// Personnel : nom + code
// ---------------------------------------------------------------------------

const LONGUEUR_CODE = 6;

function PanneauPersonnel({ onAdministration }: { onAdministration: () => void }) {
  const { connexionAgent } = useAuth();

  const [etablissements, setEtablissements] = useState<{ id: number; nom: string; couleur: string }[]>([]);
  const [etablissementId, setEtablissementId] = useState<number | null>(null);
  const [agents, setAgents] = useState<AgentConnexion[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    Promise.all([getEtablissementsConnexion(), getPersonnelConnexion()])
      .then(([etabs, personnes]) => {
        if (annule) return;
        setEtablissements(etabs);
        setAgents(personnes);
        // Un seul établissement : inutile de faire choisir.
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

  const composer = (chiffre: string) => {
    setErreur(null);
    setCode((c) => (c.length >= LONGUEUR_CODE ? c : c + chiffre));
  };

  const valider = async () => {
    if (!agentId || code.length !== LONGUEUR_CODE) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await connexionAgent(agentId, code);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Connexion impossible.");
      setCode("");
    } finally {
      setEnvoi(false);
    }
  };

  // Le code part tout seul dès qu'il est complet : au comptoir, un bouton de
  // plus à viser, c'est une seconde perdue à chaque connexion.
  useEffect(() => {
    if (code.length === LONGUEUR_CODE && agentId && !envoi) void valider();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="bg-white rounded-xl p-5 shadow-xl">
      <Erreur message={erreur} />

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
      ) : !agentId ? (
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
                      ? "text-white border-transparent"
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
                  onClick={() => { setAgentId(a.id); setCode(""); setErreur(null); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 hover:border-indigo-400 hover:bg-gray-50 text-left transition-colors"
                >
                  <span className="h-9 w-9 rounded-full bg-indigo-50 text-indigo-700 font-semibold flex items-center justify-center shrink-0">
                    {a.fullName[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{a.fullName}</span>
                    {a.fonction && (
                      <span className="block text-xs text-gray-500 truncate">{a.fonction}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={() => { setAgentId(""); setCode(""); setErreur(null); }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Changer de nom
          </button>

          <p className="text-center text-sm text-gray-600">Bonjour</p>
          <p className="text-center text-lg font-semibold text-gray-900 mb-4">
            {agentChoisi?.fullName}
          </p>

          {/* Points de progression : on voit combien de chiffres restent sans
              jamais afficher le code lui-même. */}
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
              <TouchePave key={n} onClick={() => composer(n)} disabled={envoi}>{n}</TouchePave>
            ))}
            <div />
            <TouchePave onClick={() => composer("0")} disabled={envoi}>0</TouchePave>
            <TouchePave
              onClick={() => { setErreur(null); setCode((c) => c.slice(0, -1)); }}
              disabled={envoi || code.length === 0}
              aria-label="Effacer le dernier chiffre"
            >
              <Delete className="h-5 w-5 mx-auto" />
            </TouchePave>
          </div>

          {envoi && (
            <p className="mt-4 text-sm text-center text-gray-500">Connexion…</p>
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

function TouchePave({
  onClick, disabled, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      onClick={onClick}
      disabled={disabled}
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
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          placeholder="adresse@exemple.com"
          required
          autoFocus
        />
      </Champ>

      <Champ label="Mot de passe">
        <Saisie
          type="password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          autoComplete="current-password"
          required
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
