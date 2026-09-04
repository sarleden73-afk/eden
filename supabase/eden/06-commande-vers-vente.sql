-- ============================================================================
-- 06 — La commande terminée devient une vente
-- ----------------------------------------------------------------------------
-- À exécuter UNE FOIS, après 05-pointage-et-droits.sql.
--
-- Jusqu'ici, une commande passée à « terminée » ne produisait rien : son
-- montant n'entrait ni dans le chiffre d'affaires, ni dans la caisse, ni dans
-- la comptabilité. Il fallait ressaisir la vente à la main, et personne ne le
-- faisait — le travail était livré, l'argent encaissé, et les chiffres
-- l'ignoraient.
--
-- Deux colonnes suffisent à combler ça :
--   * `payment_method` — une commande se règle comme une vente, il faut savoir
--     comment, sinon la vente générée devrait deviner.
--   * `sale_id`        — la vente issue de la commande. Sa présence est ce qui
--     empêche d'encaisser deux fois la même commande : le serveur ne génère
--     la vente que si cette colonne est vide.
--
-- Entièrement transactionnel : en cas d'erreur, rien n'est appliqué.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Moyen de règlement de la commande
-- ---------------------------------------------------------------------------
-- Même énumération que les ventes et les dépenses : un moyen de paiement doit
-- vouloir dire la même chose partout, sinon les totaux par moyen ne veulent
-- plus rien dire.

alter table orders
  add column if not exists payment_method payment_method not null default 'especes';

comment on column orders.payment_method is
  'Moyen de règlement, repris tel quel par la vente générée à la clôture.';

-- ---------------------------------------------------------------------------
-- 2. Lien vers la vente générée
-- ---------------------------------------------------------------------------
-- `on delete set null` plutôt que `restrict` : si une vente disparaissait, la
-- commande doit rester lisible. En pratique une vente ne se supprime jamais —
-- elle s'annule — mais la contrainte ne doit pas reposer sur cette promesse.

alter table orders
  add column if not exists sale_id bigint references sales(id) on delete set null;

comment on column orders.sale_id is
  'Vente produite à la clôture de la commande. Non nul = déjà encaissée : '
  'c''est ce qui empêche un second encaissement.';

-- Une vente ne peut être issue que d'une seule commande. Sans cet index, une
-- erreur de code pourrait rattacher deux commandes à la même vente et gonfler
-- le chiffre d'affaires d'un montant qui n'existe pas.
create unique index if not exists orders_une_vente_par_commande
  on orders (sale_id) where sale_id is not null;

commit;

-- ---------------------------------------------------------------------------
-- Contrôle : à exécuter après la migration.
-- ---------------------------------------------------------------------------
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_name = 'orders' and column_name in ('payment_method', 'sale_id');
