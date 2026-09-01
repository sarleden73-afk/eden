-- Fidely — Migration 011 : historique des mouvements de stock (traçabilité)
-- SQL Editor > New query > Run

-- Chaque changement de stock (réapprovisionnement manuel OU décompte automatique lors
-- d'une vente) doit correspondre à une opération tracée : qui, quand, pourquoi, combien.
create table if not exists stock_movements (
  id serial primary key,
  business_id integer not null references businesses(id),
  product_id integer not null references products(id),
  delta integer not null, -- en utilisations : positif = entrée (réappro), négatif = sortie (vente)
  reason text not null,
  created_by text references users(uid),
  created_at timestamp default now()
);

alter table stock_movements enable row level security;
