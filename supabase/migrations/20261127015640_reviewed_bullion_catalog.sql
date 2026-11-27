-- Product IDs differ between databases. Resolve the reviewed SKU, title, metal and weight together.
-- System-supplied versions have no merchant actor. Manual publications still require an administrator.
alter table private.tax_versions alter column actor drop not null;
alter table private.tax_versions add constraint tax_version_origin check (
  actor is not null or data->>'origin' is not distinct from 'catalog_policy_release_2026_11_26'
);

create temporary table catalog_tax_sources(state text primary key, url text not null) on commit drop;
insert into catalog_tax_sources values
('NY','https://www.nysenate.gov/legislation/laws/TAX/1115'),
('WA','https://dor.wa.gov/education/industry-guides/jewelry-stores/currency-coins-and-precious-metal-bullion'),
('TX','https://tcss.legis.texas.gov/resources/tx/htm/tx.151.htm'),
('FL','https://floridarevenue.com/taxes/tips/Documents/TIP_25A01-03.pdf'),
('MN','https://www.revenue.state.mn.us/guide/nontaxable-sales-11'),
('NH','https://www.revenue.nh.gov/faq/does-new-hampshire-have-sales-tax'),
('OR','https://www.oregon.gov/dor/programs/businesses/Pages/Sales-Tax.aspx'),
('DE','https://revenue.delaware.gov/business-tax-forms/doing-business-in-delaware/step-4-gross-receipts-taxes/');

with reviewed(sku,title,form,metal,weight) as (values
 ('GOTS-GBP-1OZ-RY-001','1 oz American Gold Buffalo Proof Coin (Random Year) - .9999 Fine Gold','coin','gold',1),
 ('AGE-1OZ-BU-RY','1 oz American Gold Eagle BU (Random Year)','coin','gold',1),
 ('PAMP-1OZ-FORTUNA-ASSAY','1 oz PAMP Suisse Lady Fortuna Gold Bar (In Assay)','bar','gold',1),
 ('APMEX-1OZ-TEP','1 oz APMEX Gold Bar (TEP)','bar','gold',1),
 ('MAPLE-1OZ-BU-RY','1 oz Canadian Gold Maple Leaf BU (Random Year)','coin','gold',1),
 ('SML-1OZ-BU-RY','1 oz Canadian Silver Maple Leaf Coin BU (Random Year)','coin','silver',1),
 ('GOTS-834790','1 Kilogram Gold Bar – 999.9 Fine Gold (Random Brand)','bar','gold',32.15),
 ('RAND-0033','1 oz Rand Refinery Loxodonta Gold Bar – .9999 Fine Gold','bar','gold',1)
)
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select s.state,'product',p.id::text,
 jsonb_build_object('origin','catalog_policy_release_2026_11_26','form',r.form,'metal',r.metal,'catalog_sku',r.sku,
 'catalog_name',r.title,'catalog_weight',r.weight,'treatment',case when s.state in ('WA','MN') then 'taxable' else 'eligible' end),
 s.url,'2026-11-26','2026-12-31','2026-11-26',
 case when s.state='NY' and r.sku='GOTS-GBP-1OZ-RY-001' then 'requires_review' else 'approved' end
from reviewed r join public.products p on (p.sku,p.name,p.metal::text,p.metal_weight_oz)=(r.sku,r.title,r.metal,r.weight)
cross join catalog_tax_sources s where p.is_active and (s.state<>'FL' or r.form='bar') and (s.state<>'MN' or r.form='coin');

insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26','no_general_collection_regime',state<>'NY',
 'uniform_jurisdiction_base',true,'first_eligible_cent',case when state='NY' then 100001 else 0 end,'store_minimum',state='NY',
 'shipping_base','full_if_taxable','fee_base','proportional','rounding','combined'),
 url,'2026-11-26','2026-12-31','2026-11-26','approved'
from catalog_tax_sources where state in ('NH','DE','OR','NY');

-- State-level absence of a general sales tax is independent of both registration and the seller's historical sales.
-- Keep other business tax determinations separate. The customer-side policy applies only to the reviewed items.
alter function private.tax_collection_gate(text,jsonb,date) rename to tax_registration_gate;
create function private.tax_collection_gate(s text,p jsonb,d date) returns text stable language sql set search_path='' as $$
 select case when s in ('NH','DE','OR') and p->>'state'=s and p->>'approval'='approved'
  and p->>'no_general_collection_regime'='true' and (p->>'valid_from')::date<=d
  and (p->>'valid_until')::date>=d and (p->>'verified_on')::date<=d then 'no_obligation'
  else private.tax_registration_gate(s,p,d) end
$$;
-- SQL functions defined with string bodies resolve this function by name on execution.
update private.tax_revision set revision=revision+1;
