-- Fidely — Migration 002 : catégories de prestations, comptabilité, personnel & rôles
-- À exécuter une fois dans Supabase : Dashboard > SQL Editor > New query > Run

-- 1) Catégories de prestations
create table if not exists categories (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  created_at timestamp default now()
);

-- Lier les prestations à une catégorie (la colonne texte "category" reste pour compat)
alter table services add column if not exists category_id integer references categories(id);

-- 2) Comptabilité : écritures de débit / crédit
create table if not exists transactions (
  id serial primary key,
  business_id integer not null references businesses(id),
  type text not null,               -- 'credit' (entrée) | 'debit' (sortie)
  amount integer not null,          -- montant en FCFA (entier)
  category text,                    -- ex: Vente, Loyer, Salaire, Imprévu, Autre
  description text,
  date timestamp not null default now(),
  created_by text references users(uid),
  created_at timestamp default now()
);

-- 3) Personnel : membres du commerce avec rôle (admin / staff)
create table if not exists members (
  id serial primary key,
  business_id integer not null references businesses(id),
  email text not null,
  uid text references users(uid),   -- rempli à la première connexion (matché par e-mail)
  name text,
  role text not null default 'staff', -- 'admin' | 'staff'
  created_at timestamp default now(),
  unique (business_id, email)
);

-- RLS : mêmes règles que les autres tables (bloqué via clé publique, ouvert via clé secrète du backend)
alter table categories enable row level security;
alter table transactions enable row level security;
alter table members enable row level security;
