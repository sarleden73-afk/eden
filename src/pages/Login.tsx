import { useState, type FormEvent } from "react";
import { Sprout, LogIn } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Bouton, Champ, Saisie, Erreur } from "../components/ui";

/**
 * §5.1 : chaque employé dispose d'un identifiant et d'un mot de passe.
 * Les comptes sont créés par l'administrateur depuis l'écran Personnel — pas
 * d'auto-inscription, une plateforme de contrôle interne ne peut pas laisser
 * n'importe qui se créer un accès.
 */
export default function Login() {
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-indigo-950 rounded-2xl">
            <Sprout className="h-8 w-8 text-indigo-400" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white tracking-wide">EDEN MULTI-SERVICES</h1>
          <p className="mt-1 text-sm text-gray-500">Plateforme de gestion et de contrôle interne</p>
        </div>

        <form onSubmit={soumettre} className="bg-white rounded-xl p-6 shadow-xl space-y-4">
          <Erreur message={erreur ?? erreurProfil} />

          <Champ label="Identifiant (e-mail)">
            <Saisie
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="prenom.nom@eden.cg"
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

          <p className="text-xs text-center text-gray-500 pt-1">
            Vous n'avez pas d'accès ? Contactez l'administrateur de la plateforme.
          </p>
        </form>
      </div>
    </div>
  );
}
