-- Fidely — Migration 012 : pointage auto-ciblé + vente directe de produits
-- SQL Editor > New query > Run

-- Lie un login (members) à sa fiche employé (planning/pointage), pour que le
-- rôle 'employee' pointe directement pour lui-même sans liste à choisir.
alter table members add column if not exists employee_id integer references employees(id);

-- Prix de vente d'1 unité (FCFA, centimes), pour rendre un produit d'inventaire
-- vendable directement à la caisse (ex: une boisson), pas seulement lié à une
-- prestation. Optionnel : les consommables internes (teinture...) n'en ont pas besoin.
alter table products add column if not exists price integer;
