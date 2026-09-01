-- ============================================================================
-- EDEN — Installation complète (base neuve)
-- ----------------------------------------------------------------------------
-- Concaténation de 01-schema.sql, 02-seed.sql et 03-etablissements.sql.
-- À coller en une seule fois dans Supabase > SQL Editor > New query, puis Run.
--
-- Pour une base DÉJÀ installée avec l'ancienne version (pôles figés), ne pas
-- utiliser ce fichier : exécuter uniquement 03-etablissements.sql, qui migre
-- les données existantes sans rien perdre.
-- ============================================================================

-- ============================================================================
-- EDEN MULTI-SERVICES — Schéma de la plateforme de gestion et contrôle interne
-- ----------------------------------------------------------------------------
-- À exécuter une seule fois dans Supabase : SQL Editor > New query.
-- Puis exécuter 02-seed.sql (catalogue produits/services du cahier des charges).
--
-- Conventions :
--   * Les montants sont en FCFA, stockés en `bigint` (le franc CFA n'a pas de
--     sous-unité : aucune décimale à gérer, et pas d'erreur d'arrondi flottant).
--   * Les quantités sont en `numeric(12,3)` (certains articles se vendent à la
--     rame ou au lot).
--   * RLS est activé sans policy sur chaque table : aucun accès n'est possible
--     avec la clé publishable. Tout passe par l'API Express, qui utilise la clé
--     secrète et applique les autorisations par rôle (cf. src/api.ts).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types énumérés
-- ---------------------------------------------------------------------------

-- Cahier des charges §5.1
create type user_role as enum ('admin', 'responsable', 'caissier', 'technicien');

-- §1 : les deux pôles de l'entreprise. Toute écriture (vente, dépense, stock,
-- achat) est rattachée à un pôle pour permettre des résultats séparés ET une
-- vision globale.
create type pole as enum ('MULTI_SERVICES', 'FOOD');

-- §5.4 — la liste réelle des moyens utilisés reste à confirmer par le client ;
-- les cinq valeurs du cahier des charges sont toutes prévues.
create type payment_method as enum ('especes', 'mobile_money', 'carte', 'virement', 'autre');

create type sale_status as enum ('validee', 'annulee');

-- §5.8 : En attente / En cours / Terminé, complété par livré et annulé.
create type order_status as enum ('en_attente', 'en_cours', 'termine', 'livre', 'annule');

create type cash_session_status as enum ('ouverte', 'fermee');

-- §5.5 : entrée (achat/réappro), sortie (vente/perte), ajustement (inventaire).
create type stock_movement_type as enum ('entree', 'sortie', 'ajustement');

-- §5.3 : tous les mouvements qui traversent la caisse pendant la journée.
create type cash_movement_type as enum (
  'vente', 'entree', 'depense', 'remboursement', 'retrait', 'depot', 'autre'
);

-- §5.7 : les 12 postes de dépense listés au cahier des charges.
create type expense_category as enum (
  'electricite', 'internet', 'loyer', 'salaires', 'transport', 'carburant',
  'achat_marchandises', 'matieres_premieres', 'entretien', 'reparation',
  'fournitures_bureau', 'autre'
);

-- Un « produit » décrémente le stock, une « prestation » non (photocopie,
-- création de logo...). Distinction nécessaire pour §5.5.
create type item_kind as enum ('produit', 'prestation');

-- ---------------------------------------------------------------------------
-- 2. Utilisateurs et rôles (§5.1)
-- ---------------------------------------------------------------------------

-- Chaque employé a un compte Supabase Auth (email + mot de passe). `profiles`
-- porte le rôle, les autorisations et les infos RH (§6 « Personnel »).
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  email        text not null,
  role         user_role not null default 'caissier',
  -- null = l'utilisateur intervient sur les deux pôles (cas de la responsable,
  -- qui dirige EDEN MULTI-SERVICES et EDEN FOOD).
  pole         pole,
  poste        text,
  telephone    text,
  salaire      bigint,
  date_entree  date,
  actif        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Référentiel : fournisseurs, catégories, produits, packs (§2, §3, §5.5)
-- ---------------------------------------------------------------------------

create table suppliers (
  id         bigserial primary key,
  nom        text not null,
  contact    text,
  telephone  text,
  email      text,
  adresse    text,
  notes      text,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

create table categories (
  id     bigserial primary key,
  nom    text not null,
  pole   pole not null,
  kind   item_kind not null default 'produit',
  ordre  int not null default 0,
  actif  boolean not null default true,
  unique (nom, pole)
);

create table products (
  id            bigserial primary key,
  nom           text not null,
  description   text,
  category_id   bigint references categories(id) on delete set null,
  pole          pole not null,
  kind          item_kind not null default 'produit',
  -- §5.13 : le prix d'achat est indispensable au calcul de la marge brute.
  prix_vente    bigint not null check (prix_vente >= 0),
  prix_achat    bigint not null default 0 check (prix_achat >= 0),
  unite         text not null default 'unité',
  -- Les prestations (photocopie, scan, création de logo) ne tiennent pas de
  -- stock : gere_stock = false neutralise quantite / seuil_alerte.
  gere_stock    boolean not null default true,
  quantite      numeric(12,3) not null default 0,
  seuil_alerte  numeric(12,3) not null default 0,
  supplier_id   bigint references suppliers(id) on delete set null,
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index products_pole_idx     on products (pole) where actif;
create index products_category_idx on products (category_id);

-- §2.4 : « créer un pack composé de plusieurs articles, avec possibilité de
-- modifier sa composition et son prix ». Le prix du pack est libre et
-- indépendant de la somme de ses composants (remise commerciale).
create table packs (
  id          bigserial primary key,
  nom         text not null,
  description text,
  pole        pole not null default 'MULTI_SERVICES',
  prix_vente  bigint not null check (prix_vente >= 0),
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table pack_items (
  id         bigserial primary key,
  pack_id    bigint not null references packs(id) on delete cascade,
  product_id bigint not null references products(id) on delete restrict,
  quantite   numeric(12,3) not null default 1 check (quantite > 0),
  unique (pack_id, product_id)
);

-- ---------------------------------------------------------------------------
-- 4. Clients (§5.9)
-- ---------------------------------------------------------------------------

create table customers (
  id         bigserial primary key,
  nom        text not null,
  telephone  text,
  adresse    text,
  notes      text,
  created_at timestamptz not null default now()
);

create index customers_telephone_idx on customers (telephone);

-- ---------------------------------------------------------------------------
-- 5. Caisse (§5.3)
-- ---------------------------------------------------------------------------

-- Une session = une journée de caisse pour un pôle : ouverture avec fonds
-- initial, mouvements, puis fermeture avec comptage physique et écart.
create table cash_sessions (
  id              bigserial primary key,
  pole            pole not null,
  statut          cash_session_status not null default 'ouverte',
  fonds_initial   bigint not null default 0 check (fonds_initial >= 0),
  opened_by       uuid not null references profiles(id) on delete restrict,
  opened_at       timestamptz not null default now(),
  closed_by       uuid references profiles(id) on delete restrict,
  closed_at       timestamptz,
  -- Renseignés à la fermeture. solde_theorique = fonds_initial + recettes
  -- espèces − dépenses − sorties ; ecart = solde_physique − solde_theorique.
  solde_theorique bigint,
  solde_physique  bigint,
  ecart           bigint,
  notes           text
);

-- Une seule caisse ouverte à la fois par pôle : garde-fou contre la double
-- ouverture, qui rendrait le rapprochement de caisse ininterprétable.
create unique index cash_sessions_une_ouverte_par_pole
  on cash_sessions (pole) where statut = 'ouverte';

-- ---------------------------------------------------------------------------
-- 6. Ventes (§5.2)
-- ---------------------------------------------------------------------------

create table sales (
  id                 bigserial primary key,
  -- §5.2 « Numéro de reçu ». Format EMS-AAAAMMJJ-0001, généré côté API.
  numero_recu        text not null unique,
  pole               pole not null,
  session_id         bigint references cash_sessions(id) on delete restrict,
  customer_id        bigint references customers(id) on delete set null,
  vendeur_id         uuid not null references profiles(id) on delete restrict,
  payment_method     payment_method not null default 'especes',
  numero_transaction text,
  sous_total         bigint not null default 0,
  remise             bigint not null default 0 check (remise >= 0),
  total              bigint not null default 0,
  -- §5.13 : coût des marchandises vendues, figé au moment de la vente pour que
  -- la marge historique ne bouge pas si le prix d'achat change plus tard.
  cout_total         bigint not null default 0,
  statut             sale_status not null default 'validee',
  -- §5.10 : une annulation exige un motif, conservé avec son auteur et l'heure.
  motif_annulation   text,
  annule_par         uuid references profiles(id) on delete set null,
  annule_le          timestamptz,
  created_at         timestamptz not null default now()
);

create index sales_created_at_idx on sales (created_at desc);
create index sales_pole_idx       on sales (pole, created_at desc);
create index sales_vendeur_idx    on sales (vendeur_id, created_at desc);
create index sales_session_idx    on sales (session_id);

create table sale_items (
  id                  bigserial primary key,
  sale_id             bigint not null references sales(id) on delete cascade,
  product_id          bigint references products(id) on delete set null,
  pack_id             bigint references packs(id) on delete set null,
  -- Libellé recopié : la ligne de vente doit rester lisible même si le produit
  -- est renommé ou retiré du catalogue plus tard.
  libelle             text not null,
  quantite            numeric(12,3) not null check (quantite > 0),
  prix_unitaire       bigint not null check (prix_unitaire >= 0),
  prix_achat_unitaire bigint not null default 0,
  montant             bigint not null
);

create index sale_items_sale_idx    on sale_items (sale_id);
create index sale_items_product_idx on sale_items (product_id);

-- ---------------------------------------------------------------------------
-- 7. Mouvements de stock (§5.5)
-- ---------------------------------------------------------------------------

-- Journal de tous les mouvements. `ref_type`/`ref_id` relient le mouvement à
-- son origine (vente, achat, inventaire) sans multiplier les clés étrangères.
create table stock_movements (
  id             bigserial primary key,
  product_id     bigint not null references products(id) on delete cascade,
  type           stock_movement_type not null,
  quantite       numeric(12,3) not null,
  quantite_avant numeric(12,3) not null,
  quantite_apres numeric(12,3) not null,
  motif          text,
  ref_type       text,
  ref_id         bigint,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index stock_movements_product_idx on stock_movements (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Achats et fournisseurs (§5.6)
-- ---------------------------------------------------------------------------

create table purchases (
  id              bigserial primary key,
  numero          text not null unique,
  supplier_id     bigint references suppliers(id) on delete set null,
  pole            pole not null,
  date_achat      date not null default current_date,
  montant_total   bigint not null default 0 check (montant_total >= 0),
  montant_paye    bigint not null default 0 check (montant_paye >= 0),
  -- §5.6 « Montant restant à payer » : calculé, jamais saisi — impossible de
  -- le désynchroniser du total et du payé.
  montant_restant bigint generated always as (montant_total - montant_paye) stored,
  payment_method  payment_method not null default 'especes',
  effectue_par    uuid references profiles(id) on delete set null,
  justificatif    text,
  notes           text,
  created_at      timestamptz not null default now()
);

create index purchases_date_idx     on purchases (date_achat desc);
create index purchases_supplier_idx on purchases (supplier_id);

create table purchase_items (
  id            bigserial primary key,
  purchase_id   bigint not null references purchases(id) on delete cascade,
  product_id    bigint references products(id) on delete set null,
  libelle       text not null,
  quantite      numeric(12,3) not null check (quantite > 0),
  prix_unitaire bigint not null check (prix_unitaire >= 0),
  montant       bigint not null
);

create index purchase_items_purchase_idx on purchase_items (purchase_id);

-- ---------------------------------------------------------------------------
-- 9. Dépenses (§5.7)
-- ---------------------------------------------------------------------------

create table expenses (
  id             bigserial primary key,
  pole           pole not null,
  categorie      expense_category not null,
  montant        bigint not null check (montant > 0),
  motif          text not null,
  date_depense   date not null default current_date,
  payment_method payment_method not null default 'especes',
  effectue_par   uuid references profiles(id) on delete set null,
  -- §5.7 « personne ayant validé » : une dépense non validée reste visible mais
  -- n'entre pas dans le résultat consolidé tant qu'un responsable ne l'a pas
  -- approuvée.
  valide_par     uuid references profiles(id) on delete set null,
  valide_le      timestamptz,
  justificatif   text,
  session_id     bigint references cash_sessions(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index expenses_date_idx on expenses (date_depense desc);
create index expenses_pole_idx on expenses (pole, date_depense desc);

-- ---------------------------------------------------------------------------
-- 10. Mouvements de caisse (§5.3)
-- ---------------------------------------------------------------------------

create table cash_movements (
  id             bigserial primary key,
  session_id     bigint not null references cash_sessions(id) on delete cascade,
  type           cash_movement_type not null,
  -- Signé : positif = entrée d'argent, négatif = sortie. Le solde théorique est
  -- alors une simple somme, sans logique conditionnelle par type.
  montant        bigint not null,
  motif          text,
  payment_method payment_method not null default 'especes',
  sale_id        bigint references sales(id) on delete set null,
  expense_id     bigint references expenses(id) on delete set null,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index cash_movements_session_idx on cash_movements (session_id, created_at);

-- ---------------------------------------------------------------------------
-- 11. Commandes infographie (§5.8)
-- ---------------------------------------------------------------------------

create table orders (
  id                    bigserial primary key,
  numero                text not null unique,
  customer_id           bigint references customers(id) on delete set null,
  customer_nom          text not null,
  customer_telephone    text,
  type_prestation       text not null,
  description           text,
  quantite              numeric(12,3) not null default 1 check (quantite > 0),
  prix_unitaire         bigint not null default 0 check (prix_unitaire >= 0),
  montant_total         bigint not null default 0,
  acompte               bigint not null default 0 check (acompte >= 0),
  -- §5.8 « Montant restant » : calculé, comme pour les achats.
  reste                 bigint generated always as (montant_total - acompte) stored,
  date_commande         date not null default current_date,
  date_livraison_prevue date,
  statut                order_status not null default 'en_attente',
  technicien_id         uuid references profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index orders_statut_idx on orders (statut, date_livraison_prevue);

-- ---------------------------------------------------------------------------
-- 12. Traçabilité (§5.10, §5.14)
-- ---------------------------------------------------------------------------

-- Journal des opérations sensibles : annulations, modifications de prix,
-- ouvertures/fermetures de caisse, ajustements de stock, changements de rôle.
-- `avant`/`apres` conservent l'état complet pour pouvoir reconstituer ce qui a
-- réellement changé.
create table audit_log (
  id         bigserial primary key,
  user_id    uuid references profiles(id) on delete set null,
  user_nom   text,
  action     text not null,
  entite     text not null,
  entite_id  text,
  motif      text,
  avant      jsonb,
  apres      jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on audit_log (created_at desc);
create index audit_log_entite_idx     on audit_log (entite, entite_id);

-- ---------------------------------------------------------------------------
-- 13. Paramètres de l'entreprise (§6)
-- ---------------------------------------------------------------------------

-- Clé/valeur : les informations « restant à fournir » (adresse, téléphone,
-- e-mail, NIU, logo) sont saisies dans l'app sans migration supplémentaire.
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 14. Déclencheur updated_at
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();
create trigger packs_updated_at    before update on packs
  for each row execute function set_updated_at();
create trigger orders_updated_at   before update on orders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 15. Décrément de stock atomique
-- ---------------------------------------------------------------------------
-- Appelée par l'API à chaque ligne de vente. Faite en SQL et non en JS parce
-- que « lire la quantité, calculer, réécrire » depuis Node laisse une fenêtre
-- où deux caisses qui vendent le même article en même temps écrasent le
-- décrément l'une de l'autre. Ici l'UPDATE lit et écrit en une seule opération,
-- donc Postgres sérialise les deux ventes.
create or replace function apply_stock_movement(
  p_product_id bigint,
  p_delta      numeric,
  p_type       stock_movement_type,
  p_motif      text,
  p_ref_type   text,
  p_ref_id     bigint,
  p_user       uuid
) returns numeric
language plpgsql as $fn$
declare
  v_avant  numeric(12,3);
  v_apres  numeric(12,3);
  v_gere   boolean;
begin
  select gere_stock, quantite into v_gere, v_avant
    from products where id = p_product_id for update;

  if not found or not v_gere then
    return null;  -- prestation : rien à décrémenter
  end if;

  update products
     set quantite = quantite + p_delta
   where id = p_product_id
   returning quantite into v_apres;

  insert into stock_movements
    (product_id, type, quantite, quantite_avant, quantite_apres, motif, ref_type, ref_id, created_by)
  values
    (p_product_id, p_type, p_delta, v_avant, v_apres, p_motif, p_ref_type, p_ref_id, p_user);

  return v_apres;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 16. Row Level Security
-- ---------------------------------------------------------------------------
-- Activé partout, sans aucune policy : la clé publishable exposée au navigateur
-- ne peut donc rien lire ni écrire. Seule l'API Express, qui détient la clé
-- secrète, accède aux données — et c'est elle qui applique les rôles du §5.1.

alter table profiles        enable row level security;
alter table suppliers       enable row level security;
alter table categories      enable row level security;
alter table products        enable row level security;
alter table packs           enable row level security;
alter table pack_items      enable row level security;
alter table customers       enable row level security;
alter table cash_sessions   enable row level security;
alter table cash_movements  enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table stock_movements enable row level security;
alter table purchases       enable row level security;
alter table purchase_items  enable row level security;
alter table expenses        enable row level security;
alter table orders          enable row level security;
alter table audit_log       enable row level security;
alter table settings        enable row level security;


-- ============================================================================
-- EDEN MULTI-SERVICES — Catalogue initial (cahier des charges §2 et §3)
-- ----------------------------------------------------------------------------
-- À exécuter après 01-schema.sql. Idempotent : relançable sans créer de
-- doublons (on conflict do nothing sur (nom, pole)).
--
-- Les prix de vente sont ceux du cahier des charges. Les prix d'achat sont à 0
-- et restent à renseigner (§6 « Produits ») : tant qu'ils valent 0, la marge
-- brute affichée en comptabilité est égale au chiffre d'affaires. Ils se
-- saisissent dans l'app (Catalogue > modifier un article), sans SQL.
-- ============================================================================

-- Contrainte d'unicité fonctionnelle utilisée par les `on conflict` ci-dessous.
create unique index if not exists products_nom_pole_uniq on products (nom, pole);

-- ---------------------------------------------------------------------------
-- Catégories
-- ---------------------------------------------------------------------------

insert into categories (nom, pole, kind, ordre) values
  ('Cyber / Services numériques',    'MULTI_SERVICES', 'prestation', 1),
  ('Infographie / Personnalisation', 'MULTI_SERVICES', 'prestation', 2),
  ('Fournitures scolaires',          'MULTI_SERVICES', 'produit',    3),
  ('Sacs',                           'MULTI_SERVICES', 'produit',    4),
  ('Gourdes',                        'MULTI_SERVICES', 'produit',    5),
  ('Sandwichs',                      'FOOD',           'produit',    1),
  ('Pains / Omelettes',              'FOOD',           'produit',    2),
  ('Crêpes et gaufres',              'FOOD',           'produit',    3),
  ('Boissons',                       'FOOD',           'produit',    4)
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.1 Cyber / Services numériques — prestations, pas de stock
-- ---------------------------------------------------------------------------

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'prestation'::item_kind, v.prix, false, 'unité'
from (values
  ('Photocopie noir et blanc',   50),
  ('Photocopie couleur',        100),
  ('Impression noir et blanc',  100),
  ('Impression couleur',        125),
  ('Scan',                      500),
  ('Reliure de documents',     1000),
  ('Plastification',           1500),
  ('Photo d''identité',        2000),
  ('Création de flyers',       3500),
  ('Création d''étiquettes',   3500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Cyber / Services numériques' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.2 Infographie / Personnalisation — prestations
-- ---------------------------------------------------------------------------
-- Les articles personnalisés (tasse, casquette, t-shirt) consomment un support
-- physique. Ils sont saisis ici en prestation ; basculer `gere_stock` à true
-- depuis l'app si le client veut suivre le stock de supports vierges.

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'prestation'::item_kind, v.prix, false, 'unité'
from (values
  ('Tasse personnalisée',          3000),
  ('Casquette personnalisée',      2000),
  ('T-shirt personnalisé',         2500),
  ('Création de CV',               1500),
  ('Création de logo',            10000),
  ('Carte d''anniversaire',        2000),
  ('Carte de mariage',             3000),
  ('Carte de visite',              1500),
  ('Création de livret de loyer',  3500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Infographie / Personnalisation' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.3 Fournitures scolaires — produits, stock suivi
-- ---------------------------------------------------------------------------
-- Seuil d'alerte initialisé à 5 pour tous les articles (§5.5 « seuil
-- d'alerte ») ; ajustable article par article depuis l'app.

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'produit'::item_kind, v.prix, true, 5, 'unité'
from (values
  ('Cahier simple 288 pages',                      450),
  ('Cahier simple 100 pages',                      300),
  ('Cahier simple CP 50 pages',                    250),
  ('Cahier cartonné 288 pages',                    650),
  ('Grand cahier 288 pages',                      1500),
  ('Stylo-ciseau bleu',                            200),
  ('Stylo simple rouge/bleu/noir',                 100),
  ('Correcteur',                                   300),
  ('Crayon simple',                                 50),
  ('Crayon dessin animé',                          100),
  ('Livre CP',                                    3500),
  ('Livre CE1',                                   4000),
  ('Livre CE2',                                   4000),
  ('Livre CM1',                                   4500),
  ('Livre CM2',                                   5000),
  ('Règle plastique',                              400),
  ('Règle cassable',                               500),
  ('Papier ramé',                                 4500),
  ('Agrafes',                                     1000),
  ('Agrafeuse',                                   1000),
  ('Agrafeuse enveloppes kaki',                    100),
  ('Taille-crayon simple',                         150),
  ('Taille-crayon avec couvercle',                 300),
  ('Ciseaux',                                      700),
  ('Boîte de craies blanches',                     600),
  ('Boîte de craies de couleur',                   700),
  ('Boîte mathématique',                          1500),
  ('Chemise cartonnée',                            100),
  ('Bâton de colle',                               700),
  ('Calculatrice',                                1500),
  ('Ardoise',                                      500),
  ('Colle',                                        500),
  ('Marqueur',                                     500),
  ('Crayons de couleur – petit modèle',           1500),
  ('Crayons de couleur – à préciser',             2000),
  ('Gomme enfant',                                 150),
  ('Gomme pour grand',                             200),
  ('Sous-chemise',                                 100),
  ('Gros feutre',                                 3000),
  ('Gouache',                                     3500),
  ('Crayola petit modèle',                        2500),
  ('Crayola grand modèle',                        3000),
  ('Pâte à modeler',                              3000),
  ('Feutre petit modèle',                         1500),
  ('Gros feutre petit modèle',                    2500),
  ('Alphabet – lot de lettres',                    500),
  ('Chiffres – lot des chiffres',                  500),
  ('Bâtonnets',                                    500),
  ('Stabilo',                                      500),
  ('Autocollants pour cahiers',                    500),
  ('Aquarelles',                                  3000),
  ('Papiers ministre',                             300),
  ('Couverture document plastique (avant)',        500),
  ('Couverture document cartonnée (arrière)',      500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Fournitures scolaires' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.5 Sacs
-- ---------------------------------------------------------------------------

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'produit'::item_kind, v.prix, true, 3, 'unité'
from (values
  ('Sac Mini',                                                                    12000),
  ('Sac Spiderman',                                                               12000),
  ('Sac Pat''Patrouille bleu',                                                    10000),
  ('Sac Pat''Patrouille rose',                                                    10000),
  ('Sac fille primaire',                                                           8500),
  ('Sac garçon primaire',                                                          8500),
  ('Sac fille collège/lycée — noir, rose, marron, gris',                           8500),
  ('Sac mixte — Adidas, New Balance, Calvin Klein, OGIO — noir, gris, marron, bleu nuit', 10000),
  ('Sac garçon collège/lycée — noir, gris, beige, vert, bleu, orange',            12000),
  ('Sac mixte — bleu, gris',                                                      13000)
) as v(nom, prix)
cross join (select id from categories where nom = 'Sacs' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.6 Gourdes
-- ---------------------------------------------------------------------------

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'produit'::item_kind, v.prix, true, 3, 'unité'
from (values
  ('Gourde enfant avec dessins animés', 2500),
  ('Gourde enfant simple',              2000),
  ('Gourde pour grand',                 2000)
) as v(nom, prix)
cross join (select id from categories where nom = 'Gourdes' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §3.1–3.3 EDEN FOOD — préparations
-- ---------------------------------------------------------------------------
-- gere_stock = false : ces articles sont préparés à la commande. Ce qui se
-- suit en stock, ce sont les matières premières (farine, œufs, poulet...),
-- saisies via Achats et Dépenses. Basculer un article en stock suivi depuis
-- l'app si le client veut compter des produits finis.

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, false, 'unité'
from (values
  ('Sandwich au poulet',  1000),
  ('Sandwich à la viande', 1500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Sandwichs' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, false, 'unité'
from (values
  ('Pain à l''omelette simple',      500),
  ('Pain à l''omelette + saucisson', 600),
  ('Pain à l''omelette + jambon',    700)
) as v(nom, prix)
cross join (select id from categories where nom = 'Pains / Omelettes' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, false, 'unité'
from (values
  ('Crêpe nature',       600),
  ('Crêpe au chocolat',  800),
  ('Gaufre nature',      500),
  ('Gaufre au chocolat', 600)
) as v(nom, prix)
cross join (select id from categories where nom = 'Crêpes et gaufres' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

-- §3.4 Boissons — bouteilles achetées puis revendues : stock réellement suivi.
insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, true, 12, 'bouteille'
from (values
  ('Eau — petite bouteille',  250),
  ('Eau — autre format',      500),
  ('Jus — petite bouteille',  350),
  ('Jus — autre format',     1000)
) as v(nom, prix)
cross join (select id from categories where nom = 'Boissons' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.4 Packs scolaires
-- ---------------------------------------------------------------------------
-- Créés vides : le cahier des charges donne le prix des quatre packs mais pas
-- leur composition. Elle se définit dans l'app (Catalogue > Packs > composer),
-- article par article, et le prix reste modifiable indépendamment.

insert into packs (nom, pole, prix_vente, description)
select v.nom, 'MULTI_SERVICES'::pole, v.prix, 'Composition à définir dans Catalogue > Packs'
from (values
  ('Pack maternelle', 35000),
  ('Pack primaire',   35000),
  ('Pack collège',    38000),
  ('Pack lycée',      40000)
) as v(nom, prix)
where not exists (select 1 from packs p where p.nom = v.nom);

-- ---------------------------------------------------------------------------
-- Paramètres de l'entreprise (§1 et §6)
-- ---------------------------------------------------------------------------
-- Les champs vides correspondent aux informations « restant à fournir » du
-- §6 : ils se renseignent dans l'app (Paramètres), sans SQL.

insert into settings (key, value) values
  ('entreprise', jsonb_build_object(
    'nom',       'EDEN MULTI-SERVICES',
    'adresse',   '',
    'telephone', '',
    'email',     '',
    'niu',       '',
    'logoUrl',   '',
    'devise',    'FCFA'
  ))
on conflict (key) do nothing;

insert into settings (key, value) values
  ('caisse', jsonb_build_object(
    -- §6 « Fonds de caisse initial » : proposé par défaut à l'ouverture, le
    -- caissier peut le corriger. À ajuster une fois le montant réel connu.
    'fondsInitialParDefaut', 0,
    -- §5.14 « Déconnexion automatique après inactivité ».
    'inactiviteMinutes',     30
  ))
on conflict (key) do nothing;


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
