-- ============================================================================
-- EDEN — Migration : connexion du personnel par nom + code PIN
-- ----------------------------------------------------------------------------
-- À exécuter UNE FOIS sur la base déjà migrée (après 03-etablissements.sql).
--
-- Pourquoi :
-- taper une adresse e-mail au comptoir, plusieurs fois par jour, sur une
-- tablette, n'a aucun sens pour un caissier. Le personnel choisit désormais son
-- nom dans une liste et saisit un code à 6 chiffres. Le propriétaire et les
-- responsables gardent l'e-mail et le mot de passe : ils accèdent à la
-- comptabilité et à la gestion des comptes, cela justifie une authentification
-- plus forte.
--
-- Le code PIN reste un mot de passe Supabase Auth classique : le compte du
-- personnel reçoit une adresse technique, invisible dans l'interface, et le PIN
-- en fait office de mot de passe. Rien n'est stocké en clair, et la session
-- délivrée est la même que pour un administrateur — donc la traçabilité du
-- §5.10 reste entière : on sait toujours QUI a encaissé.
--
-- Entièrement transactionnel : en cas d'erreur, rien n'est appliqué.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Mode de connexion
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists mode_connexion text not null default 'email'
    check (mode_connexion in ('email', 'pin'));

comment on column profiles.mode_connexion is
  'email = identifiant + mot de passe (propriétaire, responsable) ; '
  'pin = nom choisi dans une liste + code à 6 chiffres (personnel de terrain).';

-- Les comptes existants restent en connexion par e-mail.
update profiles set mode_connexion = 'email' where mode_connexion is null;

-- ---------------------------------------------------------------------------
-- 2. Fonction libre
-- ---------------------------------------------------------------------------
-- Les quatre rôles définissent le NIVEAU D'ACCÈS, pas le métier. Une cuisinière
-- et un vendeur peuvent partager le même niveau tout en exerçant deux fonctions
-- différentes. `fonction` porte l'intitulé réel, affiché dans les listes ; le
-- rôle continue de commander les autorisations.

alter table profiles add column if not exists fonction text;

comment on column profiles.fonction is
  'Intitulé du poste tel qu''on le nomme dans l''entreprise (Cuisinière, '
  'Vendeur, Infographe…). Purement descriptif : les droits viennent du rôle.';

-- ---------------------------------------------------------------------------
-- 3. Index de recherche du personnel à la connexion
-- ---------------------------------------------------------------------------
-- L'écran de connexion liste les comptes actifs en mode PIN de l'établissement
-- choisi ; cet index évite un parcours complet de la table à chaque affichage.

create index if not exists profiles_connexion_pin_idx
  on profiles (establishment_id, full_name)
  where mode_connexion = 'pin' and actif;

commit;

-- ---------------------------------------------------------------------------
-- Contrôle : à exécuter après la migration.
-- ---------------------------------------------------------------------------
-- select full_name, role, mode_connexion, fonction,
--        (select nom from establishments e where e.id = p.establishment_id) as etablissement
--   from profiles p order by full_name;
