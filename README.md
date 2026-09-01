# EDEN MULTI-SERVICES — Plateforme de gestion et de contrôle interne

Application web qui centralise les ventes, la caisse, les stocks, les achats,
les fournisseurs, les dépenses, le personnel, les clients, les commandes, la
comptabilité, les rapports et la traçabilité des deux pôles de l'entreprise :

- **Pôle 1 — EDEN MULTI-SERVICES** : cyber/services numériques, infographie,
  fournitures scolaires, packs scolaires, sacs, gourdes.
- **Pôle 2 — EDEN FOOD** : sandwichs, pains/omelettes, crêpes et gaufres, boissons.

Chaque écriture est rattachée à un pôle : les résultats sont consultables
séparément **et** de façon consolidée.

---

## Stack

| Couche | Choix |
|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS 4 |
| Graphiques | Recharts |
| Backend | Express (`src/api.ts`), servi par le même processus que Vite en dev |
| Base de données | Supabase (PostgreSQL) |
| Authentification | Supabase Auth — identifiant (e-mail) + mot de passe |
| Hébergement | Vercel (frontend statique + API en fonction serverless) |

### Modèle de sécurité

Row Level Security est **activé sans aucune policy** sur toutes les tables. La
clé `publishable` exposée au navigateur ne peut donc rien lire ni écrire : elle
ne sert qu'à l'authentification. Toutes les données transitent par l'API
Express, qui détient la clé `secret` et applique les autorisations par rôle
(§5.1 du cahier des charges) sur **chaque** appel.

Masquer un écran dans l'interface n'est qu'un confort : la règle qui fait foi
est côté serveur, dans [`src/api.ts`](src/api.ts).

---

## Installation

### 1. Dépendances

```bash
npm install
```

### 2. Base de données

Dans le tableau de bord Supabase, ouvrir **SQL Editor > New query**, puis
exécuter dans cet ordre :

1. [`supabase/eden/01-schema.sql`](supabase/eden/01-schema.sql) — tables, types,
   index, déclencheurs et RLS.
2. [`supabase/eden/02-seed.sql`](supabase/eden/02-seed.sql) — catalogue complet
   des §2 et §3 du cahier des charges (~90 articles et prestations, 4 packs).

Le script de seed est **idempotent** : le relancer ne crée pas de doublons.

### 3. Variables d'environnement

```bash
cp .env.example .env
```

Renseigner les quatre variables (voir les commentaires du fichier). Elles se
trouvent dans Supabase : **Project Settings > Data API** pour l'URL,
**Project Settings > API Keys** pour les deux clés.

### 4. Premier administrateur

Aucune inscription libre n'est possible — une plateforme de contrôle interne ne
peut pas laisser n'importe qui se créer un accès. Le tout premier compte se crée
donc à la main :

1. Dans Supabase, **Authentication > Users > Add user** : saisir l'e-mail et le
   mot de passe, et cocher **Auto Confirm User**.
2. Copier l'`UID` de l'utilisateur créé.
3. Dans **SQL Editor**, exécuter :

```sql
insert into profiles (id, full_name, email, role, poste)
values (
  'COLLER-L-UID-ICI',
  'Ledy Dayana Koumou',
  'adresse@exemple.com',
  'admin',
  'Responsable'
);
```

Cet administrateur crée ensuite tous les autres comptes depuis l'écran
**Personnel**, sans repasser par SQL.

### 5. Lancer

```bash
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

---

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement (Express + Vite en middleware) |
| `npm run build` | Build de production (client + serveur) |
| `npm run start` | Lance le build de production |
| `npm run lint` | Vérification TypeScript (`tsc --noEmit`) |

---

## Déploiement sur Vercel

1. Connecter le dépôt GitHub au projet Vercel.
2. Dans **Settings > Environment Variables**, ajouter les quatre variables du
   `.env` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`).
3. Déployer. [`vercel.json`](vercel.json) route `/api/*` vers la fonction
   serverless et tout le reste vers le SPA.

> La clé `SUPABASE_SECRET_KEY` ne doit exister que dans les variables
> d'environnement Vercel et le `.env` local. Jamais dans le dépôt.

---

## Correspondance avec le cahier des charges

| § | Exigence | Où c'est traité |
|---|---|---|
| 5.1 | Comptes, rôles et autorisations | [`Personnel.tsx`](src/pages/Personnel.tsx) · gardes dans [`api.ts`](src/api.ts) |
| 5.2 | Enregistrement des ventes | [`Vente.tsx`](src/pages/Vente.tsx) · [`Ventes.tsx`](src/pages/Ventes.tsx) |
| 5.3 | Caisse : ouverture, mouvements, fermeture, écart | [`Caisse.tsx`](src/pages/Caisse.tsx) |
| 5.4 | Modes de paiement | Les 5 valeurs du type `payment_method` |
| 5.5 | Stocks, décrément automatique, alertes | [`Stocks.tsx`](src/pages/Stocks.tsx) · `apply_stock_movement` |
| 5.6 | Achats et fournisseurs | [`Achats.tsx`](src/pages/Achats.tsx) |
| 5.7 | Dépenses et validation | [`Depenses.tsx`](src/pages/Depenses.tsx) |
| 5.8 | Commandes infographie | [`Commandes.tsx`](src/pages/Commandes.tsx) |
| 5.9 | Clients et historique | [`Clients.tsx`](src/pages/Clients.tsx) |
| 5.10 | Traçabilité et motifs obligatoires | [`Journal.tsx`](src/pages/Journal.tsx) · table `audit_log` |
| 5.11 | Tableau de bord | [`Dashboard.tsx`](src/pages/Dashboard.tsx) |
| 5.12 | Rapports, statistiques, exports | [`Rapports.tsx`](src/pages/Rapports.tsx) · [`export.ts`](src/lib/export.ts) |
| 5.13 | Comptabilité : CA → coût → marge → charges → résultat | [`Comptabilite.tsx`](src/pages/Comptabilite.tsx) |
| 5.14 | Sécurité, niveaux d'accès, déconnexion auto | RLS · rôles serveur · [`AuthContext.tsx`](src/contexts/AuthContext.tsx) |
| 6 | Informations de l'entreprise | [`Parametres.tsx`](src/pages/Parametres.tsx) |

### Choix structurants

- **Montants en `bigint`.** Le franc CFA n'a pas de sous-unité : aucune décimale
  à gérer, et aucune erreur d'arrondi flottant sur les cumuls.
- **Prix relus en base à chaque vente.** Le §5.1 réserve la modification des
  prix à l'administrateur. Si le poste de caisse pouvait envoyer un prix
  arbitraire, cette règle ne vaudrait rien. Seule la remise, prévue au §5.2,
  permet de descendre sous le tarif — et elle est enregistrée comme telle.
- **Décrément de stock en SQL** (`apply_stock_movement`), pas en JavaScript :
  « lire, calculer, réécrire » depuis Node laisse une fenêtre où deux ventes
  simultanées du même article écrasent le décrément l'une de l'autre.
- **Coût des marchandises figé à la vente.** Le prix d'achat est recopié dans la
  ligne de vente : la marge historique ne bouge pas quand un tarif fournisseur
  change plus tard.
- **Solde de caisse limité aux espèces.** Le Mobile Money et les virements
  n'entrent pas dans le tiroir ; les compter fausserait l'écart de fermeture.
- **Rien n'est jamais supprimé.** Une vente annulée change de statut, garde son
  motif, son auteur et son heure ; le stock est restitué et la caisse
  contre-passée si elle est encore ouverte.
- **Les périodes sont calculées en heure de Brazzaville** (UTC+1, sans heure
  d'été), pas dans le fuseau du serveur. Vercel tourne en UTC : sans ce
  décalage explicite, « aujourd'hui » commencerait à 23 h la veille et une vente
  passée à 00h30 tomberait dans la journée précédente. Le décalage est la
  constante `DECALAGE_MINUTES` dans [`src/api.ts`](src/api.ts) — la seule ligne
  à changer si l'entreprise ouvre ailleurs.
- **Le tableau de bord s'adapte au rôle.** Caissier et technicien n'ont qu'une
  « consultation limitée » (§5.1) : ils voient leur propre activité, la caisse
  de leur pôle et les alertes de stock. Marge, dépenses et bénéfice ne sont pas
  masqués à l'écran mais absents de la réponse du serveur — une valeur envoyée
  puis cachée reste lisible dans l'onglet réseau du navigateur.

---

## Points restant à préciser

Le cahier des charges signale des éléments à confirmer. Ils n'empêchent pas
d'utiliser la plateforme, mais rendront les chiffres plus justes. Ils sont
rappelés dans l'écran **Paramètres** :

- **Prix d'achat des articles** — laissés à 0 par le seed. Tant qu'ils ne sont
  pas renseignés, la marge brute est égale au chiffre d'affaires et le résultat
  est surévalué. Ils se saisissent dans **Catalogue**, ou se mettent à jour
  automatiquement à chaque achat fournisseur.
- **Quantités initiales en stock** — à saisir via un achat ou un ajustement
  d'inventaire.
- **Composition des quatre packs scolaires** — le cahier des charges donne les
  prix (35 000 / 35 000 / 38 000 / 40 000 FCFA), pas le contenu. À composer dans
  **Catalogue > Packs**.
- **Moyens de paiement réellement utilisés** — les cinq du §5.4 sont proposés.
- **Libellé exact du second article « Crayons de couleur »** (§2.3).
- **Formats exacts des boissons** à 500 et 1 000 FCFA (§3.4).
- **Cuisinière et agent polyvalent** du pôle EDEN FOOD (§4.2).
- **Adresse, téléphone, e-mail, NIU et logo** de l'entreprise (§6).
