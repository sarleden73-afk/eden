-- Fidely — Migration 009 : avis clients (QR code -> page publique -> panneau admin)
-- SQL Editor > New query > Run

create table if not exists reviews (
  id serial primary key,
  business_id integer not null references businesses(id),
  rating integer not null,          -- 1 à 5 étoiles
  comment text,
  customer_name text,
  created_at timestamp default now()
);

alter table reviews enable row level security;
