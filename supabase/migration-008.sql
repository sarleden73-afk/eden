-- Fidely — Migration 008 : pointage libre (arrivée OU départ, dans n'importe quel ordre)
-- SQL Editor > New query > Run

-- Un employé doit pouvoir pointer son départ même s'il a oublié de pointer son
-- arrivée (et inversement) : clock_in_time devient optionnel pour permettre
-- l'enregistrement d'un départ seul (arrivée inconnue, affichée "—" dans l'historique).
alter table time_logs alter column clock_in_time drop not null;
