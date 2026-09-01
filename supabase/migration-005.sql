-- Fidely — Migration 005 : fidélité configurable, code client, prestations multiples
-- SQL Editor > New query > Run

alter table customers add column if not exists code text;
alter table customers add column if not exists stamps integer not null default 0;
alter table customers alter column program_id drop not null;
alter table visits add column if not exists employee_id integer references employees(id);
alter table services add column if not exists points integer; -- points custom (sinon calculé sur le prix)
alter table service_variants add column if not exists points integer;

create table if not exists loyalty_settings (
  id serial primary key,
  business_id integer not null unique references businesses(id),
  mode text not null default 'visits', -- 'visits' | 'points' | 'stamps'
  created_at timestamp default now()
);

create table if not exists rewards (
  id serial primary key,
  business_id integer not null references businesses(id),
  label text not null,
  threshold integer not null,
  type text not null default 'custom', -- discount_amount | discount_percent | free_service | product | custom
  value text,
  active boolean not null default true,
  created_at timestamp default now()
);

create table if not exists tiers (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  threshold integer not null,
  perks text,
  sort_order integer not null default 0,
  created_at timestamp default now()
);

create table if not exists customer_rewards (
  id serial primary key,
  customer_id text not null references customers(id),
  reward_id integer not null references rewards(id),
  redeemed_at timestamp not null default now(),
  redeemed_by text references users(uid)
);

alter table loyalty_settings enable row level security;
alter table rewards enable row level security;
alter table tiers enable row level security;
alter table customer_rewards enable row level security;

-- Migration 006 (ajoutée ensuite) : pourboire/réduction/offert, niveaux avec fenêtre de temps
alter table visits add column if not exists tip integer default 0;
alter table visits add column if not exists discount integer default 0;
alter table visits add column if not exists offered boolean default false;
-- true seulement sur la 1ère ligne de chaque passage (un passage peut avoir plusieurs
-- prestations) : sert à compter les VRAIS passages, pas les lignes de prestation.
alter table visits add column if not exists is_primary boolean default true;
alter table tiers add column if not exists window_days integer; -- ex: 60 = "N visites en 60 jours" ; vide = illimité
