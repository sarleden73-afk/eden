-- Fidely — Migration 004 : variantes + fidélité à points + ID court + détails de visite
-- Regroupe tout ce qui est en attente. À exécuter dans Supabase : SQL Editor > New query > Run
-- (idempotent : sans danger même si une partie a déjà été exécutée)

-- Variantes de prestations
create table if not exists service_variants (
  id serial primary key,
  service_id integer not null references services(id),
  name text not null,
  price integer not null,   -- cents
  duration integer,
  created_at timestamp default now()
);
alter table service_variants enable row level security;

-- Points de fidélité + numéro de carte court côté client
alter table customers add column if not exists points integer not null default 0;
alter table customers add column if not exists card_number text;

-- Détails enregistrés à chaque visite (anti-fraude / historique)
alter table visits add column if not exists service_id integer references services(id);
alter table visits add column if not exists service_name text;
alter table visits add column if not exists amount integer;   -- FCFA
alter table visits add column if not exists points integer not null default 0;
