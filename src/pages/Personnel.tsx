import { useCallback, useEffect, useState } from "react";
import {
  UserCog, Plus, Pencil, KeyRound, ShieldCheck, FileDown, Copy, Check, Mail, Hash, ScanFace,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  PageHeader, Card, Bouton, Saisie, Liste, Champ, Erreur, Chargement,
  Badge, Modale, Tableau, Vide,
} from "../components/ui";
import {
  getUtilisateurs, creerUtilisateur, modifierUtilisateur,
  reinitialiserMotDePasse, definirCodePin, getEtablissements,
} from "../services/db";
import { dateCourte } from "../lib/format";
import { exporterListePDF } from "../lib/export";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import Camera from "../components/Camera";
import Aide from "../components/Aide";
import {
  ROLE_LABELS, ECRAN_LABELS,
  type Profile, type UserRole, type Establishment, type EcranCle,
} from "../types";

const TONS_ROLE: Record<UserRole, "info" | "succes" | "neutre" | "alerte"> = {
  admin: "info",
  responsable: "succes",
  caissier: "neutre",
  technicien: "alerte",
};

/**
 * Rôles à connexion par code : le personnel de terrain, qui n'a pas à taper
 * une adresse e-mail plusieurs fois par jour sur une tablette.
 */
const ROLES_TERRAIN: UserRole[] = ["caissier", "technicien"];

/**
 * Écrans ouverts par rôle. Doit rester aligné sur ECRANS_PAR_ROLE de src/api.ts :
 * c'est le serveur qui tranche, cette liste ne sert qu'à proposer les bonnes
 * cases à cocher.
 */
const ECRANS_TERRAIN: EcranCle[] = [
  "tableau-de-bord", "vente", "caisse", "ventes", "commandes", "pointage",
  "catalogue", "stocks", "depenses",
];

const ECRANS_PAR_ROLE: Record<UserRole, EcranCle[]> = {
  admin: [],
  responsable: [
    "tableau-de-bord", "vente", "caisse", "ventes", "commandes", "pointage",
    "catalogue", "stocks", "achats", "depenses", "rapports", "journal", "personnel",
  ],
  caissier: ECRANS_TERRAIN,
  technicien: ECRANS_TERRAIN,
};

const ecransDuRole = (r: UserRole) => ECRANS_PAR_ROLE[r];
const estTerrain = (r: UserRole) => ROLES_TERRAIN.includes(r);

/** Résumé des autorisations du §5.1, affiché pour cadrer la création de compte. */
const DROITS: Record<UserRole, string[]> = {
  admin: [
    "Accès à tout",
    "Gestion des comptes et des établissements",
    "Modification des prix",
    "Comptabilité et rapports",
  ],
  responsable: [
    "Consultation des ventes et du stock",
    "Validation des dépenses et des annulations",
    "Fermeture de caisse et inventaires",
    "Rapports et journal",
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

/** §5.1 Gestion des comptes — réservé au propriétaire. */
export default function Personnel() {
  const { profil } = useAuth();
  const [utilisateurs, setUtilisateurs] = useState<Profile[]>([]);
  const [etablissements, setEtablissements] = useState<Establishment[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [edite, setEdite] = useState<Profile | "nouveau" | null>(null);
  const [secretA, setSecretA] = useState<Profile | null>(null);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      const [u, e] = await Promise.all([
        getUtilisateurs(),
        getEtablissements().catch(() => [] as Establishment[]),
      ]);
      setUtilisateurs(u);
      setEtablissements(e);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const exporter = () =>
    exporterListePDF(
      "personnel-eden",
      ["Nom complet", "Fonction", "Rôle", "Établissement", "Connexion", "Entrée", "État"],
      utilisateurs.map((u) => [
        u.fullName, u.fonction ?? "", ROLE_LABELS[u.role],
        u.etablissementNom ?? "Tous les établissements",
        u.modeConnexion === "pin" ? "Code à 6 chiffres" : "E-mail et mot de passe",
        dateCourte(u.dateEntree), u.actif ? "Actif" : "Désactivé",
      ])
    );

  return (
    <Layout>
      <PageHeader titre="Personnel" sousTitre="Comptes, rôles et autorisations">
        <Bouton variante="secondaire" icone={FileDown} onClick={exporter} disabled={!utilisateurs.length}>
          PDF
        </Bouton>
        <Bouton icone={Plus} onClick={() => setEdite("nouveau")}>Nouveau compte</Bouton>
      </PageHeader>

      <Erreur message={erreur} />

      <Aide cle="personnel">
        <p>
          Un employé de terrain se connecte avec son <strong>visage</strong> la première fois de la
          journée — cette reconnaissance vaut pointage — puis avec son <strong>code à six
          chiffres</strong> pour les connexions suivantes. Prenez la photo d'inscription à la
          création du compte, dans un bon éclairage.
        </p>
        <p>
          La grille <strong>Écrans autorisés</strong> permet de retirer un écran à une personne sans
          changer son rôle. Elle ne peut que restreindre : cocher un écran que le rôle n'autorise
          pas ne l'ouvre pas.
        </p>
      </Aide>

      <Card>
        {chargement ? (
          <Chargement />
        ) : utilisateurs.length === 0 ? (
          <Vide icone={UserCog} titre="Aucun compte" />
        ) : (
          <Tableau entetes={["Employé", "Rôle", "Établissement", "Connexion", "Entrée", "État", ""]}>
            {utilisateurs.map((u) => (
              <tr key={u.id} className={cn("hover:bg-gray-50", !u.actif && "opacity-50")}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {u.fullName}
                    {u.id === profil?.id && <span className="ml-2 text-xs text-gray-500">(vous)</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {u.fonction ?? (u.modeConnexion === "email" ? u.email : "—")}
                  </div>
                </td>
                <td className="px-4 py-3"><Badge ton={TONS_ROLE[u.role]}>{ROLE_LABELS[u.role]}</Badge></td>
                <td className="px-4 py-3 text-gray-600 text-sm">
                  {u.etablissementNom ?? <span className="text-gray-400">Tous</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    {u.modeConnexion === "pin"
                      ? <><Hash className="h-3.5 w-3.5 text-gray-400" />Code</>
                      : <><Mail className="h-3.5 w-3.5 text-gray-400" />E-mail</>}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateCourte(u.dateEntree)}</td>
                <td className="px-4 py-3">
                  {u.actif ? <Badge ton="succes">Actif</Badge> : <Badge ton="neutre">Désactivé</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setSecretA(u)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      title={u.modeConnexion === "pin" ? "Nouveau code" : "Nouveau mot de passe"}
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
          Le rôle fixe le niveau d'accès ; la fonction, elle, est l'intitulé du poste tel que vous
          le nommez (cuisinière, vendeur, infographe…). Ces règles sont appliquées côté serveur :
          masquer un écran ne suffirait pas, chaque appel à l'API vérifie le rôle de qui le
          déclenche.
        </p>
      </Card>

      <ModaleUtilisateur
        cible={edite}
        etablissements={etablissements}
        onFermer={() => setEdite(null)}
        onSucces={() => { setEdite(null); void recharger(); }}
      />
      <ModaleSecret utilisateur={secretA} onFermer={() => setSecretA(null)} />
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
  const actifs = etablissements.filter((e) => e.actif);

  const [form, setForm] = useState({
    fullName: "", fonction: "", role: "caissier" as UserRole,
    establishmentId: "", dateEntree: "", actif: true,
    email: "", password: "", pin: "",
    photo: "", empreinte: null as number[] | null,
    permissions: null as EcranCle[] | null,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!cible) return;
    setErreur(null);
    setForm({
      fullName: utilisateur?.fullName ?? "",
      fonction: utilisateur?.fonction ?? "",
      role: utilisateur?.role ?? "caissier",
      // Un rôle de terrain exige un établissement : on en propose un d'emblée
      // plutôt que de laisser un champ vide qui affiche pourtant un nom.
      establishmentId: utilisateur?.establishmentId
        ? String(utilisateur.establishmentId)
        : String(actifs[0]?.id ?? ""),
      dateEntree: utilisateur?.dateEntree?.slice(0, 10) ?? "",
      actif: utilisateur?.actif ?? true,
      email: "", password: "", pin: "",
      photo: utilisateur?.photoUrl ?? "",
      empreinte: null,
      permissions: (utilisateur?.permissions as EcranCle[] | null) ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cible]);

  if (!cible) return null;

  const terrain = estTerrain(form.role);

  /**
   * Changer de rôle change les champs attendus. On aligne le rattachement en
   * même temps : passer à un rôle de terrain sans établissement produirait un
   * refus du serveur incompréhensible pour l'utilisateur.
   */
  const changerRole = (role: UserRole) => {
    setForm((f) => ({
      ...f,
      role,
      establishmentId: estTerrain(role)
        ? (f.establishmentId || String(actifs[0]?.id ?? ""))
        : f.establishmentId,
    }));
  };

  /**
   * Coche ou décoche un écran.
   *
   * Tant que rien n'a été touché, `permissions` vaut null : la personne suit
   * exactement son rôle. Le premier décochage matérialise la liste complète
   * moins cet écran — sans quoi décocher une case reviendrait à tout fermer.
   */
  const basculerEcran = (cle: EcranCle, coche: boolean) => {
    setForm((f) => {
      const base = f.permissions ?? ecransDuRole(f.role);
      const suivante = coche ? [...new Set([...base, cle])] : base.filter((e) => e !== cle);
      // Revenu à l'équivalent du rôle : on repasse à null, plus lisible en base.
      const complet = suivante.length === ecransDuRole(f.role).length;
      return { ...f, permissions: complet ? null : suivante };
    });
  };

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const commun = {
        fullName: form.fullName.trim(),
        role: form.role,
        establishmentId: form.establishmentId ? Number(form.establishmentId) : null,
        fonction: form.fonction.trim() || undefined,
        dateEntree: form.dateEntree || undefined,
        permissions: form.permissions,
        ...(form.empreinte ? { visageEmpreinte: form.empreinte, photoUrl: form.photo } : {}),
      };
      if (utilisateur) {
        await modifierUtilisateur(utilisateur.id, { ...commun, actif: form.actif });
      } else if (terrain) {
        await creerUtilisateur({ ...commun, pin: form.pin });
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
    (!terrain || form.establishmentId) &&
    (utilisateur ||
      (terrain
        ? /^\d{6}$/.test(form.pin)
        : form.email.trim() && form.password.length >= 8));

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
              placeholder="Ex. : GBETOU Prince Noël"
              autoFocus
            />
          </Champ>
        </div>

        <Champ label="Rôle" aide="Détermine ce à quoi la personne a accès.">
          <Liste value={form.role} onChange={(e) => changerRole(e.target.value as UserRole)}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Liste>
        </Champ>

        <Champ
          label="Fonction"
          aide="Intitulé du poste, libre. Ex. : Cuisinière, Infographe, Vendeur."
        >
          <Saisie
            value={form.fonction}
            onChange={(e) => setForm({ ...form, fonction: e.target.value })}
            placeholder="Facultatif"
          />
        </Champ>

        <Champ
          label="Établissement"
          aide={
            terrain
              ? "Obligatoire : ce rôle n'accède qu'à un seul établissement."
              : "« Tous » donne accès à chaque établissement et à la vue consolidée."
          }
        >
          <Liste
            value={form.establishmentId}
            onChange={(e) => setForm({ ...form, establishmentId: e.target.value })}
          >
            {!terrain && <option value="">Tous les établissements</option>}
            {actifs.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
          </Liste>
        </Champ>

        <Champ label="Date d'entrée" aide="Date de début dans l'entreprise. Facultatif.">
          <Saisie
            type="date" value={form.dateEntree}
            onChange={(e) => setForm({ ...form, dateEntree: e.target.value })}
          />
        </Champ>

        {/* --- Identifiants, selon le rôle --- */}
        {nouveau && (
          terrain ? (
            <div className="sm:col-span-2">
              <Champ
                label="Code d'accès (6 chiffres)"
                aide="Utilisé pour les connexions suivantes de la journée, une fois le pointage fait."
              >
                <Saisie
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin}
                  onChange={(e) =>
                    setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })
                  }
                  placeholder="Ex. : 240719"
                  className="tabulaire tracking-[0.4em] text-center text-lg"
                />
              </Champ>
              <p className="mt-2 text-xs text-gray-500">
                Aucune adresse e-mail n'est demandée : l'application en génère une, technique et
                invisible, pour que la session reste nominative et que le journal sache toujours
                qui a encaissé.
              </p>
            </div>
          ) : (
            <>
              <Champ label="Adresse e-mail" aide="Sert d'identifiant de connexion.">
                <Saisie
                  type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="prenom.nom@exemple.com"
                />
              </Champ>
              <Champ label="Mot de passe" aide="8 caractères minimum.">
                <Saisie
                  type="text" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Champ>
            </>
          )
        )}
      </div>

      {/* --- Photo d'inscription : sert au pointage du matin --- */}
      {terrain && (
        <div className="mt-5 pt-5 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-1">
            <ScanFace className="h-5 w-5 text-indigo-600" />
            <h3 className="font-medium text-gray-900">Photo d'inscription</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Elle sert à reconnaître la personne au pointage du matin. Ce qui est comparé n'est pas
            l'image mais une empreinte de 128 nombres, dont on ne peut pas reconstituer un visage.
          </p>

          {form.photo ? (
            <div className="flex items-center gap-4">
              <img
                src={form.photo}
                alt=""
                className="h-24 w-24 rounded-xl object-cover border border-gray-200"
              />
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                  <Check className="h-4 w-4" />
                  Visage enregistré
                </p>
                <Bouton
                  variante="secondaire"
                  onClick={() => setForm({ ...form, photo: "", empreinte: null })}
                  className="mt-2 py-1.5"
                >
                  Reprendre
                </Bouton>
              </div>
            </div>
          ) : (
            <>
              <Camera
                capturerPhoto
                libelleAction="Prendre la photo"
                onLecture={({ empreinte, photo }) =>
                  setForm((f) => ({ ...f, empreinte, photo: photo ?? "" }))
                }
                message="Cadrez le visage dans le cercle, dans un endroit bien éclairé."
              />
              <p className="mt-3 text-xs text-gray-500">
                Facultatif à la création : sans photo, la personne se connectera au code, et son
                arrivée sera marquée non vérifiée. Vous pourrez l'ajouter plus tard.
              </p>
            </>
          )}
        </div>
      )}

      {/* --- Droits par écran --- */}
      {form.role !== "admin" && (
        <div className="mt-5 pt-5 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h3 className="font-medium text-gray-900">Écrans autorisés</h3>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Par défaut, la personne accède à tout ce que son rôle permet. Décochez pour restreindre.
            On ne peut jamais accorder plus que le rôle : ces cases retirent, elles n'ajoutent pas.
          </p>

          <div className="grid gap-1.5 sm:grid-cols-2">
            {ecransDuRole(form.role).map((cle) => {
              const coche = form.permissions === null || form.permissions.includes(cle);
              return (
                <label
                  key={cle}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-200 text-sm cursor-pointer hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={coche}
                    onChange={(e) => basculerEcran(cle, e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600"
                  />
                  <span className="text-gray-800">{ECRAN_LABELS[cle]}</span>
                </label>
              );
            })}
          </div>

          {form.permissions !== null && (
            <button
              type="button"
              onClick={() => setForm({ ...form, permissions: null })}
              className="mt-3 text-sm text-indigo-600 hover:underline"
            >
              Rétablir tous les droits du rôle
            </button>
          )}
        </div>
      )}

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
            — le désactiver coupe l'accès sans effacer l'historique des ventes.
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

// ---------------------------------------------------------------------------

/** Attribution d'un nouveau code ou mot de passe, selon le mode du compte. */
function ModaleSecret({
  utilisateur, onFermer,
}: { utilisateur: Profile | null; onFermer: () => void }) {
  const [valeur, setValeur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [fait, setFait] = useState(false);
  const [copie, setCopie] = useState(false);

  useEffect(() => { setValeur(""); setErreur(null); setFait(false); setCopie(false); }, [utilisateur]);

  if (!utilisateur) return null;
  const parCode = utilisateur.modeConnexion === "pin";

  const soumettre = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      if (parCode) await definirCodePin(utilisateur.id, valeur);
      else await reinitialiserMotDePasse(utilisateur.id, valeur);
      setFait(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setEnvoi(false);
    }
  };

  const copier = () => {
    void navigator.clipboard.writeText(valeur).then(() => {
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    });
  };

  const valide = parCode ? /^\d{6}$/.test(valeur) : valeur.length >= 8;

  return (
    <Modale
      ouverte
      titre={`${parCode ? "Nouveau code" : "Nouveau mot de passe"} — ${utilisateur.fullName}`}
      onFermer={onFermer}
    >
      <Erreur message={erreur} />

      {fait ? (
        <div className="space-y-4">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-900">
            Enregistré. Communiquez-le à l'employé — il ne sera plus affiché après la fermeture de
            cette fenêtre.
          </div>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg font-mono text-lg tracking-widest">
            <span className="flex-1 break-all text-center">{valeur}</span>
            <button onClick={copier} className="p-1.5 rounded hover:bg-gray-200 shrink-0" title="Copier">
              {copie ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-500" />}
            </button>
          </div>
          <Bouton onClick={onFermer} className="w-full">Fermer</Bouton>
        </div>
      ) : (
        <div className="space-y-4">
          <Champ
            label={parCode ? "Code d'accès (6 chiffres)" : "Nouveau mot de passe"}
            aide={parCode ? "Exactement 6 chiffres." : "8 caractères minimum."}
          >
            <Saisie
              type="text"
              inputMode={parCode ? "numeric" : undefined}
              maxLength={parCode ? 6 : undefined}
              value={valeur}
              onChange={(e) =>
                setValeur(parCode ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value)
              }
              className={parCode ? "tabulaire tracking-[0.4em] text-center text-lg" : undefined}
              autoFocus
            />
          </Champ>
          <Bouton
            onClick={soumettre} chargement={envoi} disabled={!valide}
            icone={KeyRound} className="w-full"
          >
            {parCode ? "Attribuer ce code" : "Réinitialiser le mot de passe"}
          </Bouton>
        </div>
      )}
    </Modale>
  );
}
