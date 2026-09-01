-- Fidely — Migration 003 : variantes de prestations
-- À exécuter dans Supabase : SQL Editor > New query > Run

create table if not exists service_variants (
  id serial primary key,
  service_id integer not null references services(id),
  name text not null,
  price integer not null,   -- en cents (comme services.price)
  duration integer,         -- en minutes (optionnel ; hérite de la prestation si vide)
  created_at timestamp default now()
);

alter table service_variants enable row level security;
