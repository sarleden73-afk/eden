-- ============================================================================
-- EDEN — Migration : des « pôles » figés vers de vrais établissements
-- ----------------------------------------------------------------------------
-- À exécuter UNE FOIS sur une base déjà installée avec 01-schema.sql et
-- 02-seed.sql. Les données existantes (articles, prix, ventes, stocks) sont
-- conservées et rattachées à leur établissement.
--
-- Pourquoi cette migration :
-- le type `pole` était un enum à deux valeurs codées en dur. Il permettait de
-- ranger les écritures dans deux colonnes, mais pas de traiter la papeterie et
-- le restaurant comme deux entités séparées, ni d'en ajouter une troisième
-- sans toucher au schéma. Les établissements deviennent donc des lignes d'une
-- table, créées et modifiables depuis l'application.
--
-- Entièrement transactionnel : en cas d'erreur, rien n'est appliqué.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table des établissements
-- ---------------------------------------------------------------------------

create table if not exists establishments (
  id         bigserial primary key,
  nom        text not null unique,
  -- Identifiant stable et lisible, utilisé par la migration et les URL.
  slug       text not null unique,
  activite   text,
  adresse    text,
  telephone  text,
  email      text,
  -- Couleur d'accent : permet de distinguer d'un coup d'œil sur quel
  -- établissement on travaille, ce qui évite de saisir une vente au mauvais
  -- endroit après une bascule.
  couleur    text not null default '#1fa066',
  ordre      int not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into establishments (nom, slug, activite, couleur, ordre) values
  ('EDEN MULTI-SERVICES', 'multi-services',
   'Papeterie, cyber, infographie, fournitures scolaires', '#1fa066', 1),
  ('EDEN FOOD', 'food',
   'Restauration rapide et boissons', '#d4a017', 2)
on conflict (slug) do nothing;

create trigger establishments_updated_at before update on establishments
  for each row execute function set_updated_at();

alter table establishments enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Rattachement des tables existantes
-- ---------------------------------------------------------------------------
-- Chaque table qui portait `pole` reçoit `establishment_id`, rempli à partir
-- de l'ancienne valeur. La correspondance est faite par le slug.

create or replace function _id_etablissement(p text) returns bigint
language sql stable as $fn$
  select id from establishments
   where slug = case p when 'MULTI_SERVICES' then 'multi-services' else 'food' end;
$fn$;

-- --- categories ---
alter table categories add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update categories set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table categories alter column establishment_id set not null;
alter table categories drop constraint if exists categories_nom_pole_key;
alter table categories drop column if exists pole;
create unique index if not exists categories_nom_etab_uniq
  on categories (nom, establishment_id);

-- --- products ---
alter table products add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update products set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table products alter column establishment_id set not null;
drop index if exists products_pole_idx;
drop index if exists products_nom_pole_uniq;
alter table products drop column if exists pole;
create index if not exists products_etab_idx on products (establishment_id) where actif;
create unique index if not exists products_nom_etab_uniq
  on products (nom, establishment_id);

-- --- packs ---
alter table packs add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update packs set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table packs alter column establishment_id set not null;
alter table packs drop column if exists pole;
create index if not exists packs_etab_idx on packs (establishment_id);

-- --- cash_sessions ---
alter table cash_sessions add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update cash_sessions set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table cash_sessions alter column establishment_id set not null;
drop index if exists cash_sessions_une_ouverte_par_pole;
alter table cash_sessions drop column if exists pole;
-- Une seule caisse ouverte à la fois PAR ÉTABLISSEMENT : c'est ce qui rend le
-- rapprochement de fin de journée interprétable.
create unique index if not exists cash_sessions_une_ouverte_par_etab
  on cash_sessions (establishment_id) where statut = 'ouverte';

-- --- sales ---
alter table sales add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update sales set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table sales alter column establishment_id set not null;
drop index if exists sales_pole_idx;
alter table sales drop column if exists pole;
create index if not exists sales_etab_idx on sales (establishment_id, created_at desc);

-- --- purchases ---
alter table purchases add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update purchases set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table purchases alter column establishment_id set not null;
alter table purchases drop column if exists pole;
create index if not exists purchases_etab_idx on purchases (establishment_id, date_achat desc);

-- --- expenses ---
alter table expenses add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update expenses set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null;
alter table expenses alter column establishment_id set not null;
drop index if exists expenses_pole_idx;
alter table expenses drop column if exists pole;
create index if not exists expenses_etab_idx on expenses (establishment_id, date_depense desc);

-- --- orders (§5.8) ---
-- Les commandes infographie relèvent de la papeterie ; la colonne est ajoutée
-- pour que chaque établissement puisse avoir les siennes.
alter table orders add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update orders set establishment_id = (select id from establishments where slug = 'multi-services')
 where establishment_id is null;
alter table orders alter column establishment_id set not null;
create index if not exists orders_etab_idx on orders (establishment_id, statut);

-- --- profiles ---
-- null = accès à tous les établissements (propriétaire, responsable
-- transversal). Les caissiers et techniciens sont rattachés à un établissement
-- et n'en sortent pas : la règle est appliquée par l'API.
alter table profiles add column if not exists establishment_id bigint
  references establishments(id) on delete restrict;
update profiles set establishment_id = _id_etablissement(pole::text)
 where establishment_id is null and pole is not null;
alter table profiles drop column if exists pole;

-- ---------------------------------------------------------------------------
-- 3. Nettoyage
-- ---------------------------------------------------------------------------

drop function if exists _id_etablissement(text);

-- Le type n'est plus référencé par aucune colonne.
drop type if exists pole;

commit;

-- ---------------------------------------------------------------------------
-- Contrôle : à exécuter après la migration pour vérifier le résultat.
-- ---------------------------------------------------------------------------
-- select e.nom,
--        (select count(*) from products p where p.establishment_id = e.id) as articles,
--        (select count(*) from categories c where c.establishment_id = e.id) as categories,
--        (select count(*) from packs k where k.establishment_id = e.id) as packs
--   from establishments e order by e.ordre;
