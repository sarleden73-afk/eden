import { useCallback, useEffect, useState } from "react";
import { UserCog, Plus, Pencil, KeyRound, ShieldCheck, FileDown, Copy, Check } from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Erreur, Chargement,
  Badge, Modale, Tableau, Vide,
} from "../components/ui";
import {
  getUtilisateurs, creerUtilisateur, modifierUtilisateur, reinitialiserMotDePasse,
} from "../services/db";
import { dateCourte } from "../lib/format";
import { exporterCSV } from "../lib/export";
import { cn } from "../lib/utils";
import { ROLE_LABELS, type Profile, type UserRole, type Establishment } from "../types";
import { getEtablissements } from "../services/db";
import { useAuth } from "../contexts/AuthContext";

const TONS_ROLE: Record<UserRole, "info" | "succes" | "neutre" | "alerte"> = {
  admin: "info",
  responsable: "succes",
  caissier: "neutre",
  technicien: "alerte",
};

/** Résumé des autorisations du §5.1, affiché pour cadrer la création de compte. */
const DROITS: Record<UserRole, string[]> = {
  admin: [
    "Accès à tout",
    "Gestion des utilisateurs",
    "Modification des prix",
    "Consultation de la comptabilité et des rapports",
  ],
  responsable: [
    "Consultation des ventes et du stock",
    "Validation des dépenses et des annulations",
    "Fermeture de caisse et inventaires",
    "Suivi des employés et rapports",
  ],
  caissier: [
    "Enregistrement des ventes et encaissement",
    "Ouverture de caisse et mouvements",
    "Consultation limitée du stock",
    "Ne voit que ses propres ventes",
  ],
  technicien: [
    "Enregistrement des prestations cyber et infographie",
    "Suivi des commandes clients",
    "Encaissement",
    "Consultation limitée du stock",
  ],
};

/** §5.1 Gestion des utilisateurs — réservé à l'administrateur. */
export default function Personnel() {
  const { profil } = useAuth();
  const [utilisateurs, setUtilisateurs] = useState<Profile[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [edite, setEdite] = useState<Profile | "nouveau" | null>(null);
  const [etablissements, setEtablissements] = useState<Establishment[]>([]);
  const [motDePasseA, setMotDePasseA] = useState<Profile | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setUtilisateurs(await getUtilisateurs());
      setEtablissements(await getEtablissements().catch(() => []));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const exporter = () =>
    exporterCSV(
      "personnel-eden",
      ["Nom complet", "E-mail", "Rôle", "Établissement", "Date d'entrée", "État"],
      utilisateurs.map((u) => [
        u.fullName, u.email, ROLE_LABELS[u.role],
        u.etablissementNom ?? "Tous les établissements",
        dateCourte(u.dateEntree), u.actif ? "Actif" : "Désactivé",
      ])
    );

  return (
    <Layout>
      <PageHeader titre="Personnel" sousTitre="Comptes, rôles et autorisations">
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!utilisateurs.length}>
          Excel
        </Bouton>
        <Bouton icone={Plus} onClick={() => setEdite("nouveau")}>Nouveau compte</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Card>
        {chargement ? (
          <Chargement />
        ) : utilisateurs.length === 0 ? (
          <Vide icone={UserCog} titre="Aucun compte" />
        ) : (
          <Tableau entetes={["Employé", "Rôle", "Établissement", "Entrée", "État", ""]}>
            {utilisateurs.map((u) => (
              <tr key={u.id} className={cn("hover:bg-gray-50", !u.actif && "opacity-50")}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {u.fullName}
                    {u.id === profil?.id && <span className="ml-2 text-xs text-gray-500">(vous)</span>}
                  </div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-4 py-3"><Badge ton={TONS_ROLE[u.role]}>{ROLE_LABELS[u.role]}</Badge></td>
                <td className="px-4 py-3 text-gray-600 text-sm">
                  {u.etablissementNom ?? <span className="text-gray-400">Tous</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(u.dateEntree)}</td>
                <td className="px-4 py-3">
                  {u.actif ? <Badge ton="succes">Actif</Badge> : <Badge ton="neutre">Désactivé</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setMotDePasseA(u)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      title="Réinitialiser le mot de passe"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEdite(u)}
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

      <Card className="mt-5 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="h-5 w-5 text-indigo-600" />
          <h2 className="font-semibold text-gray-900">Ce que permet chaque rôle</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(DROITS) as UserRole[]).map((role) => (
            <div key={role} className="p-4 bg-gray-50 rounded-lg">
              <Badge ton={TONS_ROLE[role]}>{ROLE_LABELS[role]}</Badge>
              <ul className="mt-3 space-y-1.5">
                {DROITS[role].map((d) => (
                  <li key={d} className="flex gap-2 text-xs text-gray-600">
                    <span className="text-indigo-500 shrink-0">•</span>{d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Ces règles sont appliquées côté serveur : masquer un écran ne suffirait pas, chaque
          appel à l'API vérifie le rôle de l'utilisateur qui le déclenche.
        </p>
      </Card>

      <ModaleUtilisateur
        cible={edite} etablissements={etablissements} onFermer={() => setEdite(null)}
        onSucces={() => { setEdite(null); void recharger(); }}
      />
      <ModaleMotDePasse utilisateur={motDePasseA} onFermer={() => setMotDePasseA(null)} />
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function ModaleUtilisateur({
  cible, etablissements, onFermer, onSucces,
}: {
  cible: Profile | "nouveau" | null;
  etablissements: Establishment[];
  onFermer: () => void;
  onSucces: () => void;
}) {
  const nouveau = cible === "nouveau";
  const utilisateur = nouveau ? null : cible;

  const [form, setForm] = useState({
    fullName: "", email: "", password: "", role: "caissier" as UserRole,
    establishmentId: "", dateEntree: "", actif: true,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm({
      fullName: utilisateur?.fullName ?? "",
      email: utilisateur?.email ?? "",
      password: "",
      role: utilisateur?.role ?? "caissier",
      establishmentId: utilisateur?.establishmentId ? String(utilisateur.establishmentId) : "",
      dateEntree: utilisateur?.dateEntree?.slice(0, 10) ?? "",
      actif: utilisateur?.actif ?? true,
    });
  }, [cible, utilisateur]);

  if (!cible) return null;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const commun = {
        fullName: form.fullName.trim(),
        role: form.role,
        establishmentId: form.establishmentId ? Number(form.establishmentId) : null,
        dateEntree: form.dateEntree || undefined,
      };
      if (utilisateur) {
        await modifierUtilisateur(utilisateur.id, { ...commun, actif: form.actif });
      } else {
        await creerUtilisateur({ ...commun, email: form.email.trim(), password: form.password });
      }
      onSucces();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  const valide =
    form.fullName.trim() &&
    (utilisateur || (form.email.trim() && form.password.length >= 8));

  return (
    <Modale
      ouverte
      titre={nouveau ? "Nouveau compte" : `Modifier — ${utilisateur?.fullName}`}
      onFermer={onFermer}
      taille="lg"
    >
      <Erreur message={erreur} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ label="Nom complet">
            <Saisie
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              autoFocus
            />
          </Champ>
        </div>

        <Champ label="Identifiant (e-mail)" aide={utilisateur ? "Non modifiable après création." : undefined}>
          <Saisie
            type="email" value={form.email} disabled={!!utilisateur}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="prenom.nom@eden.cg"
          />
        </Champ>

        {nouveau && (
          <Champ label="Mot de passe initial" aide="8 caractères minimum. À communiquer à l'employé.">
            <Saisie
              type="text" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Champ>
        )}

        <Champ label="Rôle">
          <Liste value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Liste>
        </Champ>

        <Champ
          label="Établissement de rattachement"
          aide={
            form.role === "caissier" || form.role === "technicien"
              ? "Obligatoire : ce rôle ne peut pas accéder à plusieurs établissements."
              : "« Tous » donne accès à chaque établissement et à la vue consolidée."
          }
        >
          <Liste
            value={form.establishmentId}
            onChange={(e) => setForm({ ...form, establishmentId: e.target.value })}
          >
            {/* Le rattachement « tous » n'est proposé qu'aux rôles qui peuvent
                réellement basculer d'un établissement à l'autre (§5.1). */}
            {(form.role === "admin" || form.role === "responsable") && (
              <option value="">Tous les établissements</option>
            )}
            {etablissements.filter((e) => e.actif).map((e) => (
              <option key={e.id} value={e.id}>{e.nom}</option>
            ))}
          </Liste>
        </Champ>

        {/* Poste, téléphone et salaire ont été retirés : le rôle dit déjà ce que
            fait la personne, et le salaire relève de la paie, pas d'un écran
            que plusieurs personnes peuvent consulter. */}
        <Champ label="Date d'entrée" aide="Facultatif.">
          <Saisie
            type="date" value={form.dateEntree}
            onChange={(e) => setForm({ ...form, dateEntree: e.target.value })}
          />
        </Champ>
      </div>

      <div className="p-3 mt-4 bg-gray-50 rounded-lg">
        <p className="text-xs font-medium text-gray-700 mb-1.5">
          Droits associés au rôle « {ROLE_LABELS[form.role]} »
        </p>
        <ul className="space-y-1">
          {DROITS[form.role].map((d) => (
            <li key={d} className="flex gap-2 text-xs text-gray-600">
              <span className="text-indigo-500">•</span>{d}
            </li>
          ))}
        </ul>
      </div>

      {utilisateur && (
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
          <input
            type="checkbox" checked={form.actif}
            onChange={(e) => setForm({ ...form, actif: e.target.checked })}
            className="h-4 w-4 rounded accent-indigo-600"
          />
          Compte actif
          <span className="text-xs text-gray-500">
            — désactiver coupe l'accès sans effacer l'historique des ventes.
          </span>
        </label>
      )}

      <div className="flex gap-2 mt-5">
        <Bouton variante="secondaire" onClick={onFermer} className="flex-1">Annuler</Bouton>
        <Bouton onClick={soumettre} chargement={envoi} disabled={!valide} className="flex-1">
          {nouveau ? "Créer le compte" : "Enregistrer"}
        </Bouton>
      </div>
    </Modale>
  );
}

function ModaleMotDePasse({
  utilisateur, onFermer,
}: { utilisateur: Profile | null; onFermer: () => void }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [fait, setFait] = useState(false);
  const [copie, setCopie] = useState(false);

  useEffect(() => { setMotDePasse(""); setErreur(null); setFait(false); setCopie(false); }, [utilisateur]);

  if (!utilisateur) return null;

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await reinitialiserMotDePasse(utilisateur.id, motDePasse);
      setFait(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Réinitialisation impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  const copier = () => {
    void navigator.clipboard.writeText(motDePasse).then(() => {
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    });
  };

  return (
    <Modale ouverte titre={`Mot de passe — ${utilisateur.fullName}`} onFermer={onFermer}>
      <Erreur message={erreur} />

      {fait ? (
        <div className="space-y-4">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-900">
            Mot de passe réinitialisé. Communiquez-le à l'employé — il ne sera plus affiché après
            la fermeture de cette fenêtre.
          </div>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg font-mono text-sm">
            <span className="flex-1 break-all">{motDePasse}</span>
            <button onClick={copier} className="p-1.5 rounded hover:bg-gray-200 shrink-0" title="Copier">
              {copie ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-500" />}
            </button>
          </div>
          <Bouton onClick={onFermer} className="w-full">Fermer</Bouton>
        </div>
      ) : (
        <div className="space-y-4">
          <Champ label="Nouveau mot de passe" aide="8 caractères minimum.">
            <Saisie
              type="text" value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)} autoFocus
            />
          </Champ>
          <Bouton
            onClick={soumettre} chargement={envoi}
            disabled={motDePasse.length < 8} icone={KeyRound} className="w-full"
          >
            Réinitialiser le mot de passe
          </Bouton>
        </div>
      )}
    </Modale>
  );
}
