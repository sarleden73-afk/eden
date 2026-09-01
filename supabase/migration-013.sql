-- Fidely — Migration 013 : correction du fuseau horaire (pointage, ventes, historique...)
-- SQL Editor > New query > Run
--
-- BUG : toutes les colonnes `timestamp` (sans fuseau) stockent en réalité l'heure UTC
-- (produite par new Date() / Postgres now()), mais le navigateur les relit comme si
-- c'était déjà l'heure locale (WAT, UTC+1, Congo-Brazzaville) — résultat : tout
-- s'affiche avec 1h de retard sur l'heure réelle (pointage, ventes, avis clients...).
--
-- On convertit ces colonnes en `timestamptz`, en réinterprétant explicitement les
-- valeurs déjà stockées comme étant de l'UTC (ce qu'elles sont vraiment) — aucune
-- donnée n'est perdue ni décalée, seule l'étiquette de fuseau est corrigée. Une fois
-- converties, Postgres renverra l'heure avec son fuseau, et le navigateur l'affichera
-- alors correctement dans le fuseau de qui regarde l'écran.
--
-- EXCEPTION volontaire : appointments.start_time / end_time restent des `timestamp`
-- SANS fuseau. Elles suivent une convention différente et déjà cohérente (les chiffres
-- stockés SONT l'heure murale locale telle que saisie, sans conversion — voir le
-- commentaire en tête de src/publicApi.ts) : les convertir ici décalerait les
-- rendez-vous d'1h, alors qu'ils s'affichent déjà correctement aujourd'hui.

alter table users              alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table businesses         alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table programs           alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table customers          alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table visits             alter column date         type timestamptz using date         at time zone 'UTC';
alter table employees          alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table services           alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table appointments       alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table time_logs          alter column clock_in_time  type timestamptz using clock_in_time  at time zone 'UTC';
alter table time_logs          alter column clock_out_time type timestamptz using clock_out_time at time zone 'UTC';
alter table categories         alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table transactions       alter column date         type timestamptz using date         at time zone 'UTC';
alter table transactions       alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table members            alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table service_variants   alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table loyalty_settings   alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table rewards            alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table tiers              alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table customer_rewards   alter column redeemed_at  type timestamptz using redeemed_at  at time zone 'UTC';
-- whatsapp_notifications : pas encore créée en production (fonctionnalité jamais
-- activée) — rien à convertir ici pour l'instant, sa migration-006.sql la créera
-- déjà en timestamptz le jour où elle sera exécutée.
alter table products           alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table service_products   alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table reviews            alter column created_at   type timestamptz using created_at   at time zone 'UTC';
alter table stock_movements    alter column created_at   type timestamptz using created_at   at time zone 'UTC';
