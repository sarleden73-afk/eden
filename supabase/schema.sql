-- Fidely — schéma Postgres pour Supabase
-- À exécuter une fois dans Supabase : Dashboard > SQL Editor > New query > Run

create table if not exists users (
  id serial primary key,
  uid text not null unique,
  email text not null,
  created_at timestamptz default now()
);

create table if not exists businesses (
  id serial primary key,
  name text not null,
  owner_uid text not null references users(uid),
  created_at timestamptz default now()
);

create table if not exists programs (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  visits_required integer not null,
  reward_description text not null,
  created_at timestamptz default now()
);

create table if not exists customers (
  id text primary key, -- token sécurisé (carte QR / URL publique)
  business_id integer not null references businesses(id),
  name text not null,
  phone text not null,
  visits integer not null default 0,
  points integer not null default 0,
  card_number text, -- ID court lisible (ex: D445)
  program_id integer not null references programs(id),
  reward_status text not null default 'pending',
  created_at timestamptz default now()
);

create table if not exists visits (
  id serial primary key,
  customer_id text not null references customers(id),
  business_id integer not null references businesses(id),
  service_id integer references services(id),
  service_name text,
  amount integer,
  points integer not null default 0,
  date timestamptz not null default now(),
  validated_by text not null references users(uid)
);

create table if not exists employees (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  role text not null,
  phone text,
  status text not null default 'active',
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists services (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  category text,
  duration integer not null,
  price integer not null,
  description text,
  created_at timestamptz default now()
);

create table if not exists appointments (
  id serial primary key,
  business_id integer not null references businesses(id),
  customer_id text not null references customers(id),
  employee_id integer references employees(id),
  service_id integer not null references services(id),
  -- Volontairement `timestamp` SANS fuseau (pas timestamptz comme les autres colonnes
  -- de ce fichier) : convention différente et déjà cohérente où les chiffres stockés
  -- SONT l'heure murale locale telle que saisie, sans conversion. Voir le commentaire
  -- en tête de src/publicApi.ts et supabase/migration-013.sql pour le détail.
  start_time timestamp not null,
  end_time timestamp not null,
  status text not null default 'scheduled',
  created_at timestamptz default now()
);

create table if not exists time_logs (
  id serial primary key,
  employee_id integer not null references employees(id),
  clock_in_time timestamptz not null,
  clock_out_time timestamptz,
  selfie_url text,
  location_lat text,
  location_lng text,
  liveness_confirmed text default 'false'
);

create table if not exists categories (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  created_at timestamptz default now()
);

alter table services add column if not exists category_id integer references categories(id);

create table if not exists transactions (
  id serial primary key,
  business_id integer not null references businesses(id),
  type text not null,               -- 'credit' | 'debit'
  amount integer not null,          -- FCFA (entier)
  category text,
  description text,
  date timestamptz not null default now(),
  created_by text references users(uid),
  created_at timestamptz default now()
);

create table if not exists members (
  id serial primary key,
  business_id integer not null references businesses(id),
  email text not null,
  uid text references users(uid),
  name text,
  role text not null default 'staff', -- 'admin' | 'staff' | 'employee' (pointage uniquement)
  employee_id integer references employees(id), -- pour le rôle 'employee' : à quel employé ce login correspond
  created_at timestamptz default now(),
  unique (business_id, email)
);

create table if not exists service_variants (
  id serial primary key,
  service_id integer not null references services(id),
  name text not null,
  price integer not null,   -- cents
  duration integer,
  created_at timestamptz default now()
);

-- Supabase expose automatiquement chaque table via son API REST publique.
-- On active RLS sans aucune policy : ça bloque totalement l'accès via la clé
-- publique (sb_publishable_...). Seul le backend Fidely, qui utilise la clé
-- secrète (sb_secret_...), peut lire/écrire — RLS ne s'applique pas à elle.
alter table users enable row level security;
alter table businesses enable row level security;
alter table programs enable row level security;
alter table customers enable row level security;
alter table visits enable row level security;
alter table employees enable row level security;
alter table services enable row level security;
alter table appointments enable row level security;
alter table time_logs enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table members enable row level security;
alter table service_variants enable row level security;
