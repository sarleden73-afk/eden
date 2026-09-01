-- ============================================================================
-- EDEN MULTI-SERVICES — Catalogue initial (cahier des charges §2 et §3)
-- ----------------------------------------------------------------------------
-- À exécuter après 01-schema.sql. Idempotent : relançable sans créer de
-- doublons (on conflict do nothing sur (nom, pole)).
--
-- Les prix de vente sont ceux du cahier des charges. Les prix d'achat sont à 0
-- et restent à renseigner (§6 « Produits ») : tant qu'ils valent 0, la marge
-- brute affichée en comptabilité est égale au chiffre d'affaires. Ils se
-- saisissent dans l'app (Catalogue > modifier un article), sans SQL.
-- ============================================================================

-- Contrainte d'unicité fonctionnelle utilisée par les `on conflict` ci-dessous.
create unique index if not exists products_nom_pole_uniq on products (nom, pole);

-- ---------------------------------------------------------------------------
-- Catégories
-- ---------------------------------------------------------------------------

insert into categories (nom, pole, kind, ordre) values
  ('Cyber / Services numériques',    'MULTI_SERVICES', 'prestation', 1),
  ('Infographie / Personnalisation', 'MULTI_SERVICES', 'prestation', 2),
  ('Fournitures scolaires',          'MULTI_SERVICES', 'produit',    3),
  ('Sacs',                           'MULTI_SERVICES', 'produit',    4),
  ('Gourdes',                        'MULTI_SERVICES', 'produit',    5),
  ('Sandwichs',                      'FOOD',           'produit',    1),
  ('Pains / Omelettes',              'FOOD',           'produit',    2),
  ('Crêpes et gaufres',              'FOOD',           'produit',    3),
  ('Boissons',                       'FOOD',           'produit',    4)
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.1 Cyber / Services numériques — prestations, pas de stock
-- ---------------------------------------------------------------------------

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'prestation'::item_kind, v.prix, false, 'unité'
from (values
  ('Photocopie noir et blanc',   50),
  ('Photocopie couleur',        100),
  ('Impression noir et blanc',  100),
  ('Impression couleur',        125),
  ('Scan',                      500),
  ('Reliure de documents',     1000),
  ('Plastification',           1500),
  ('Photo d''identité',        2000),
  ('Création de flyers',       3500),
  ('Création d''étiquettes',   3500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Cyber / Services numériques' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.2 Infographie / Personnalisation — prestations
-- ---------------------------------------------------------------------------
-- Les articles personnalisés (tasse, casquette, t-shirt) consomment un support
-- physique. Ils sont saisis ici en prestation ; basculer `gere_stock` à true
-- depuis l'app si le client veut suivre le stock de supports vierges.

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'prestation'::item_kind, v.prix, false, 'unité'
from (values
  ('Tasse personnalisée',          3000),
  ('Casquette personnalisée',      2000),
  ('T-shirt personnalisé',         2500),
  ('Création de CV',               1500),
  ('Création de logo',            10000),
  ('Carte d''anniversaire',        2000),
  ('Carte de mariage',             3000),
  ('Carte de visite',              1500),
  ('Création de livret de loyer',  3500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Infographie / Personnalisation' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.3 Fournitures scolaires — produits, stock suivi
-- ---------------------------------------------------------------------------
-- Seuil d'alerte initialisé à 5 pour tous les articles (§5.5 « seuil
-- d'alerte ») ; ajustable article par article depuis l'app.

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'produit'::item_kind, v.prix, true, 5, 'unité'
from (values
  ('Cahier simple 288 pages',                      450),
  ('Cahier simple 100 pages',                      300),
  ('Cahier simple CP 50 pages',                    250),
  ('Cahier cartonné 288 pages',                    650),
  ('Grand cahier 288 pages',                      1500),
  ('Stylo-ciseau bleu',                            200),
  ('Stylo simple rouge/bleu/noir',                 100),
  ('Correcteur',                                   300),
  ('Crayon simple',                                 50),
  ('Crayon dessin animé',                          100),
  ('Livre CP',                                    3500),
  ('Livre CE1',                                   4000),
  ('Livre CE2',                                   4000),
  ('Livre CM1',                                   4500),
  ('Livre CM2',                                   5000),
  ('Règle plastique',                              400),
  ('Règle cassable',                               500),
  ('Papier ramé',                                 4500),
  ('Agrafes',                                     1000),
  ('Agrafeuse',                                   1000),
  ('Agrafeuse enveloppes kaki',                    100),
  ('Taille-crayon simple',                         150),
  ('Taille-crayon avec couvercle',                 300),
  ('Ciseaux',                                      700),
  ('Boîte de craies blanches',                     600),
  ('Boîte de craies de couleur',                   700),
  ('Boîte mathématique',                          1500),
  ('Chemise cartonnée',                            100),
  ('Bâton de colle',                               700),
  ('Calculatrice',                                1500),
  ('Ardoise',                                      500),
  ('Colle',                                        500),
  ('Marqueur',                                     500),
  ('Crayons de couleur – petit modèle',           1500),
  ('Crayons de couleur – à préciser',             2000),
  ('Gomme enfant',                                 150),
  ('Gomme pour grand',                             200),
  ('Sous-chemise',                                 100),
  ('Gros feutre',                                 3000),
  ('Gouache',                                     3500),
  ('Crayola petit modèle',                        2500),
  ('Crayola grand modèle',                        3000),
  ('Pâte à modeler',                              3000),
  ('Feutre petit modèle',                         1500),
  ('Gros feutre petit modèle',                    2500),
  ('Alphabet – lot de lettres',                    500),
  ('Chiffres – lot des chiffres',                  500),
  ('Bâtonnets',                                    500),
  ('Stabilo',                                      500),
  ('Autocollants pour cahiers',                    500),
  ('Aquarelles',                                  3000),
  ('Papiers ministre',                             300),
  ('Couverture document plastique (avant)',        500),
  ('Couverture document cartonnée (arrière)',      500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Fournitures scolaires' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.5 Sacs
-- ---------------------------------------------------------------------------

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'produit'::item_kind, v.prix, true, 3, 'unité'
from (values
  ('Sac Mini',                                                                    12000),
  ('Sac Spiderman',                                                               12000),
  ('Sac Pat''Patrouille bleu',                                                    10000),
  ('Sac Pat''Patrouille rose',                                                    10000),
  ('Sac fille primaire',                                                           8500),
  ('Sac garçon primaire',                                                          8500),
  ('Sac fille collège/lycée — noir, rose, marron, gris',                           8500),
  ('Sac mixte — Adidas, New Balance, Calvin Klein, OGIO — noir, gris, marron, bleu nuit', 10000),
  ('Sac garçon collège/lycée — noir, gris, beige, vert, bleu, orange',            12000),
  ('Sac mixte — bleu, gris',                                                      13000)
) as v(nom, prix)
cross join (select id from categories where nom = 'Sacs' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.6 Gourdes
-- ---------------------------------------------------------------------------

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'MULTI_SERVICES'::pole, 'produit'::item_kind, v.prix, true, 3, 'unité'
from (values
  ('Gourde enfant avec dessins animés', 2500),
  ('Gourde enfant simple',              2000),
  ('Gourde pour grand',                 2000)
) as v(nom, prix)
cross join (select id from categories where nom = 'Gourdes' and pole = 'MULTI_SERVICES') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §3.1–3.3 EDEN FOOD — préparations
-- ---------------------------------------------------------------------------
-- gere_stock = false : ces articles sont préparés à la commande. Ce qui se
-- suit en stock, ce sont les matières premières (farine, œufs, poulet...),
-- saisies via Achats et Dépenses. Basculer un article en stock suivi depuis
-- l'app si le client veut compter des produits finis.

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, false, 'unité'
from (values
  ('Sandwich au poulet',  1000),
  ('Sandwich à la viande', 1500)
) as v(nom, prix)
cross join (select id from categories where nom = 'Sandwichs' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, false, 'unité'
from (values
  ('Pain à l''omelette simple',      500),
  ('Pain à l''omelette + saucisson', 600),
  ('Pain à l''omelette + jambon',    700)
) as v(nom, prix)
cross join (select id from categories where nom = 'Pains / Omelettes' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, false, 'unité'
from (values
  ('Crêpe nature',       600),
  ('Crêpe au chocolat',  800),
  ('Gaufre nature',      500),
  ('Gaufre au chocolat', 600)
) as v(nom, prix)
cross join (select id from categories where nom = 'Crêpes et gaufres' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

-- §3.4 Boissons — bouteilles achetées puis revendues : stock réellement suivi.
insert into products (nom, category_id, pole, kind, prix_vente, gere_stock, seuil_alerte, unite)
select v.nom, c.id, 'FOOD'::pole, 'produit'::item_kind, v.prix, true, 12, 'bouteille'
from (values
  ('Eau — petite bouteille',  250),
  ('Eau — autre format',      500),
  ('Jus — petite bouteille',  350),
  ('Jus — autre format',     1000)
) as v(nom, prix)
cross join (select id from categories where nom = 'Boissons' and pole = 'FOOD') c
on conflict (nom, pole) do nothing;

-- ---------------------------------------------------------------------------
-- §2.4 Packs scolaires
-- ---------------------------------------------------------------------------
-- Créés vides : le cahier des charges donne le prix des quatre packs mais pas
-- leur composition. Elle se définit dans l'app (Catalogue > Packs > composer),
-- article par article, et le prix reste modifiable indépendamment.

insert into packs (nom, pole, prix_vente, description)
select v.nom, 'MULTI_SERVICES'::pole, v.prix, 'Composition à définir dans Catalogue > Packs'
from (values
  ('Pack maternelle', 35000),
  ('Pack primaire',   35000),
  ('Pack collège',    38000),
  ('Pack lycée',      40000)
) as v(nom, prix)
where not exists (select 1 from packs p where p.nom = v.nom);

-- ---------------------------------------------------------------------------
-- Paramètres de l'entreprise (§1 et §6)
-- ---------------------------------------------------------------------------
-- Les champs vides correspondent aux informations « restant à fournir » du
-- §6 : ils se renseignent dans l'app (Paramètres), sans SQL.

insert into settings (key, value) values
  ('entreprise', jsonb_build_object(
    'nom',       'EDEN MULTI-SERVICES',
    'adresse',   '',
    'telephone', '',
    'email',     '',
    'niu',       '',
    'logoUrl',   '',
    'devise',    'FCFA'
  ))
on conflict (key) do nothing;

insert into settings (key, value) values
  ('caisse', jsonb_build_object(
    -- §6 « Fonds de caisse initial » : proposé par défaut à l'ouverture, le
    -- caissier peut le corriger. À ajuster une fois le montant réel connu.
    'fondsInitialParDefaut', 0,
    -- §5.14 « Déconnexion automatique après inactivité ».
    'inactiviteMinutes',     30
  ))
on conflict (key) do nothing;
