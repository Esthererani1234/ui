lock table private.tax_versions in share row exclusive mode;
-- The NY investment price test covers proof coins. Preserve the prior review in history.
-- Gold Buffalo proof specifications are verified by the US Mint. Compare the locked
-- individual selling price with the statutory limit, including the $50 face value.
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select v.state,v.kind,v.subject,v.data||jsonb_build_object(
 'specification_source','https://www.usmint.gov/news/press-releases/2026-american-buffalo-one-ounce-gold-proof-coin-available-may-7'),
 v.source,v.valid_from,v.valid_until,v.verified_on,'approved'
from private.tax_versions v join public.products p on p.id::text=v.subject
where v.state='NY' and v.kind='product' and v.approval='requires_review'
  and v.data->>'origin'='catalog_policy_release_2026_11_26' and v.data->>'catalog_sku'='GOTS-GBP-1OZ-RY-001'
  and (p.sku,p.name,p.metal::text,p.metal_weight_oz)=(v.data->>'catalog_sku',v.data->>'catalog_name','gold',1)
  and not exists(select from private.tax_versions later where (later.state,later.kind,later.subject)=(v.state,v.kind,v.subject) and later.id>v.id);

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
 select p.id,p.sku,v.rule
 from public.products p cross join lateral
   (select private.tax_version('NY','product',p.id::text,'2026-11-26') as rule) v
 where p.is_active and v.rule->>'approval'='approved' and v.rule->>'origin'='catalog_policy_release_2026_11_26'
 and (p.sku,p.name,p.metal::text,p.metal_weight_oz)=(v.rule->>'catalog_sku',v.rule->>'catalog_name',v.rule->>'metal',(v.rule->>'catalog_weight')::numeric)
 and p.sku in ('AGE-1OZ-BU-RY','GOTS-GBP-1OZ-RY-001','MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY',
 'APMEX-1OZ-TEP','GOTS-834790','PAMP-1OZ-FORTUNA-ASSAY','RAND-0033')
)
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select a.state,'product',p.id::text,jsonb_build_object('origin','catalog_policy_release_2026_11_26','catalog_sku',p.sku,
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
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
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
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select a.state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'remote_basis','below_remote_threshold','merchant_footprint_as_of','2026-11-26','first_eligible_cent',minimum,
 'store_minimum',minimum>0,'revenue_trigger_cents',first_cent,'transaction_trigger',first_count,'requires_both',requires_both),
 a.source,date '2026-11-26',date '2026-12-31',date '2026-11-26','approved'
from authorities a where not exists(select from private.tax_versions v where v.state=a.state and v.kind='policy' and v.subject='state');

create or replace function private.tax_remote_order_policy(s text,p jsonb,q jsonb,d date) returns jsonb
stable language plpgsql set search_path='' as $$
declare profile private.tax_states; proposed numeric; receipts numeric; transactions bigint; unknown_amount boolean;
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
 if s not in ('DC','HI','ME','VT','SD','IA','KS','NE','IN','WI','SC','NC','GA','LA','MD','MN','MO','MS','ND','NJ','NV','OH','PA','TN','UT','WV','IL','KY','OK','TX','AR','CT','MA') or p->>'state' is distinct from s
   or p->>'origin' is distinct from 'catalog_policy_release_2026_11_26' or p->>'approval' is distinct from 'approved'
   or not coalesce(d between (p->>'valid_from')::date and (p->>'valid_until')::date,false)
   or not coalesce((p->>'revenue_trigger_cents')::bigint>0,false)
   or not coalesce(d between date '2026-11-26' and date '2026-12-31',false)
   or profile.disabled or profile.physical or profile.registration not in ('Not Registered','No Current Obligation')
   or profile.collect_from is not null or profile.effective is not null or profile.active_confirmed_on is not null
   or profile.registration_due is not null then return p; end if;
 if not coalesce((q->>'subtotal')::numeric>0 and (q->>'shipping_amount')::numeric>=0 and (q->>'card_surcharge')::numeric>=0,false)
   then return p; end if;
 proposed:=ceil(100*((q->>'subtotal')::numeric+(q->>'shipping_amount')::numeric
   +greatest((q->>'card_surcharge')::numeric,round((q->>'subtotal')::numeric*0.02,2))));
 if exists(select from private.tax_ledger where state=s and kind='sale' and order_id is null) then return p; end if;
 -- Pending wires and refunded orders count toward this upper bound. Ambiguous
 -- destinations also count. A threshold hit prompts review of actual period receipts.
 with website as (
   select upper(btrim(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}',''))) as destination,
     o.total as amount from public.orders o
   where coalesce(o.shipping_address->>'fulfillment','delivery')<>'pickup'
 )
 select coalesce(sum(ceil(100*amount)),0),count(*),coalesce(bool_or(amount is null or amount<0),false)
 into receipts,transactions,unknown_amount from website w
 where w.destination=s or not exists(select from private.tax_states t where t.state=w.destination);
 p:=p||jsonb_build_object('receipts_upper_bound_cents',receipts+proposed,'transactions_upper_bound',transactions+1);
 if unknown_amount then return p; end if;
 if s='CT' then
   if receipts+proposed>=(p->>'revenue_trigger_cents')::bigint and transactions+1>=(p->>'transaction_trigger')::integer then return p; end if;
 elsif receipts+proposed>=(p->>'revenue_trigger_cents')::bigint or
     transactions+1>=(p->>'transaction_trigger')::integer then return p; end if;
 return p||jsonb_build_object('collection','no_obligation');
end $$;
revoke all on function private.tax_remote_order_policy(text,jsonb,jsonb,date) from public,anon,authenticated;

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
alter table private.tax_versions drop constraint tax_version_origin;
alter table private.tax_versions add constraint tax_version_origin check (
 actor is not null or coalesce(data->>'origin' in ('catalog_policy_release_2026_11_26','wa_remote_sales_2026_11_26'),false)
);
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select 'WA','policy','state',jsonb_build_object(
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
 cross join lateral (select private.tax_version('WA','policy','state',asof_day) as p) policy
$$;
revoke all on function private.tax_website_activity(date,date,date) from public,anon,authenticated;
update private.tax_revision set revision=revision+1;

create function private.tax_report_rule_checks(sale_day date)
returns table(state_code text,kind_name text,catalog_sku text,verified boolean)
language sql stable set search_path='' as $$
 with required as (
   select s.state,'policy'::text kind,'state'::text subject,null::text sku,null::text title,null::text metal,null::numeric weight from private.tax_states s
   union all select s.state,'product',p.id::text,p.sku,p.name,p.metal::text,p.metal_weight_oz from private.tax_states s cross join public.products p where p.is_active
 ), reviewed as materialized (select q.*,private.tax_version(q.state,q.kind,q.subject,sale_day) v from required q)
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
     'product_reviews',sum(approved),'product_total',sum(products),
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
 products jsonb; lines jsonb; sale_day date; state_code text; collection text; saved jsonb; missing integer;
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
 policy:=private.tax_version(state_code,'policy','state',sale_day);
 if policy is null or policy->>'approval'<>'approved' or (policy->>'valid_until')::date<sale_day then
   return jsonb_build_object('review','No verified policy covers this destination on the original order date.', 'day',sale_day);end if;
 -- Enable fresh amounts together across all 51 destinations. Also check each
 -- order's actual SKU identity in the server engine, including delisted items.
 select count(*) into missing from private.tax_report_rule_checks(sale_day) where not verified;
 if missing>0 or (select count(*) from private.tax_states)<>51 or not exists(select from public.products where is_active) then
   return jsonb_build_object('review','Nationwide rules and product reviews are incomplete for this order date.','day',sale_day);end if;
 if policy->>'collection_basis'='reviewed_exempt_items' then
   policy:=private.tax_remote_order_policy(state_code,policy||jsonb_build_object('shipping_disabled',profile.disabled),'{}',sale_day);
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
     -- The existing helper includes the proposed order. Counting this placed order twice
     -- is a safe upper bound only for proving the business is below both thresholds.
     -- A potential crossing remains open for period-specific reconciliation.
     policy:=private.tax_remote_order_policy(state_code,policy,jsonb_build_object('subtotal',o.subtotal,
        'shipping_amount',o.shipping_amount,'card_surcharge',o.payment_surcharge),sale_day);
     collection:=policy->>'collection';
   else collection:=private.tax_collection_gate(state_code,policy,sale_day);end if;
   if collection is distinct from 'no_obligation' then return jsonb_build_object('review','The seller collection threshold needs review for this order.','day',sale_day);end if;
 else return jsonb_build_object('review','Collection status on the order date needs verification.','day',sale_day);end if;
 policy:=policy||jsonb_build_object('collection',collection,'registration',profile.registration);
 if state_code='NY' and profile.ny_dealer_confirmed_on<=sale_day then policy:=policy||jsonb_build_object('ny_dealer_status',profile.ny_dealer_status);end if;
 district:=private.tax_version(state_code,'address',private.tax_normalize_address(destination)::text,sale_day);
 select jsonb_agg(jsonb_build_object('id',i.product_id,'sku',i.sku,'name',i.product_name,'metal',i.metal,'weight',i.metal_weight_oz,'quantity',i.quantity,'gross',i.line_total)),
   jsonb_object_agg(i.product_id::text,private.tax_version(state_code,'product',i.product_id::text,sale_day)) into lines,products
   from public.order_items i where i.order_id=o.id and i.product_id is not null;
 if lines is null or exists(select from public.order_items where order_id=o.id and product_id is null) then
   return jsonb_build_object('review','A historical order item needs verification.','day',sale_day);end if;
 return jsonb_build_object('day',sale_day,'state',state_code,'policy',policy,'district',district,'destination',private.tax_normalize_address(destination),
   'lines',lines,'products',products,'subtotal',o.subtotal,'shipping',o.shipping_amount,'fee',o.payment_surcharge,
   'insurance',o.insurance_amount,'investment',o.shipping_address->'investment_purchase');
end $$;
revoke all on function private.tax_report_calculation_inputs(bigint) from public,anon,authenticated;
