-- Fidely — Migration 010 : contact du client sur les avis (nom + téléphone)
-- SQL Editor > New query > Run

alter table reviews add column if not exists customer_phone text;
