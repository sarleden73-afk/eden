# Fidely

CRM de fidélité pour tout type de commerce (salons, boutiques, restaurants,
cabinets, ateliers...) : programmes de fidélité, fiches clients avec carte QR
partageable, scan de visites, agenda de rendez-vous, prestations, employés et
pointage.

## Stack

- Frontend : React 19 + Vite + TypeScript + Tailwind
- Backend : Express (`server.ts`), servi par le même processus que Vite en dev
- Base de données : Supabase (Postgres), via `@supabase/supabase-js`
  (`src/lib/supabase-server.ts`) — le backend utilise la clé secrète et
  contourne Row Level Security ; RLS est activé sans policy sur chaque table
  pour bloquer tout accès direct via la clé publique
- Authentification : Supabase Auth (connexion Google), le token est vérifié
  côté serveur dans `src/middleware/auth.ts`

## Prérequis

- Node.js 20+
- Un projet Supabase, avec le provider Google activé dans
  **Authentication > Providers** (nécessite un Client ID/Secret OAuth créé
  dans Google Cloud Console)

## Installation

1. Installer les dépendances :
   ```
   npm install
   ```
2. Créer les tables : dans le dashboard Supabase, ouvrir **SQL Editor > New
   query**, coller le contenu de [`supabase/schema.sql`](supabase/schema.sql)
   et l'exécuter (une seule fois).
3. Copier `.env.example` vers `.env` et renseigner les 4 variables Supabase
   (Project Settings > API dans Supabase — la clé **secrète** ne doit jamais
   être exposée au client, contrairement à la clé publique).
4. Dans Supabase, **Authentication > URL Configuration**, ajouter
   `http://localhost:3000/dashboard` aux Redirect URLs autorisées.
5. Lancer l'app :
   ```
   npm run dev
   ```

## Scripts

- `npm run dev` — serveur de dev (Express + Vite en middleware mode)
- `npm run build` — build de production (client + serveur)
- `npm run start` — lance le build de production
- `npm run lint` — vérification TypeScript (`tsc --noEmit`)
