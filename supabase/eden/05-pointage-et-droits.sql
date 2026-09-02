-- ============================================================================
-- EDEN — Migration : pointage par reconnaissance faciale, droits par écran,
--                    et remise à zéro des données de test
-- ----------------------------------------------------------------------------
-- À exécuter UNE FOIS, après 04-connexion-pin.sql.
--
-- ATTENTION : cette migration EFFACE les écritures (ventes, dépenses, achats,
-- caisse, commandes, mouvements de stock, journal) et tous les comptes sauf le
-- propriétaire. C'est ce qui a été demandé pour repartir propre après la
-- période d'essai. Le catalogue, les établissements et les paramètres sont
-- conservés.
--
-- Entièrement transactionnel : en cas d'erreur, rien n'est appliqué.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Identification par le visage
-- ---------------------------------------------------------------------------
-- L'empreinte est un vecteur de 128 nombres calculé à partir du visage. C'est
-- elle qui sert à reconnaître : la photo n'est conservée que pour l'affichage
-- sur la fiche de l'employé, et n'est jamais exposée par une route publique.

alter table profiles add column if not exists visage_empreinte jsonb;
alter table profiles add column if not exists photo_url text;

comment on column profiles.visage_empreinte is
  'Vecteur de 128 nombres décrivant le visage. Sert uniquement à la comparaison '
  'au pointage ; ne permet pas de reconstituer une image.';
comment on column profiles.photo_url is
  'Photo d''inscription, réduite. Donnée biométrique identifiable : réservée à '
  'l''administrateur, jamais renvoyée par les routes de connexion.';

-- ---------------------------------------------------------------------------
-- 2. Droits par écran
-- ---------------------------------------------------------------------------
-- Le rôle donne une base ; cette liste l'affine personne par personne.
-- null = la personne garde exactement les droits de son rôle. Une liste
-- explicite remplace cette base, ce qui permet d'ouvrir ou de fermer un écran
-- à quelqu'un sans inventer un rôle pour lui.

alter table profiles add column if not exists permissions jsonb;

comment on column profiles.permissions is
  'Liste des écrans autorisés, ex. ["vente","caisse","stocks"]. null = droits '
  'du rôle. Vérifiée côté serveur à chaque appel, pas seulement à l''affichage.';

-- ---------------------------------------------------------------------------
-- 3. Pointage
-- ---------------------------------------------------------------------------
-- Une ligne par employé et par jour : la première identification de la journée
-- vaut arrivée. Les connexions suivantes se font au code et ne créent rien.

create table if not exists pointages (
  id               bigserial primary key,
  profile_id       uuid not null references profiles(id) on delete cascade,
  establishment_id bigint not null references establishments(id) on delete restrict,
  -- Jour local (Brazzaville), pas la date UTC : un pointage à 00h30 appartient
  -- à la journée qui commence, pas à celle qui s'achève.
  jour             date not null,
  arrive_a         timestamptz not null default now(),
  methode          text not null default 'visage' check (methode in ('visage', 'code')),
  -- false quand la reconnaissance a échoué et que la personne est entrée par
  -- son code : elle travaille, mais le bilan doit pouvoir le signaler.
  verifie          boolean not null default true,
  note             text,
  created_at       timestamptz not null default now()
);

-- Un seul pointage par personne et par jour : la deuxième connexion de la
-- journée ne doit pas créer une seconde arrivée.
create unique index if not exists pointages_un_par_jour
  on pointages (profile_id, jour);

create index if not exists pointages_jour_idx
  on pointages (establishment_id, jour desc);

alter table pointages enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Remise à zéro des écritures
-- ---------------------------------------------------------------------------
-- Ordre imposé par les clés étrangères : les lignes filles d'abord, les
-- comptes en dernier.

delete from cash_movements;
delete from stock_movements;
delete from sale_items;
delete from purchase_items;
delete from sales;
delete from purchases;
delete from expenses;
delete from orders;
delete from cash_sessions;
delete from pointages;
delete from audit_log;

-- Les compteurs de stock repartent à zéro : leurs mouvements viennent d'être
-- effacés, les laisser garnis rendrait le stock inexplicable.
update products set quantite = 0;

-- ---------------------------------------------------------------------------
-- 5. Suppression des comptes de test
-- ---------------------------------------------------------------------------
-- `profiles` est supprimé en cascade avec le compte d'authentification, il
-- suffit donc de retirer ce dernier. Le propriétaire est préservé.

delete from auth.users
 where id in (select id from profiles where role <> 'admin');

commit;

-- ---------------------------------------------------------------------------
-- Contrôle : à exécuter après la migration.
-- ---------------------------------------------------------------------------
-- select
--   (select count(*) from profiles)     as comptes,
--   (select count(*) from sales)        as ventes,
--   (select count(*) from expenses)     as depenses,
--   (select count(*) from pointages)    as pointages,
--   (select count(*) from products)     as articles,
--   (select count(*) from establishments) as etablissements;
