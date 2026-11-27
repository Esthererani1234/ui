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
  select s,first_cent,first_count,url,daterange(yr,asof_day+1) as span from rules,bounds where window_type='years'
  union all select s,first_cent,first_count,url,daterange((yr-interval '1 year')::date,yr) from rules,bounds where window_type in ('years','prior_year')
  union all select s,first_cent,first_count,url,daterange((mo-interval '12 months')::date,mo) from rules,bounds where window_type='prior_months'
  union all select s,first_cent,first_count,url,daterange((date_trunc('quarter',asof_day)-interval '12 months')::date,date_trunc('quarter',asof_day)::date) from rules where window_type='prior_quarters'
 ), screen as (
  select w.s,w.url,w.span, count(sales.day) as n,coalesce(sum(receipts),0) as gross,w.first_cent,w.first_count
  from windows w left join sales on sales.destination=w.s and sales.day <@ w.span
  group by w.s,w.url,w.span,w.first_cent,w.first_count
 ), hits as (
  select s,max(url) as url,bool_or(gross>=first_cent or n>=coalesce(first_count,2147483647)) as hit,
   bool_or(gross*10>=first_cent*8::bigint or (first_count is not null and n*10>=first_count*8)) as near_limit
  from screen group by s
 ), totals as (
  select destination,count(*) as n,sum(receipts)::bigint as gross from sales
  where day between period_from and period_to group by destination
 )
 select t.state,coalesce(totals.n,0),coalesce(totals.gross,0),
 case when asof_day not between date '2026-11-26' and date '2026-12-31' then case when totals.n>0 and t.registration<>'Registered' then 'Review current remote-seller guidance for website sales.' end
 when hits.hit then 'Website receipts or order count reached a registration review threshold. Verify taxable receipts, returns, other sales, and the collection start date.'
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

-- Isolate dated cash observations from the enduring catalog classification.
create table private.tax_bullion_close (
 metal text not null check(metal in ('gold','silver','platinum','palladium')),
 market_day date not null, usd_cents_per_oz bigint not null check(usd_cents_per_oz>0),
 source text not null check(source like 'https://%'), primary key(metal,market_day)
);
create table private.tax_ny_market_day (
 sale_day date primary key, prior_business_day date not null check(prior_business_day<sale_day),
 calendar_source text not null check(calendar_source like 'https://%'),
 cad_to_usd numeric check(cad_to_usd>0), fx_source text check(fx_source like 'https://%'),
 check((cad_to_usd is null)=(fx_source is null))
);
revoke all on private.tax_bullion_close,private.tax_ny_market_day from public,anon,authenticated;
insert into private.tax_bullion_close values
 ('gold','2026-11-25',358845,'https://www.ausecure.com/gold-market-close-nov-25-2026/'),
 ('silver','2026-11-25',4114,'https://www.ausecure.com/gold-market-close-nov-25-2026/');
insert into private.tax_ny_market_day values
 ('2026-11-26','2026-11-25','https://www.nysenate.gov/legislation/laws/GCN/24',0.7021,
  'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2026-11-26&end_date=2026-11-26');

create function private.tax_ny_market_inputs(p jsonb,d date) returns jsonb stable language sql set search_path='' as $$
 select coalesce((select p || jsonb_build_object('market_day',m.sale_day,'prior_business_day',m.prior_business_day,
  'market_observed_on',b.market_day,'market_unit_cents',b.usd_cents_per_oz,'market_source',b.source,
  'market_calendar_source',m.calendar_source,'market_basis','cash_close') ||
  case p->>'catalog_sku'
   when 'AGE-1OZ-BU-RY' then jsonb_build_object('face_usd_cents',5000,'gross_micro_oz',1090900)
   when 'MAPLE-1OZ-BU-RY' then jsonb_build_object('face_usd_cents',round(5000*m.cad_to_usd),'gross_micro_oz',1000000,'face_fx_source',m.fx_source)
   when 'SML-1OZ-BU-RY' then jsonb_build_object('face_usd_cents',round(500*m.cad_to_usd),'face_fx_source',m.fx_source)
   else '{}'::jsonb end
 from private.tax_ny_market_day m join private.tax_bullion_close b on b.market_day=m.prior_business_day and b.metal=p->>'metal'
 where m.sale_day=d and p->>'origin'='catalog_policy_release_2026_11_26' and p->>'approval'='approved'
 and (p->>'catalog_sku' in ('AGE-1OZ-BU-RY','PAMP-1OZ-FORTUNA-ASSAY','APMEX-1OZ-TEP','RAND-0033')
 or (p->>'catalog_sku' in ('MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY') and m.cad_to_usd is not null))), p)
$$;
revoke all on function private.tax_ny_market_inputs(jsonb,date) from public,anon,authenticated;
alter function public.tax_quote_inputs(uuid,uuid,jsonb) rename to tax_jurisdiction_inputs;
create function public.tax_quote_inputs(p_user uuid,p_quote uuid,p_address jsonb) returns jsonb stable language sql security definer set search_path='' as $$
 select case when p_address->>'state'='NY' and jsonb_typeof(raw->'products')='object' then
  raw||jsonb_build_object('products',(select jsonb_object_agg(k,private.tax_ny_market_inputs(v,(raw->>'day')::date))
   from jsonb_each(raw->'products') e(k,v))) else raw end
 from (select public.tax_jurisdiction_inputs(p_user,p_quote,p_address) raw) q
$$;
revoke all on function public.tax_quote_inputs(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tax_quote_inputs(uuid,uuid,jsonb) to service_role;
update private.tax_revision set revision=revision+1;
