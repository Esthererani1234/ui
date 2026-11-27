lock table private.tax_versions in share row exclusive mode;
alter table private.tax_versions add column report_only boolean not null default false;

create function private.tax_rule_at_day(s text,k text,sub text,d date,include_reports boolean)
returns jsonb stable language sql set search_path='' as $$
 select v.data||jsonb_build_object('version',v.id,'state',v.state,'approval',
   case when src.changed_at>v.created_at or (v.report_only and exists(
     select from private.tax_sources dep where v.data->'authority_sources' ? dep.url and dep.changed_at>v.created_at
   )) then 'requires_review' else v.approval end,
   'source',v.source,'verified_on',v.verified_on,'valid_from',v.valid_from,'valid_until',v.valid_until)
 from private.tax_versions v left join private.tax_sources src on src.url=v.source
 where v.state=s and v.kind=k and v.subject=sub and v.valid_from<=d and (include_reports or not v.report_only)
 order by v.valid_from desc,v.id desc limit 1
$$;
create or replace function private.tax_version(s text,k text,sub text,d date)
returns jsonb stable language sql set search_path='' as $$
 select private.tax_rule_at_day(s,k,sub,d,false)
$$;
create function private.tax_report_version(s text,k text,sub text,d date)
returns jsonb stable language sql set search_path='' as $$
 select private.tax_rule_at_day(s,k,sub,d,true)
$$;
revoke all on function private.tax_rule_at_day(text,text,text,date,boolean),private.tax_report_version(text,text,text,date) from public,anon,authenticated;

-- The NY investment price test covers proof coins. Preserve the prior review in history.
-- Gold Buffalo proof specifications are verified by the US Mint. Compare the locked
-- individual selling price with the statutory limit, including the $50 face value.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,v.state,v.kind,v.subject,v.data||jsonb_build_object(
 'specification_source','https://www.usmint.gov/news/press-releases/2026-american-buffalo-one-ounce-gold-proof-coin-available-may-7'),
 v.source,v.valid_from,v.valid_until,v.verified_on,'approved'
from private.tax_versions v
where v.state='NY' and v.kind='product' and v.approval='requires_review'
  and v.data->>'origin'='catalog_policy_release_2026_11_26' and v.data->>'catalog_sku'='GOTS-GBP-1OZ-RY-001'
  and (v.data->>'catalog_name',v.data->>'form',v.data->>'metal',(v.data->>'catalog_weight')::numeric)=
    ('1 oz American Gold Buffalo Proof Coin (Random Year) - .9999 Fine Gold','coin','gold',1)
  and not exists(select from private.tax_versions later where (later.state,later.kind,later.subject)=(v.state,v.kind,v.subject) and later.id>v.id);

-- Keep the reviewed examples independent of stock, catalog edits and new
-- listings. These dated specifications document the bullion classes actually
-- reviewed. Each sold item is still verified from its own order evidence.
create table private.tax_bullion_review_examples (
 sku text primary key, subject text, title text, metal text check(metal in ('gold','silver')), weight numeric
);
revoke all on private.tax_bullion_review_examples from public,anon,authenticated;
insert into private.tax_bullion_review_examples(sku,subject,title,metal,weight)
select e.sku,v.subject,v.data->>'catalog_name',v.data->>'metal',(v.data->>'catalog_weight')::numeric
from (values ('AGE-1OZ-BU-RY'),('GOTS-GBP-1OZ-RY-001'),('MAPLE-1OZ-BU-RY'),('SML-1OZ-BU-RY'),
 ('APMEX-1OZ-TEP'),('GOTS-834790'),('PAMP-1OZ-FORTUNA-ASSAY'),('RAND-0033')) e(sku)
left join lateral (
 select r.subject,r.data from private.tax_versions r
 where r.state='NY' and r.kind='product' and r.data->>'origin'='catalog_policy_release_2026_11_26'
 and r.data->>'catalog_sku'=e.sku and r.approval='approved' and r.verified_on<=date '2026-11-27'
 order by r.id limit 1
) v on true;

-- Resolve only the eight matched investment listings. Each row describes product
-- eligibility. Its price, the seller's collection duty and destination-specific
-- local treatment are determined independently for the actual transaction.
with authorities(state,scope,treatment,source) as (values
 ('AL','bars','eligible','https://alison.legislature.state.al.us/code-of-alabama?section=40-23-4'),
 ('IN','all','eligible','https://www.in.gov/dor/files/sib50.pdf'),
 ('ID','bars','eligible','https://legislature.idaho.gov/statutesrules/idstat/Title63/T63CH36/SECT63-3622V/'),
 ('LA','bars','eligible','https://dam.ldr.la.gov/miscellaneous/Chart%20of%20Active%20Sales%20and%20Use%20Tax%20Exemptions%2024%203ES%20and%2025%20RS.pdf'),
 ('MS','coins','eligible','https://www.legislature.ms.gov/media/1323/2023_summary_final.pdf'),
 ('ME','coins','taxable','https://www.mainelegislature.org/legis/statutes/36/title36sec1811.html'),
 ('NM','coins','taxable','https://www.tax.newmexico.gov/businesses/gross-receipts-overview/'),
 ('ND','bars','eligible','https://www.tax.nd.gov/sites/www/files/documents/guidelines/business/sales-use/guideline-exemptions.pdf'),
 ('NC','bars','eligible','https://www.ncdor.gov/sutb-2026pdf/open'),
 ('OH','bars','eligible','https://codes.ohio.gov/ohio-revised-code/section-5739.02'),
 ('OK','bars','eligible','https://oklahoma.gov/content/dam/ok/en/omes/documents/iec-schedule-2026-2029.pdf'),
 ('RI','all','eligible','https://webserver.rilegislature.gov/Statutes/title44/44-18/44-18-30.htm'),
 ('UT','bars','eligible','https://le.utah.gov/xcode/Title59/Chapter12/59-12-S104.html?v=C59-12-S104_2026050620260701'),
 ('MI','coins','eligible','https://www.legislature.mi.gov/Laws/MCL?objectName=MCL-205-54S'),
 ('MO','coins','eligible','https://revisor.mo.gov/main/OneSection.aspx?section=144.815'),
 ('NC','coins','eligible','https://www.ncdor.gov/sutb-2026pdf/open'),
 ('PA','coins','eligible','https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1971/0/0002..HTM'),
 ('WV','coins','eligible','https://code.wvlegislature.gov/11-15-9r/'),
 ('FL','canadian_coins','eligible','https://flrules.org/Gateway/View_notice.asp?id=30313002'),
 ('CA','all','eligible','https://cdtfa.ca.gov/lawguides/vol1/sutr/1599.html'),
 ('DC','coins','taxable','https://code.dccouncil.gov/us/dc/council/code/sections/47-2002'),
 ('HI','coins','taxable','https://tax.hawaii.gov/get/'),
 ('KY','coins','eligible','https://apps.legislature.ky.gov/AgencyReports/IJC/AR/OSBD/TEA/2026%20to%202028.pdf'),
 ('LA','standard_coins','eligible','https://www.legis.la.gov/Legis/Law.aspx?d=101815'),
 ('LA','proof','eligible','https://www.legis.la.gov/Legis/Law.aspx?d=101815'),
 ('NJ','proof','eligible','https://www.nj.gov/treasury/taxation/businesses/salestax/investbullion-coins.shtml'),
 ('OK','standard_coins','eligible','https://oklahoma.gov/content/dam/ok/en/omes/documents/iec-schedule-2026-2029.pdf'),
 ('NV','coins','eligible','https://www.leg.state.nv.us/NAC/NAC-372.html'),
 ('NV','bars','taxable','https://tax.nv.gov/wp-content/uploads/2024/07/Nevada-Tax-Notes-200-July-2024.pdf'),
 ('VT','coins','taxable','https://tax.vermont.gov/sites/tax/files/documents/SU%20Regs%20Effective%201%201%2019.pdf'),
 ('AR','coins','eligible','https://webftp.blr.arkansas.gov/Home/FTPDocument?path=ACTS%2F2021R%2FPublic%2FACT1109.pdf'),
 ('CT','standard_bullion','eligible','https://prdext3.cga.ct.gov/2026/sup/chap_219.htm'),
 ('GA','all','eligible','https://rules.sos.ga.gov/gac/560-12-2'),
 ('IL','bars','eligible','https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxinformation/sales/documents/pio-101-illinois-tax-matrix.pdf'),
 ('MA','all','eligible','https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64H/Section6'),
 ('MD','all','eligible','https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gtg&section=11-214.1'),
 ('MI','bars','eligible','https://www.legislature.mi.gov/Laws/MCL?objectName=MCL-205-54S'),
 ('MN','bars','eligible','https://www.revenue.state.mn.us/guide/nontaxable-sales-11'),
 ('MO','bars','eligible','https://revisor.mo.gov/main/OneSection.aspx?section=144.815'),
 ('NJ','bars','eligible','https://www.nj.gov/treasury/taxation/businesses/salestax/investbullion-coins.shtml'),
 ('PA','bars','eligible','https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/news-and-statistics/reportsstats/tax-expenditures/2026-27_tax_expenditures.pdf'),
 ('TN','all','eligible','https://revenue.support.tn.gov/hc/en-us/articles/360058685571-SUT-121-Bullion-or-Precious-Metal-Coins'),
 ('VA','all','eligible','https://budget.lis.virginia.gov/item/2026/2/HB30/Chapter/3/3-5.22/'),
 ('WI','all','eligible','https://www.revenue.wi.gov/WisconsinTaxBulletin/229-04-30-WTB.pdf'),
 ('WV','bars','eligible','https://tax.wv.gov/Documents/AdministrativeNotices/2019/AdministrativeNotice.2019-20.pdf'),
 ('WY','bars','eligible','https://wyoleg.gov/statutes/compress/title09.pdf')
), listings as (
 select e.subject as id,e.sku,v.rule from private.tax_bullion_review_examples e
 cross join lateral (select private.tax_report_version('NY','product',e.subject,'2026-11-26') as rule) v
 where v.rule->>'approval'='approved' and v.rule->>'origin'='catalog_policy_release_2026_11_26'
 and (e.sku,e.title,e.metal,e.weight)=(v.rule->>'catalog_sku',v.rule->>'catalog_name',v.rule->>'metal',(v.rule->>'catalog_weight')::numeric)
)
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,a.state,'product',p.id::text,jsonb_build_object('origin','catalog_policy_release_2026_11_26','catalog_sku',p.sku,
 'catalog_name',p.rule->>'catalog_name','metal',p.rule->>'metal','catalog_weight',p.rule->'catalog_weight',
 'form',p.rule->>'form','treatment',a.treatment)
 || case when a.state in ('GA','MI','MO','NC','PA','WV','FL','NV') and p.rule->>'form'='coin' then jsonb_build_object(
 'issuing_country',case when p.sku in ('MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY') then 'CA' else 'US' end,
 'denomination_currency',case when p.sku in ('MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY') then 'CAD' else 'USD' end,
 'denomination_cents',case when p.sku='SML-1OZ-BU-RY' then 500 else 5000 end) else '{}'::jsonb end
 || case when a.state in ('MI','MO','NC','PA','WV') and p.rule->>'form'='coin'
   then jsonb_build_object('value_test','fair_market_above_face') else '{}'::jsonb end
 || case when a.state='NV' and a.scope='coins' then jsonb_build_object('value_test','nv_coin_face_premium') else '{}'::jsonb end
 || case when a.state='VT' and a.scope='coins' then jsonb_build_object('scope','retail_investment_or_collectible',
   'presumption_source','https://legislature.vermont.gov/statutes/section/32/233/09813') else '{}'::jsonb end
 || case when a.state='LA' and a.scope='proof' then jsonb_build_object('value_test','la_online_numismatic') else '{}'::jsonb end
 || case when a.state='FL' then jsonb_build_object('value_test','fl_foreign_coin_group') else '{}'::jsonb end
 || case when a.state='OH' and p.rule->>'form'='bar' then jsonb_build_object('fineness_source',
   'https://www.cmegroup.com/markets/metals/precious/gold/specs') else '{}'::jsonb end
 || case when a.state in ('MN','WI','WY') and p.rule->>'form'='bar' then jsonb_build_object(
 'marking_evidence',case p.sku when 'APMEX-1OZ-TEP' then 'https://www.apmexpro.com/products/details/1-oz-gold-bar-apmex-tep'
 when 'PAMP-1OZ-FORTUNA-ASSAY' then 'https://www.apmex.com/resources/ProductSpecifications/1-oz-gold-bar-pamp-suisse-lady-fortuna-veriscan-in-assay-82236.pdf'
 else 'Merchant listing guarantees weight and purity markings for this SKU (2026-11-26).' end) else '{}'::jsonb end,
 a.source,date '2026-11-26',case when a.state='FL' then date '2026-12-07' else date '2026-12-31' end,date '2026-11-26','approved'
from listings p cross join authorities a where
 (a.scope='all' or a.scope='canadian_coins' and p.sku in ('MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY') or a.scope='coins' and p.rule->>'form'='coin' or a.scope='bars' and p.rule->>'form'='bar'
 or a.scope='proof' and p.sku='GOTS-GBP-1OZ-RY-001'
 or a.scope='standard_coins' and p.rule->>'form'='coin' and p.sku<>'GOTS-GBP-1OZ-RY-001'
 or a.scope='standard_bullion' and p.sku<>'GOTS-GBP-1OZ-RY-001')
 and not exists(select from private.tax_versions v where (v.state,v.kind,v.subject)=(a.state,'product',p.id::text));


-- A basket of entirely exempt merchandise can have zero customer sales tax
-- regardless of registration. This decision cannot clear independently priced fees.
with authorities(state,source) as (values
 ('VA','https://budget.lis.virginia.gov/item/2026/2/HB30/Chapter/3/3-5.22/'),
 ('WY','https://wyoleg.gov/statutes/compress/title09.pdf')
)
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'collection_basis','reviewed_exempt_items','first_eligible_cent',0,'store_minimum',false),
 source,date '2026-11-26',date '2026-12-31',date '2026-11-26','approved' from authorities a
where not exists(select from private.tax_versions v where v.state=a.state and v.kind='policy' and v.subject='state');

-- Direct, nonregistered sellers can use the conservative whole-store upper bound.
-- Connecticut requires both tests. Arkansas requires more than 200 transactions.
with authorities(state,first_cent,first_count,requires_both,minimum,source) as (values
 ('AR',10000001,201,false,0,'https://www.arkleg.state.ar.us/Home/FTPDocument?path=/ACTS/2019R/Public/ACT822.pdf'),
 ('CT',10000000,200,true,100000,'https://prdext3.cga.ct.gov/2026/sup/chap_219.htm'),
 ('MA',10000001,null,false,100000,'https://www.mass.gov/regulations/830-CMR-64h19-remote-retailers-and-marketplace-facilitators')
)
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,a.state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'remote_basis','below_remote_threshold','merchant_footprint_as_of','2026-11-26','first_eligible_cent',minimum,
 'store_minimum',minimum>0,'revenue_trigger_cents',first_cent,'transaction_trigger',first_count,'requires_both',requires_both),
 a.source,date '2026-11-26',date '2026-12-31',date '2026-11-26','approved'
from authorities a where not exists(select from private.tax_versions v where v.state=a.state and v.kind='policy' and v.subject='state');

-- A reviewed fact belongs to one order and SKU. Product identity, special terms
-- and locked prices are fingerprinted. Editing any of them invalidates the fact.
create table private.tax_item_facts(
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders on delete cascade, product_id bigint not null,
 state text not null references private.tax_states, fingerprint text not null, basis text not null,
 document_id uuid not null references private.tax_documents, actor uuid not null,
 fmv_cents bigint check(fmv_cents>0), created_at timestamptz not null default now()
);
alter table private.tax_item_facts enable row level security;
revoke all on private.tax_item_facts from public,anon,authenticated;
create index tax_item_fact_lookup on private.tax_item_facts(order_id,product_id,id desc);
create function private.tax_order_fact_hash(o public.orders) returns text stable language sql set search_path='' as $$
 select md5(jsonb_build_array(o.created_at,o.shipping_address,o.customer_notes,o.subtotal,o.shipping_amount,o.payment_surcharge,
    (select jsonb_agg(v order by v) from (select jsonb_build_array(i.product_id,i.sku,i.product_name,i.metal,
      i.metal_weight_oz,i.quantity,i.unit_price,i.line_total,i.pricing_snapshot) v from public.order_items i where i.order_id=o.id) x))::text)
$$;
revoke all on function private.tax_order_fact_hash(public.orders) from public,anon,authenticated;

create function public.tax_record_item_fact(p_actor uuid,p_state text,p_order bigint,p_product bigint,p_basis text,p_document uuid,p_fmv bigint)
returns void security definer language plpgsql set search_path='' as $$
declare o public.orders; rule jsonb; fact_id bigint; sale_day date; kind text;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 select x.* into strict o from public.orders x,private.tax_report_start start_at where x.id=p_order and x.created_at>=start_at.starts_at for update of x;
 sale_day:=(o.created_at at time zone 'America/New_York')::date;
 if private.tax_admin_state(coalesce(o.shipping_address#>>'{address,state}',o.shipping_address->>'state')) is distinct from p_state
   or not exists(select from private.tax_documents where id=p_document and state=p_state)
   or (select count(*) from public.order_items where order_id=p_order and product_id=p_product)<>1 then raise exception 'Order or evidence mismatch';end if;
 rule:=private.tax_report_version(p_state,'product',p_product::text,sale_day);
 kind:=rule->>'value_test';
 if not coalesce(case kind
  when 'az_monetized_sale' then p_basis in ('ordinary_coin_sale','jewelry_or_art_manufacture')
  when 'az_bullion_content' then p_basis in ('metal_pricing','form_pricing')
  when 'id_monetized_sale' then p_basis in ('ordinary_coin_sale','jewelry_or_art_manufacture')
  when 'al_metal_pricing' then p_basis in ('metal_pricing','numismatic_pricing')
  when 'ct_proof_coin' then p_basis in ('metal_pricing','rare_or_antique','ordinary_collectible')
  when 'ok_proof_coin' then p_basis in ('metal_pricing','investment_sale','noninvestment_collectible')
  when 'nj_coin_alternatives' then p_basis in ('metal_pricing','numismatic_pricing')
  when 'sovereign_commodity_bar' then p_basis in ('sovereign_use_metal_price','sovereign_use_collectible_price','no_qualifying_sovereign_use','form_pricing')
 end,false) or ((kind='nj_coin_alternatives' and p_basis='numismatic_pricing')<>(p_fmv is not null))
 or p_fmv is not null and p_fmv not between 1 and 9007199254740991 then raise exception 'Invalid sale evidence';end if;
 insert into private.tax_item_facts(order_id,product_id,state,fingerprint,basis,document_id,actor,fmv_cents)
 values(p_order,p_product,p_state,private.tax_order_fact_hash(o),p_basis,p_document,p_actor,p_fmv) returning id into fact_id;
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'order_product_evidence',p_state,jsonb_build_object('order_id',p_order,'product_id',p_product,'fact_id',fact_id));
end $$;
revoke all on function public.tax_record_item_fact(uuid,text,bigint,bigint,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.tax_record_item_fact(uuid,text,bigint,bigint,text,uuid,bigint) to service_role;

-- Only the actual seller can substantiate affiliate/related-party sales.
-- Each observation covers both calendar periods and is dated through a sale day.
create table private.tax_related_receipts(
 id bigint generated always as identity primary key,state text not null check(state in ('AZ','CA')),
 through_day date not null, prior_cents bigint not null check(prior_cents>=0),
 current_cents bigint not null check(current_cents>=0),document_id uuid not null references private.tax_documents,
 actor uuid not null, commodity_status text check(commodity_status in ('registered','registration_not_required','required_unregistered')),
 created_at timestamptz not null default now()
);
create index tax_related_day on private.tax_related_receipts(state,through_day,id desc);
alter table private.tax_related_receipts enable row level security;
revoke all on private.tax_related_receipts from public,anon,authenticated;
create function public.tax_record_related_receipts(p_actor uuid,p_state text,p_day date,p_prior bigint,p_current bigint,p_document uuid,p_commodity text)
returns void security definer language plpgsql set search_path='' as $$
declare fact_id bigint;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 if p_day is null or p_day>(now() at time zone 'America/New_York')::date or p_state not in ('AZ','CA')
 or p_prior not between 0 and 9007199254740991 or p_current not between 0 and 9007199254740991
 or (p_state='AZ' and p_commodity is not null) or not exists(select from private.tax_documents where id=p_document and state=p_state)
 then raise exception 'Invalid related-party evidence';end if;
 insert into private.tax_related_receipts(state,through_day,prior_cents,current_cents,document_id,actor,commodity_status)
 values(p_state,p_day,p_prior,p_current,p_document,p_actor,p_commodity) returning id into fact_id;
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'related_receipts',p_state,jsonb_build_object('fact_id',fact_id,'day',p_day));
 update private.tax_revision set revision=revision+1;
end $$;
revoke all on function public.tax_record_related_receipts(uuid,text,date,bigint,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.tax_record_related_receipts(uuid,text,date,bigint,bigint,uuid,text) to service_role;

alter table private.tax_versions drop constraint tax_version_origin;
alter table private.tax_versions add constraint tax_version_origin check (
 actor is not null or coalesce(data->>'origin' in ('catalog_policy_release_2026_11_26','wa_remote_sales_2026_11_26','catalog_sale_conditions_2026_11_27'),false)
);
create or replace function private.tax_report_input_hash(o public.orders) returns text stable language sql set search_path='' as $$
 select md5(jsonb_build_array(private.tax_order_fact_hash(o),o.paid_at,o.insurance_amount,o.tax_amount,o.total,o.tax_assessment_id,
    (select max(id) from private.tax_item_facts where order_id=o.id),
    (select max(id) from private.tax_related_receipts where state=private.tax_admin_state(coalesce(o.shipping_address#>>'{address,state}',o.shipping_address->>'state'))
     and through_day=(o.created_at at time zone 'America/New_York')::date))::text)
$$;
revoke all on function private.tax_report_input_hash(public.orders) from public,anon,authenticated;

-- An approved classification can have transaction conditions. Keep the actual
-- order in review whenever the required evidence cannot be established.
with authorities(state,scope,condition,source) as (values
 ('AZ','coins','az_monetized_sale','https://www.azleg.gov/ars/42/05061.htm'),
 ('AZ','bars','az_bullion_content','https://www.azleg.gov/ars/42/05061.htm'),
 ('ID','coins','id_monetized_sale','https://tax.idaho.gov/taxes/sales-use/exemptions/types-of-exemptions/'),
 ('AL','coins','al_metal_pricing','https://alison.legislature.state.al.us/code-of-alabama?section=40-23-4'),
 ('CT','proof','ct_proof_coin','https://prdext3.cga.ct.gov/2026/sup/chap_219.htm'),
 ('OK','proof','ok_proof_coin','https://oklahoma.gov/content/dam/ok/en/omes/documents/iec-schedule-2026-2029.pdf'),
 ('NJ','coins','nj_coin_alternatives','https://www.nj.gov/treasury/taxation/businesses/salestax/investbullion-coins.shtml'),
 ('AR','bars','sovereign_commodity_bar','https://webftp.blr.arkansas.gov/Home/FTPDocument?path=ACTS%2F2021R%2FPublic%2FACT1109.pdf'),
 ('KY','bars','sovereign_commodity_bar','https://osbd.ky.gov/Publications/Documents/Special%20Reports/Tax%20Expenditure%20Analysis%20Fiscal%20Years%202026-2028.pdf'),
 ('MS','bars','sovereign_commodity_bar','https://billstatus.ls.state.ms.us/documents/2023/html/SB/2800-2899/SB2862SG.htm')
), listings as (
 select e.subject as id,e.sku,e.title as name,e.metal,e.weight as metal_weight_oz,
   private.tax_report_version('NY','product',e.subject,date '2026-11-27') spec from private.tax_bullion_review_examples e
)
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,a.state,'product',p.id::text,jsonb_build_object('origin','catalog_sale_conditions_2026_11_27',
 'catalog_sku',p.sku,'catalog_name',p.name,'metal',p.metal::text,'catalog_weight',p.metal_weight_oz,
 'form',p.spec->>'form','treatment','eligible','value_test',a.condition) ||
 case when a.state='AZ' then jsonb_build_object('authority_sources',jsonb_build_array('https://www.azleg.gov/ars/42/06017.htm',
   'https://www.azleg.gov/ars/42/06102.htm','https://www.azleg.gov/ars/42/06103.htm','https://www.azleg.gov/ars/42/05159.htm'))
 else '{}'::jsonb end,a.source,
 date '2026-11-27',date '2026-12-31',date '2026-11-27','approved'
from listings p cross join authorities a where p.spec->>'origin'='catalog_policy_release_2026_11_26'
 and p.spec->>'approval'='approved' and (p.sku,p.name,p.metal::text,p.metal_weight_oz)=
 (p.spec->>'catalog_sku',p.spec->>'catalog_name',p.spec->>'metal',(p.spec->>'catalog_weight')::numeric)
 and ((a.scope='coins' and p.spec->>'form'='coin') or (a.scope='bars' and p.spec->>'form'='bar')
   or (a.scope='proof' and p.sku='GOTS-GBP-1OZ-RY-001'));

with authorities(state,trigger,minimum,source) as (values
 ('ID',10000001,0,'https://legislature.idaho.gov/statutesrules/idstat/Title63/T63CH36/SECT63-3611/'),
 ('CA',50000001,200000,'https://cdtfa.ca.gov/lawguides/vol1/sutl/6203.html'),
 ('AZ',10000001,0,'https://www.azleg.gov/ars/42/05044.htm')
)
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'remote_basis','below_remote_threshold','first_eligible_cent',minimum,'store_minimum',minimum>0,
 'revenue_trigger_cents',trigger,'merchant_footprint_as_of','2026-11-26'),source,
 date '2026-11-27',date '2026-12-31',date '2026-11-27','approved' from authorities;

-- The Commission's obligation only covers its member jurisdictions. Never
-- select this policy as Alaska's statewide collection policy.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
values (true,'AK','policy','arsstc_member',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'scope','arsstc_member','remote_basis','below_remote_threshold','revenue_trigger_cents',10000000),
 'https://arsstc.org/about/code/',date '2026-11-27',date '2026-12-31',date '2026-11-27','approved');

-- Preserve verified state-law scope independently of municipal coverage. Such
-- records do not satisfy the nationwide product or collection release gate.
with states(state,scope,source) as (values
 ('AK','no_state_general_sales_tax','https://www.commerce.alaska.gov/web/dcra/OfficeoftheStateAssessor/AlaskaSalesTaxInformation.aspx'),
 ('MT','no_state_general_sales_tax','https://revenue.mt.gov/taxes/miscellaneous/local-resort-tax'),
 ('CO','state_administered_bullion_exemption','https://tax.colorado.gov/sales-use-tax-topics-coins-and-precious-metal-bullion')
), listings as (
 select e.subject as id,e.sku,e.title as name,e.metal,e.weight as metal_weight_oz,
   private.tax_report_version('NY','product',e.subject,date '2026-11-27') spec from private.tax_bullion_review_examples e
)
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,s.state,'product',p.id::text,jsonb_build_object('origin','catalog_sale_conditions_2026_11_27',
 'catalog_sku',p.sku,'catalog_name',p.name,'metal',p.metal::text,'catalog_weight',p.metal_weight_oz,
 'form',p.spec->>'form','coverage_scope','state_only','state_treatment',s.scope),
 s.source,date '2026-11-27',date '2026-12-31',date '2026-11-27','requires_review'
from listings p cross join states s where p.spec->>'origin'='catalog_policy_release_2026_11_26'
 and p.spec->>'approval'='approved' and (p.sku,p.name,p.metal::text,p.metal_weight_oz)=
 (p.spec->>'catalog_sku',p.spec->>'catalog_name',p.spec->>'metal',(p.spec->>'catalog_weight')::numeric);

create function private.tax_state_scope(s text,product bigint,d date) returns jsonb stable language sql set search_path='' as $$
 select data || jsonb_build_object('version',v.id,'source',v.source,'verified_on',v.verified_on,'valid_from',v.valid_from,'valid_until',v.valid_until)
 from private.tax_versions v left join private.tax_sources src on src.url=v.source
 where v.id=(private.tax_report_version(s,'product',product::text,d)->>'version')::bigint
 and v.data->>'origin'='catalog_sale_conditions_2026_11_27' and v.data->>'coverage_scope'='state_only'
 and d between v.valid_from and v.valid_until and v.verified_on<=d and (src.changed_at is null or src.changed_at<=v.created_at)
$$;
revoke all on function private.tax_state_scope(text,bigint,date) from public,anon,authenticated;

create function private.tax_order_state_scope(o public.orders,s text,d date) returns jsonb stable language sql set search_path='' as $$
 with lines as (
   select i.product_id,i.sku,i.product_name,i.metal::text as metal,i.metal_weight_oz,
     private.tax_state_scope(s,i.product_id,d) as v from public.order_items i where i.order_id=o.id
 )
 select case when count(*)>0 and bool_and(v is not null and (sku,product_name,metal,metal_weight_oz)
    is not distinct from (v->>'catalog_sku',v->>'catalog_name',v->>'metal',(v->>'catalog_weight')::numeric)) then
   jsonb_build_object('scope',min(v->>'state_treatment'),'source',min(v->>'source'),'verified_on',min(v->>'verified_on'),
     'versions',jsonb_agg(jsonb_build_object('product_id',product_id,'version',v->'version') order by product_id)) end
 from lines
$$;
revoke all on function private.tax_order_state_scope(public.orders,text,date) from public,anon,authenticated;

create function private.tax_remote_order_bound(s text,p jsonb,q jsonb,d date,placed_order bigint) returns jsonb
stable language plpgsql set search_path='' as $$
declare profile private.tax_states; proposed numeric; receipts numeric; transactions bigint; unknown_amount boolean; related private.tax_related_receipts;
 prior_year numeric; current_year numeric; uncertain_year numeric;
begin
 if p->>'collection_basis'='reviewed_exempt_items' then
   if s in ('VA','WY') and p->>'state'=s and p->>'origin'='catalog_policy_release_2026_11_26'
      and p->>'approval'='approved' and p->>'shipping_disabled'='false' and (p->>'verified_on')::date<=d
      and d between (p->>'valid_from')::date and (p->>'valid_until')::date
      and exists(select from private.tax_states t where t.state=s and not t.disabled) then
     return p||jsonb_build_object('collection','exempt_merchandise');
   end if;
   return p||jsonb_build_object('collection','review');
 end if;
 if p->>'remote_basis' is distinct from 'below_remote_threshold' then return p; end if;
 -- This policy only establishes noncollection. An active or pending registration
 -- requires the state's separately reviewed collection, sourcing and fee rules.
 p:=p||jsonb_build_object('collection','review');
 select * into strict profile from private.tax_states where state=s;
 if (s='AK' and (p->>'scope' is distinct from 'arsstc_member' or placed_order is null))
   or s not in ('AK','DC','HI','ME','VT','SD','IA','KS','NE','IN','WI','SC','NC','GA','LA','MD','MN','MO','MS','ND','NJ','NV','OH','PA','TN','UT','WV','IL','KY','OK','TX','AR','CT','MA','ID','AZ','CA') or p->>'state' is distinct from s
   or p->>'origin' is distinct from 'catalog_policy_release_2026_11_26' or p->>'approval' is distinct from 'approved'
   or not coalesce(d between (p->>'valid_from')::date and (p->>'valid_until')::date,false)
   or not coalesce((p->>'revenue_trigger_cents')::bigint>0,false)
   or not coalesce(d between date '2026-11-26' and date '2026-12-31',false)
   or not coalesce((p->>'verified_on')::date<=d,false)
   or profile.disabled or profile.physical or profile.registration not in ('Not Registered','No Current Obligation')
   or profile.collect_from is not null or profile.effective is not null or profile.active_confirmed_on is not null
   or profile.registration_due is not null then return p; end if;
 if s in ('CA','AZ') then
   select * into related from private.tax_related_receipts where state=s and through_day=d order by id desc limit 1;
   if not found then return p||jsonb_build_object('review_reason','Related-party receipts are unverified for this date.'); end if;
   p:=p||jsonb_build_object('related_receipts_version',related.id,'related_receipts_document',related.document_id,
     'ca_commodity_registration',related.commodity_status);
 end if;
 if placed_order is not null then
   if not exists(select from public.orders o where o.id=placed_order and
     private.tax_admin_state(coalesce(o.shipping_address#>>'{address,state}',o.shipping_address->>'state'))=s and
     coalesce(o.shipping_address->>'fulfillment','delivery')<>'pickup' and
     (o.created_at at time zone 'America/New_York')::date=d) then return p; end if;
   -- The placed order is already in the ledger of website receipts below.
   proposed:=0;
 elsif not coalesce((q->>'subtotal')::numeric>0 and (q->>'shipping_amount')::numeric>=0 and (q->>'card_surcharge')::numeric>=0,false)
   then return p;
 else proposed:=ceil(100*((q->>'subtotal')::numeric+(q->>'shipping_amount')::numeric
   +greatest((q->>'card_surcharge')::numeric,round((q->>'subtotal')::numeric*0.02,2)))); end if;
 if exists(select from private.tax_ledger where state=s and kind='sale' and order_id is null) then return p; end if;
 -- Pending wires and refunded orders count toward this upper bound. Ambiguous
 -- destinations also count. A threshold hit prompts review of actual period receipts.
 with website as (
   select case when o.shipping_address ? 'address' and nullif(o.shipping_address->>'state','') is not null
     and upper(trim(o.shipping_address->>'state')) is distinct from upper(trim(o.shipping_address#>>'{address,state}'))
     then '' else upper(trim(coalesce(o.shipping_address#>>'{address,state}',o.shipping_address->>'state',''))) end as destination,
     case when o.total>=0 then greatest(o.total,o.subtotal+coalesce(o.payment_surcharge,0)+coalesce(o.shipping_amount,0)+coalesce(o.insurance_amount,0)) end as amount,(o.created_at at time zone 'America/New_York')::date opened,
     (o.paid_at at time zone 'America/New_York')::date settled from public.orders o
   where coalesce(o.shipping_address->>'fulfillment','delivery')<>'pickup'
 )
 select coalesce(sum(ceil(100*amount)),0),count(*),coalesce(bool_or(amount is null or amount<0),false),
   coalesce(sum(ceil(100*amount)) filter(where extract(year from opened)=extract(year from d)-1 or extract(year from settled)=extract(year from d)-1),0),
   coalesce(sum(ceil(100*amount)) filter(where extract(year from opened)=extract(year from d) or extract(year from settled)=extract(year from d)),0),
   coalesce(sum(ceil(100*amount)) filter(where opened is null),0)
 into receipts,transactions,unknown_amount,prior_year,current_year,uncertain_year from website w
 where w.destination=s or not exists(select from private.tax_states t where t.state=w.destination);
 -- Across a year boundary, opening and payment dates can differ. Including the
 -- receipt in both years is conservative. Compare separate annual totals.
 if s in ('ID','AZ','CA') then
   prior_year:=prior_year+uncertain_year+coalesce(related.prior_cents,0);
   current_year:=current_year+uncertain_year+coalesce(related.current_cents,0)+proposed;
   receipts:=greatest(prior_year,current_year); proposed:=0;
   p:=p||jsonb_build_object('prior_year_upper_bound_cents',prior_year,'current_year_upper_bound_cents',current_year);
 end if;
 if placed_order is null then transactions:=transactions+1; end if;
 p:=p||jsonb_build_object('receipts_upper_bound_cents',receipts+proposed,'transactions_upper_bound',transactions);
 if unknown_amount then return p; end if;
 if s='CT' then
   if receipts+proposed>=(p->>'revenue_trigger_cents')::bigint and transactions>=(p->>'transaction_trigger')::integer then return p; end if;
 elsif receipts+proposed>=(p->>'revenue_trigger_cents')::bigint or
     transactions>=(p->>'transaction_trigger')::integer then return p; end if;
 return p||jsonb_build_object('collection','no_obligation');
end $$;
revoke all on function private.tax_remote_order_bound(text,jsonb,jsonb,date,bigint) from public,anon,authenticated;
update private.tax_revision set revision=revision+1;

-- A read-only screen for direct website activity. It never authorizes collection.
create function private.tax_website_activity(asof_day date, period_from date, period_to date)
returns table(state text,period_orders bigint,period_receipts bigint,review_message text,source text)
language sql stable set search_path='' as $$
 with rules(s,window_type,first_cent,first_count,url) as (values
 ('AL','prior_year',25000001,null,'https://www.revenue.alabama.gov/faqs/are-all-remote-sellers-required-to-register-in-alabama/'),
 ('AK','years',10000000,null,'https://arsstc.org/wp-content/uploads/2025/01/2023.02-Economic-Nexus_Account-closures_Jan-2025-revision.pdf'),
 ('GA','years',10000001,200,'https://dor.georgia.gov/document/document-sut-pb/sut-2019-02/download'),
 ('IA','years',10000000,null,'https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax/remote-sellers-marketplace-facilitators'),
 ('KS','years',10000001,null,'https://www.ksrevenue.gov/pub1510.html'),
 ('MI','prior_year',10000001,200,'https://www.michigan.gov/taxes/business-taxes/sales-use-tax/information/remote-seller-faq'),
 ('RI','prior_year',10000000,200,'https://webserver.rilegislature.gov/statutes/title44/44-18.2/44-18.2-3.HTM'),
 ('MO','prior_quarters',10000001,null,'https://dor.mo.gov/faq/taxation/business/remote-seller-and-marketplace-facilitator.html'),
 ('NC','years',10000001,null,'https://www.ncdor.gov/taxes-forms/sales-and-use-tax/other-sales-and-use-tax-resources/remote-sales'),
 ('NE','years',10000001,200,'https://revenue.nebraska.gov/about/frequently-asked-questions/remote-seller-and-marketplace-facilitator-faqs'),
 ('NV','years',10000001,200,'https://tax.nv.gov/faqs/marketplace-facilitator-seller-faqs/remote-sellers-wayfair-decision/'),
 ('OH','years',10000001,200,'https://tax.ohio.gov/business/sales-and-use-tax/sales-and-use-tax'),
 ('OK','years',10000000,null,'https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/rules-and-policies/letter-rulings/2026/LR-26-018.pdf'),
 ('SC','years',10000001,null,'https://www.dor.sc.gov/sales-use-tax-index/sales-tax/remote-sellers'),
 ('VA','years',10000001,200,'https://www.tax.virginia.gov/remote-sellers-marketplace-facilitators-economic-nexus'),
 ('AZ','years',10000001,null,'https://azdor.gov/business/transaction-privilege-tax/retail-sales-subject-tpt/out-state-sellers/economic-threshold'),
 ('IN','years',10000001,null,'https://www.in.gov/dor/i-am-a/business-corp/remote-sellers/'),
 ('ID','years',10000001,null,'https://tax.idaho.gov/taxes/sales-use/guides-for-certain-groups/online-sellers/business-types/'),
 ('UT','years',10000001,null,'https://tax.utah.gov/business/sales-tax/other-sales-tax/out-of-state-remote-sellers/'),
 ('WI','years',10000001,null,'https://www.revenue.wi.gov/pages/faqs/pcs-sales.aspx'),
 ('WA','years',10000001,null::int,'https://dor.wa.gov/taxes-rates/retail-sales-tax/marketplace-fairness-leveling-playing-field/remote-sellers'),
 ('HI','years',10000000,200,'https://data.capitol.hawaii.gov/hrscurrent/Vol04_Ch0201-0257/HRS0237/HRS_0237-0002_0005.htm'),
 ('DC','years',10000001,201,'https://otr.cfo.dc.gov/page/sales-and-use-tax-faqs'),
 ('ME','years',10000001,null,'https://legislature.maine.gov/statutes/36/title36sec1754-B.html'),
 ('CA','years',50000001,null,'https://cdtfa.ca.gov/industry/wayfair/'),
 ('NM','prior_year',10000000,null,'https://www.tax.newmexico.gov/businesses/determining-nexus/'),
 ('FL','prior_year',10000001,null,'https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx'),
 ('VT','prior_months',10000000,200,'https://legislature.vermont.gov/statutes/section/32/233/09701')
 ), bounds as (select date_trunc('year',asof_day)::date as yr,date_trunc('month',asof_day)::date as mo),
 sales as materialized (
  select case when o.shipping_address->>'fulfillment'='pickup' then 'NY' else upper(trim(o.shipping_address->>'state')) end as destination,
   (coalesce(o.paid_at,o.created_at) at time zone 'America/New_York')::date as day,
   ((o.total-coalesce(o.tax_amount,0))*100)::bigint as receipts
  from public.orders o where o.payment_status in ('paid','refunded')
 ), windows as (
  select s,first_cent,first_count,url,daterange(yr,asof_day+1) as span,window_type='prior_year' as next_year from rules,bounds where window_type in ('years','prior_year')
  union all select s,first_cent,first_count,url,daterange((yr-interval '1 year')::date,yr),false from rules,bounds where window_type in ('years','prior_year')
  union all select s,first_cent,first_count,url,daterange((mo-interval '12 months')::date,mo),false from rules,bounds where window_type='prior_months'
  union all select s,first_cent,first_count,url,daterange((date_trunc('quarter',asof_day)-interval '12 months')::date,date_trunc('quarter',asof_day)::date),false from rules where window_type='prior_quarters'
 ), screen as (
  select w.s,w.url,w.span,w.next_year, count(sales.day) as n,coalesce(sum(receipts),0) as gross,w.first_cent,w.first_count
  from windows w left join sales on sales.destination=w.s and sales.day <@ w.span
  group by w.s,w.url,w.span,w.next_year,w.first_cent,w.first_count
 ), hits as (
  select s,max(url) as url,bool_or(gross>=first_cent or n>=coalesce(first_count,2147483647)) filter(where not next_year) as hit,
   bool_or(gross*10>=first_cent*8::bigint or (first_count is not null and n*10>=first_count*8)) filter(where not next_year) as near_limit,
   bool_or(gross>=first_cent or n>=first_count) filter(where next_year) as next_year_hit,
   bool_or(gross*10>=first_cent*8::bigint or n*10>=first_count*8) filter(where next_year) as next_year_near
  from screen group by s
 ), totals as (
  select destination,count(*) as n,sum(receipts)::bigint as gross from sales
  where day between period_from and period_to group by destination
 )
 select t.state,coalesce(totals.n,0),coalesce(totals.gross,0),
 case when asof_day not between date '2026-11-26' and date '2026-12-31' then case when totals.n>0 and t.registration<>'Registered' then 'Review current remote-seller guidance for website sales.' end
 when hits.hit then 'Website receipts or order count reached a registration review threshold. Verify taxable receipts, returns, other sales, and the collection start date.'
 when hits.next_year_hit then format('Current-year website activity reached the review threshold for %s. Check qualifying receipts and registration for next year.',extract(year from asof_day)::int+1)
 when hits.next_year_near then format('Current-year website activity reached 80%% of the review threshold for %s.',extract(year from asof_day)::int+1)
 when hits.near_limit then 'Website activity reached 80% of a registration review threshold.'
 when totals.n>0 and hits.s is null and t.registration<>'Registered' and t.state not in ('NH','OR','DE') then 'Website sales reached this destination. Review its registration rules and collection timing.'
 end, hits.url
 from private.tax_states t left join totals on totals.destination=t.state left join hits on hits.s=t.state
$$;
revoke all on function private.tax_website_activity(date,date,date) from public,anon,authenticated;

alter function public.tax_admin_overview(date,date) rename to tax_ledger_overview;
create function public.tax_admin_overview(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$
 with original as (select public.tax_ledger_overview(p_from,p_to) as obj),
 activity as materialized (select * from private.tax_website_activity((now() at time zone 'America/New_York')::date,p_from,p_to))
 select obj||jsonb_build_object('states',(select jsonb_agg(s||jsonb_build_object('website_orders',a.period_orders,'website_receipts',a.period_receipts) order by a.state)
 from jsonb_array_elements(obj->'states') s join activity a on a.state=s->>'state'),
 'alerts',(select coalesce(jsonb_agg(jsonb_build_object('event_key','website:'||state,'state',state,'message',review_message,'source',source) order by state),'[]'::jsonb) from activity where review_message is not null)||(obj->'alerts')) from original
$$;
revoke all on function public.tax_admin_overview(date,date) from public,anon,authenticated;
grant execute on function public.tax_admin_overview(date,date) to service_role;


-- Effective-dated Washington policy for this store's confirmed direct-sales footprint.
-- Explicitly reviewed registration settings and later administrator changes take precedence.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,'WA','policy','state',jsonb_build_object(
 'origin','wa_remote_sales_2026_11_26','website_only_confirmed','2026-11-26',
 'first_eligible_cent',0,'store_minimum',false,'shipping_base','full_if_taxable','fee_base','proportional',
 'rounding','combined','uniform_jurisdiction_base',true,
 'surcharge_source','https://dor.wa.gov/forms-publications/publications-subject/tax-topics/surcharges-including-tariffs'),
 'https://dor.wa.gov/taxes-rates/retail-sales-tax/marketplace-fairness-leveling-playing-field/remote-sellers',
 '2026-11-26','2026-12-31','2026-11-26','approved'
where not exists(select 1 from private.tax_versions where state='WA' and kind='policy' and subject='state');
create function private.tax_wa_collection_date(crossed date) returns date
language sql immutable strict set search_path='' as $$
 select (date_trunc('month', (crossed+30)::timestamp) +
    case when extract(day from crossed+30)=1 then interval '0' else interval '1 month' end)::date
$$;

-- Actual receipts determine the admin dates. Also check the earliest plausible date using
-- placed orders, including open wires and unresolved addresses. If payment timing or an
-- uncertain destination could change today's answer, the checkout decision requires review.
-- An off-site sale contradicts the web-only footprint and requires reconciliation.
create function private.tax_wa_remote_dates(asof_day date)
returns table(crossed_on date,collect_from date,earliest_possible_start date,unresolved boolean)
language sql stable set search_path='' as $$
 with bounds as (
   select (date_trunc('year',asof_day)-interval '1 year')::date as first_day
 ), years as (
   select first_day as starts,(first_day+interval '1 year')::date as ends from bounds
   union all select (first_day+interval '1 year')::date,asof_day+1 from bounds
 ), website as (
   select upper(trim(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}',''))) as state,
     (o.created_at at time zone 'America/Los_Angeles')::date as opened,
     (coalesce(o.paid_at,o.created_at) at time zone 'America/Los_Angeles')::date as paid_day,
     o.paid_at is not null or o.payment_status in ('paid','refunded','disputed') as settled,
     (100*(o.total-coalesce(o.tax_amount,0)))::numeric as amount,
     o.status as status
   from public.orders o where coalesce(o.shipping_address->>'fulfillment','delivery')<>'pickup'
 ), receipts as (
   select paid_day as day,amount,false as provisional from website
   where state='WA' and settled and amount>=0
   union all
   select greatest(opened,y.starts),amount,true from website cross join years y
   where opened<y.ends and (not settled or paid_day>=y.starts)
     and (state='WA' or not exists(select 1 from private.tax_states t where t.state=website.state))
     and (settled or coalesce(status,'') not in ('cancelled','expired')) and amount>=0
   union all
   select l.booked,l.merchandise,v.provisional from private.tax_ledger l
   cross join (values(false),(true)) v(provisional)
   where l.state='WA' and l.kind='sale' and l.order_id is null
 ), daily as (
   select day,provisional,sum(amount) as amount from receipts,bounds where day between first_day and asof_day group by day,provisional
 ), running as (
   select day,provisional,sum(amount) over(partition by extract(year from day),provisional order by day) as gross from daily
 ), hits as (
   select min(day) filter(where not provisional and gross>10000000) as actual,
          min(day) filter(where provisional and gross>10000000) as possible from running
 )
 select actual,private.tax_wa_collection_date(actual),private.tax_wa_collection_date(possible),
   exists(select 1 from website,bounds where
     (state='WA' or not exists(select 1 from private.tax_states t where t.state=website.state))
     and (settled or coalesce(status,'') not in ('cancelled','expired'))
     and (opened is null or opened<=asof_day) and (paid_day is null or paid_day>=first_day or opened>=first_day)
     and (opened is null or amount is null or amount<0))
   or exists(select 1 from private.tax_ledger l,bounds where l.state='WA' and l.kind='sale'
     and l.order_id is null and l.booked between first_day and asof_day)
 from hits
$$;
revoke all on function private.tax_wa_remote_dates(date),private.tax_wa_collection_date(date) from public,anon,authenticated;

alter function private.tax_collection_gate(text,jsonb,date) rename to tax_pre_wa_collection_gate;
create function private.tax_collection_gate(s text,p jsonb,d date) returns text stable language plpgsql set search_path='' as $$
declare dates record; profile private.tax_states;
begin
 if s is distinct from 'WA' or p->>'origin' is distinct from 'wa_remote_sales_2026_11_26' then
   return private.tax_pre_wa_collection_gate(s,p,d);
 end if;
 select * into strict profile from private.tax_states where state=s;
 if p->>'approval' is distinct from 'approved' or (p->>'valid_from')::date>d or (p->>'valid_until')::date<d
    or (p->>'verified_on')::date>d or profile.disabled then return 'review'; end if;
 if p->>'collection'='collect' then return 'collect'; end if;
 if profile.physical or profile.registration not in ('Not Registered','No Current Obligation')
    or profile.effective is not null or profile.collect_from is not null then return 'review'; end if;
 select * into dates from private.tax_wa_remote_dates(d);
 if dates.unresolved or dates.earliest_possible_start<=d or dates.collect_from<=d then return 'review'; end if;
 return 'no_obligation';
end $$;
revoke all on function private.tax_collection_gate(text,jsonb,date) from public,anon,authenticated;

-- Surface the timing alongside the existing website threshold screen.
alter function private.tax_website_activity(date,date,date) rename to tax_website_activity_before_wa;
create function private.tax_website_activity(asof_day date,period_from date,period_to date)
returns table(state text,period_orders bigint,period_receipts bigint,review_message text,source text)
language sql stable set search_path='' as $$
 select a.state,a.period_orders,a.period_receipts,
 case when a.state='WA' and p->>'origin'='wa_remote_sales_2026_11_26' and p->>'approval'='approved'
    and (p->>'valid_until')::date>=asof_day and not s.physical and s.registration<>'Registered'
    and w.crossed_on is not null then
    format('Recorded Washington receipts exceeded $100,000 on %s. Review registration and B&O reporting from that date. Based on those receipts, sales tax collection starts %s.',
      w.crossed_on,w.collect_from)
 else a.review_message end,a.source
 from private.tax_website_activity_before_wa(asof_day,period_from,period_to) a
 join private.tax_states s on s.state=a.state
 cross join private.tax_wa_remote_dates(asof_day) w
 cross join lateral (select private.tax_report_version('WA','policy','state',asof_day) as p) policy
$$;
revoke all on function private.tax_website_activity(date,date,date) from public,anon,authenticated;
update private.tax_revision set revision=revision+1;

create or replace function public.tax_monitor_sources() returns jsonb stable security definer language sql set search_path='' as $$
 with current_rules as (select state,source,report_only,data from private.tax_versions where valid_until>=current_date and approval='approved'),
 sources as (select state,source from current_rules union
 select v.state,d.url from current_rules v cross join lateral jsonb_array_elements_text(v.data->'authority_sources') d(url)
 where v.report_only and v.data->>'origin'='catalog_sale_conditions_2026_11_27')
 select coalesce(jsonb_agg(to_jsonb(s) order by state,source),'[]') from sources s
$$;

-- Where everyday retail bullion has the same treatment across forms, a new
-- listing can use the jurisdiction's rule directly from the sold line.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,r.state,'product','retail_gold_silver',jsonb_build_object('origin','catalog_sale_conditions_2026_11_27',
 'scope','retail_gold_silver','treatment',r.treatment),r.source,date '2026-11-27',date '2026-12-31',date '2026-11-27','approved'
from (values
 ('WA','taxable','https://dor.wa.gov/education/industry-guides/jewelry-stores/currency-coins-and-precious-metal-bullion'),
 ('DE','eligible','https://revenue.delaware.gov/business-tax-forms/doing-business-in-delaware/step-4-gross-receipts-taxes/'),
 ('NH','eligible','https://www.revenue.nh.gov/faq/does-new-hampshire-have-sales-tax'),
 ('OR','eligible','https://www.oregon.gov/dor/programs/businesses/Pages/Sales-Tax.aspx')
) r(state,treatment,source);

create function private.tax_report_item_rule(s text,i public.order_items,d date,ordinary_new_sale boolean) returns jsonb
language plpgsql stable set search_path='' as $$
declare specific jsonb; shared_rule jsonb;
begin
 specific:=private.tax_report_version(s,'product',i.product_id::text,d);
 if specific is not null or ordinary_new_sale is not true or i.product_id is null
    or coalesce(i.metal::text,'') not in ('gold','silver') or coalesce(i.metal_weight_oz,0)<=0
    or nullif(trim(i.sku),'') is null or nullif(trim(i.product_name),'') is null then return specific;end if;
 shared_rule:=private.tax_report_version(s,'product','retail_gold_silver',d);
 if shared_rule->>'scope' is distinct from 'retail_gold_silver' then return null;end if;
 return shared_rule||jsonb_build_object('catalog_sku',i.sku,'catalog_name',i.product_name,'metal',i.metal::text,'catalog_weight',i.metal_weight_oz);
end $$;
revoke all on function private.tax_report_item_rule(text,public.order_items,date,boolean) from public,anon,authenticated;

create function private.tax_report_rule_checks(sale_day date)
returns table(state_code text,kind_name text,catalog_sku text,verified boolean)
language sql stable set search_path='' as $$
 with required as (
   select s.state,'policy'::text kind,'state'::text subject,null::text sku,null::text title,null::text metal,null::numeric weight from private.tax_states s
   union all select s.state,'product',e.subject,e.sku,e.title,e.metal,e.weight from private.tax_states s cross join private.tax_bullion_review_examples e
 ), reviewed as materialized (select q.*,private.tax_report_version(q.state,q.kind,q.subject,sale_day) v from required q)
 select state,kind,sku,not (v->>'approval' is distinct from 'approved'
    or not coalesce(sale_day between (v->>'valid_from')::date and (v->>'valid_until')::date,false)
    or not coalesce((v->>'verified_on')::date<=sale_day,false)
    or (kind='product' and (coalesce(v->>'treatment','') not in ('eligible','taxable')
      or (v->>'catalog_sku',v->>'catalog_name',v->>'metal',(v->>'catalog_weight')::numeric) is distinct from (sku,title,metal,weight)))) from reviewed
$$;
revoke all on function private.tax_report_rule_checks(date) from public,anon,authenticated;

create function public.tax_admin_rule_coverage(p_actor uuid,p_day date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 with states as (
   select state_code, bool_or(verified) filter(where kind_name='policy') policy,
     count(*) filter(where kind_name='product') products,count(*) filter(where kind_name='product' and verified) approved,
     coalesce(array_agg(catalog_sku order by catalog_sku) filter(where kind_name='product' and not verified),'{}') pending
   from private.tax_report_rule_checks(p_day) group by state_code
 ) select jsonb_build_object('day',p_day,'destinations',count(*),'policies',count(*) filter(where policy),
     'reviewed_destinations',count(*) filter(where policy and products>0 and approved=products),
     'open_destinations',coalesce(jsonb_agg(state_code order by state_code) filter(where not policy or approved<>products or products=0),'[]'),
     'product_reviews',sum(approved),'product_total',sum(products),
     'state_only_reviews',(select count(*) from private.tax_states t cross join private.tax_bullion_review_examples e cross join lateral
       (select private.tax_state_scope(t.state,e.subject::bigint,p_day) r) item where t.state in ('AK','MT','CO') and r is not null
       and (e.sku,e.title,e.metal,e.weight)=(r->>'catalog_sku',r->>'catalog_name',r->>'metal',(r->>'catalog_weight')::numeric)),
     'remaining',coalesce(jsonb_agg(to_jsonb(s) order by state_code) filter(where not policy or approved<products),'[]'))
   into result from states s;
 return result;
end $$;
revoke all on function public.tax_admin_rule_coverage(uuid,date) from public,anon,authenticated;
grant execute on function public.tax_admin_rule_coverage(uuid,date) to service_role;

create or replace function private.tax_report_calculation_inputs(p_order bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 o public.orders; profile private.tax_states; policy jsonb; destination jsonb; district jsonb;
 products jsonb; lines jsonb; sale_day date; state_code text; collection text; saved jsonb; missing integer; regional jsonb:='{}';
begin
 select * into strict o from public.orders where id=p_order;
 sale_day:=(o.created_at at time zone 'America/New_York')::date;
 if o.tax_assessment_id is not null and o.paid_at is not null then
   select r.breakdown,r.review_reason into district,collection from private.tax_original_order_rows(
     (o.paid_at at time zone 'America/New_York')::date,(o.paid_at at time zone 'America/New_York')::date) r where r.order_id=o.id;
   if collection is null then
     select a.result into saved from private.tax_assessments a where a.id=o.tax_assessment_id;
     return jsonb_build_object('saved',saved);
   end if;
   return jsonb_build_object('review',coalesce(collection,'Order and tax calculation need reconciliation'));
 end if;
 if sale_day is null then return jsonb_build_object('review','The original order date is missing.');end if;
 destination:=case when o.shipping_address->>'fulfillment'='pickup' then o.shipping_address
   else coalesce(o.shipping_address->'address',o.shipping_address) end;
 state_code:=private.tax_admin_state(destination->>'state');
 destination:=destination||jsonb_build_object('state',state_code);
 if o.shipping_address->>'fulfillment'='pickup' and state_code is distinct from 'NY' then
   return jsonb_build_object('review','The original pickup location needs verification.');end if;
 select * into profile from private.tax_states where state=state_code;
 if not found then return jsonb_build_object('review','The order destination needs verification.');end if;
 if state_code in ('AK','CO','MT') and exists(select from private.tax_report_start where o.created_at>=starts_at) then
   regional:=jsonb_strip_nulls(jsonb_build_object('state_scope',private.tax_order_state_scope(o,state_code,sale_day)));
   regional:=regional||jsonb_build_object('regional_destination',private.tax_normalize_address(destination));
   if state_code='AK' and sale_day=(now() at time zone 'America/New_York')::date then
     regional:=regional||jsonb_build_object('member_policy',private.tax_remote_order_bound('AK',
        private.tax_report_version('AK','policy','arsstc_member',sale_day),'{}',sale_day,o.id));
   end if;
 end if;
 policy:=private.tax_report_version(state_code,'policy','state',sale_day);
 if policy is null or policy->>'approval'<>'approved' or (policy->>'valid_until')::date<sale_day then
   return jsonb_build_object('review','No verified policy covers this destination on the original order date.', 'day',sale_day)||regional;end if;
 -- Enable fresh amounts together across all 51 destinations. Also check each
 -- order's actual SKU identity in the server engine, including delisted items.
 select count(*) into missing from private.tax_report_rule_checks(sale_day) where not verified;
 if missing>0 or (select count(*) from private.tax_states)<>51 or not exists(select from private.tax_bullion_review_examples) then
   return jsonb_build_object('review','Gold and silver tax rules still need jurisdiction review for this order date.','day',sale_day)||regional;end if;
 if policy->>'collection_basis'='reviewed_exempt_items' then
   policy:=private.tax_remote_order_bound(state_code,policy||jsonb_build_object('shipping_disabled',profile.disabled),'{}',sale_day,null);
   collection:=policy->>'collection';
   if collection is distinct from 'exempt_merchandise' then return jsonb_build_object('review','Merchandise exemption needs review.','day',sale_day);end if;
 elsif profile.registration='Registered' and coalesce(profile.effective,profile.active_confirmed_on)<=sale_day
    and coalesce(profile.collect_from,profile.active_confirmed_on)<=sale_day then collection:='collect';
 elsif policy->>'no_general_collection_regime'='true' and state_code in ('DE','NH','OR') then collection:='no_obligation';
 elsif state_code='WA' and policy->>'origin'='wa_remote_sales_2026_11_26' and sale_day=(now() at time zone 'America/New_York')::date then
   collection:=private.tax_collection_gate(state_code,policy,sale_day);
   if collection is distinct from 'no_obligation' then return jsonb_build_object('review','Washington collection start needs review.','day',sale_day);end if;
 elsif sale_day=(now() at time zone 'America/New_York')::date and policy->>'remote_basis' in ('zero_prior_calendar_year','below_remote_threshold') then
   policy:=policy||jsonb_build_object('shipping_disabled',profile.disabled,'registration',profile.registration);
   if policy->>'remote_basis'='below_remote_threshold' then
     policy:=private.tax_remote_order_bound(state_code,policy,'{}',sale_day,o.id);
     collection:=policy->>'collection';
   else collection:=private.tax_collection_gate(state_code,policy,sale_day);end if;
   if collection is distinct from 'no_obligation' then return jsonb_build_object('review',coalesce(policy->>'review_reason','The seller collection threshold needs review for this order.'),'day',sale_day);end if;
 else return jsonb_build_object('review','Collection status on the order date needs verification.','day',sale_day);end if;
 policy:=policy||jsonb_build_object('collection',collection,'registration',profile.registration);
 if state_code='NY' and profile.ny_dealer_confirmed_on<=sale_day then policy:=policy||jsonb_build_object('ny_dealer_status',profile.ny_dealer_status);end if;
 district:=private.tax_report_version(state_code,'address',private.tax_normalize_address(destination)::text,sale_day);
 select jsonb_agg(jsonb_build_object('id',i.product_id,'sku',i.sku,'name',i.product_name,'metal',i.metal,'weight',i.metal_weight_oz,'quantity',i.quantity,'gross',i.line_total,
     'special_terms',coalesce(trim(o.customer_notes),'')<>'',
     'metal_priced',case when i.pricing_snapshot->>'price_mode'='dynamic'
        and jsonb_typeof(i.pricing_snapshot->'spot')='number' and jsonb_typeof(i.pricing_snapshot->'premium_fixed')='number'
        and jsonb_typeof(i.pricing_snapshot->'premium_percent')='number' then (i.pricing_snapshot->>'spot')::numeric>0
        and round((i.pricing_snapshot->>'spot')::numeric*i.metal_weight_oz*(1+(i.pricing_snapshot->>'premium_percent')::numeric/100)
         +(i.pricing_snapshot->>'premium_fixed')::numeric,2)=i.unit_price and i.unit_price*i.quantity=i.line_total
        else false end,'sale_evidence',f.fact)),
   jsonb_object_agg(i.product_id::text,private.tax_report_item_rule(state_code,i,sale_day,
     coalesce(trim(o.customer_notes),'')='' and exists(select from private.tax_report_start where o.created_at>=starts_at))) into lines,products
   from public.order_items i left join lateral (
     select jsonb_strip_nulls(jsonb_build_object('id',e.id,'basis',e.basis,'document',e.document_id,
       'fmv_cents',e.fmv_cents,'valuation_day',sale_day)) fact from private.tax_item_facts e where e.order_id=o.id
       and e.state=state_code and e.product_id=i.product_id and e.fingerprint=private.tax_order_fact_hash(o) order by e.id desc limit 1
   ) f on true where i.order_id=o.id and i.product_id is not null;
 if lines is null or exists(select from public.order_items where order_id=o.id and product_id is null) then
   return jsonb_build_object('review','A historical order item needs verification.','day',sale_day);end if;
 return jsonb_build_object('day',sale_day,'state',state_code,'policy',policy,'district',district,'destination',private.tax_normalize_address(destination),
   'lines',lines,'products',products,'subtotal',o.subtotal,'shipping',o.shipping_amount,'fee',o.payment_surcharge,
   'insurance',o.insurance_amount,'investment',o.shipping_address->'investment_purchase');
end $$;
revoke all on function private.tax_report_calculation_inputs(bigint) from public,anon,authenticated;
