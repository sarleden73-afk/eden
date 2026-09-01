-- Fidely — Migration 007 : inventaire / gestion des stocks (salon de beauté)
-- SQL Editor > New query > Run

-- Un produit du stock. Le stock est exprimé en "utilisations restantes" (stock_uses)
-- pour coller au métier : une boîte de teinture = 6 utilisations, donc 5 boîtes = 30.
-- uses_per_unit sert à convertir utilisations <-> unités (boîtes) à l'affichage/réappro.
create table if not exists products (
  id serial primary key,
  business_id integer not null references businesses(id),
  name text not null,
  category text,                                  -- ex: Teinture, Vernis, Consommable, Soin
  unit_label text not null default 'unité',       -- ex: boîte, flacon, sachet
  uses_per_unit integer not null default 1,       -- ex: 1 boîte = 6 utilisations
  stock_uses integer not null default 0,          -- stock restant, exprimé en utilisations
  low_stock_uses integer not null default 0,      -- seuil d'alerte (en utilisations)
  created_at timestamp default now()
);

-- Lie une prestation à un produit consommé quand elle est réalisée.
-- Le lien se configure dans l'onglet Inventaire (pas à la caisse) : la caissière
-- vend normalement, et le stock se décrémente tout seul.
create table if not exists service_products (
  id serial primary key,
  service_id integer not null references services(id),
  product_id integer not null references products(id),
  uses_per_prestation integer not null default 1, -- utilisations consommées à chaque prestation
  created_at timestamp default now(),
  unique (service_id, product_id)
);

alter table products enable row level security;
alter table service_products enable row level security;
