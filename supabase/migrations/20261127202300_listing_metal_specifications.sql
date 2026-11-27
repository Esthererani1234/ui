alter table public.products
  add column fineness numeric check (fineness > 0 and fineness <= 1 and scale(fineness) <= 6),
  add column gold_karat numeric check (gold_karat is null or (gold_karat > 0 and gold_karat <= 24 and scale(gold_karat) <= 3 and metal = 'gold')),
  add column gross_weight_g numeric check (gross_weight_g > 0 and gross_weight_g < 1000000000 and scale(gross_weight_g) <= 6),
  add column mint_or_refiner text check (length(mint_or_refiner) between 1 and 120);
comment on column public.products.gross_weight_g is 'Unpackaged product weight in grams. Pricing uses metal_weight_oz, the fine metal content in troy ounces.';
comment on column public.products.fineness is 'Precious metal mass fraction, e.g. 0.9999 for 99.99%.';

-- Carry over the catalog's previously published specifications for the matching editions.
-- The Rand Loxodonta specifications are corroborated by Costco 1768080 and the
-- Bullion Exchanges 1 oz Rand Refinery .9999 in-assay listing (gross weight).
update public.products p
set fineness = s.fineness, gold_karat = s.karat, gross_weight_g = s.grams, mint_or_refiner = s.maker
from (values
  ('1-oz-american-gold-buffalo-proof-random-year','1 oz American Gold Buffalo Proof Coin (Random Year) - .9999 Fine Gold','gold',1,.9999,24,31.108,'United States Mint'),
  ('1-oz-pamp-suisse-lady-fortuna-gold-bar-in-assay','1 oz PAMP Suisse Lady Fortuna Gold Bar (In Assay)','gold',1,.9999,24,31.10,'PAMP Suisse'),
  ('1-oz-american-gold-eagle-bu-random-year','1 oz American Gold Eagle BU (Random Year)','gold',1,.9167,22,33.931,'United States Mint'),
  ('1-oz-apmex-gold-bar-tep','1 oz APMEX Gold Bar (TEP)','gold',1,.9999,24,31.10,'APMEX'),
  ('1-oz-canadian-gold-maple-leaf-bu-random-year','1 oz Canadian Gold Maple Leaf BU (Random Year)','gold',1,.9999,24,31.11,'Royal Canadian Mint'),
  ('1-oz-canadian-silver-maple-leaf-bu-random-year','1 oz Canadian Silver Maple Leaf Coin BU (Random Year)','silver',1,.9999,null,31.11,'Royal Canadian Mint'),
  ('1-kg-gold-bar-9999-fine-random-brand','1 Kilogram Gold Bar – 999.9 Fine Gold (Random Brand)','gold',32.15,.9999,24,1000,'Various refiners'),
  ('1-oz-rand-refinery-loxodonta-gold-bar-9999-fine','1 oz Rand Refinery Loxodonta Gold Bar – .9999 Fine Gold','gold',1,.9999,24,31.103,'Rand Refinery')
) as s(slug,name,metal,fine_oz,fineness,karat,grams,maker)
where p.slug = s.slug and p.name = s.name and p.metal::text = s.metal and p.metal_weight_oz = s.fine_oz;
