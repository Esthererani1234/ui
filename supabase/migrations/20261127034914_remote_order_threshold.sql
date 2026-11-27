-- For this NYC-only direct seller, an upper bound below both statutory limits
-- proves that current sales have not triggered the reviewed state's remote threshold.
-- The upper bound includes every plausible order across the life of the store.
with authorities(state,first_cent,first_count,source) as (values
 ('IA',10000000,null,'https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax/remote-sellers-marketplace-facilitators'),
 ('KS',10000001,null,'https://www.ksrevenue.gov/pub1510.html'),
 ('NC',10000001,null,'https://www.ncdor.gov/taxes-forms/sales-and-use-tax/other-sales-and-use-tax-resources/remote-sales'),
 ('NE',10000001,200,'https://revenue.nebraska.gov/about/frequently-asked-questions/remote-seller-and-marketplace-facilitator-faqs'),
 ('SC',10000001,null,'https://www.dor.sc.gov/sales-use-tax-index/sales-tax/remote-sellers'),
 ('IN',10000001,null,'https://www.in.gov/dor/i-am-a/business-corp/remote-sellers/'),
 ('WI',10000001,null,'https://www.revenue.wi.gov/pages/faqs/pcs-sales.aspx'),
 ('HI',10000000,200,'https://data.capitol.hawaii.gov/hrscurrent/Vol04_Ch0201-0257/HRS0237/HRS_0237-0002_0005.htm'),
 ('DC',10000001,201,'https://otr.cfo.dc.gov/page/sales-and-use-tax-faqs'),
 ('ME',10000001,null,'https://legislature.maine.gov/statutes/36/title36sec1754-B.html'),
 ('VT',10000000,200,'https://legislature.vermont.gov/statutes/section/32/233/09701'),
 ('SD',10000001,null,'https://sdlegislature.gov/api/Statutes/10-64-2.html'),
 ('GA',10000001,200,'https://dor.georgia.gov/document/document-sut-pb/sut-2019-02/download'),
 ('LA',10000001,null,'https://www.legis.la.gov/legis/ViewDocument.aspx?d=1337247'),
 ('MD',10000001,200,'https://regs.maryland.gov/us/md/exec/comar/03.06.01.33'),
 ('MN',10000001,200,'https://www.revenue.state.mn.us/sales-tax-faqs-remote-sellers'),
 ('MO',10000001,null,'https://dor.mo.gov/faq/taxation/business/remote-seller-and-marketplace-facilitator.html'),
 ('MS',25000001,null,'https://www.dor.ms.gov/sites/default/files/notices-technical-bulletins/Online%2520Seller%2520Guidance.pdf'),
 ('ND',10000001,null,'https://www.tax.nd.gov/sales-and-use-tax'),
 ('NJ',10000001,200,'https://www.nj.gov/treasury/taxation/remotesellers.shtml'),
 ('NV',10000001,200,'https://tax.nv.gov/faqs/marketplace-facilitator-seller-faqs/remote-sellers-wayfair-decision/'),
 ('OH',10000001,200,'https://codes.ohio.gov/ohio-revised-code/section-5741.01'),
 ('PA',10000000,null,'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax/online-retailers'),
 ('TN',10000001,null,'https://revenue.support.tn.gov/hc/en-us/articles/360058087691-MS-5-When-Remote-Sellers-Must-Register-and-Collect-Sales-Tax'),
 ('UT',10000001,null,'https://tax.utah.gov/business/sales-tax/other-sales-tax/out-of-state-remote-sellers/'),
 ('WV',10000001,200,'https://tax.wv.gov/Business/SalesAndUseTax/ECommerce/RemoteSellers/Pages/RemoteSellersAndWestVirginiaTax.aspx'),
 ('IL',10000000,null,'https://tax.illinois.gov/content/dam/soi/en/web/tax/research/publications/bulletins/documents/2026/fy-2026-12.pdf'),
 ('KY',10000001,null,'https://apps.legislature.ky.gov/Law/statutes/statute.aspx?id=58190'),
 ('OK',10000000,null,'https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/rules-and-policies/letter-rulings/2026/LR-26-018.pdf'),
 ('TX',50000000,null,'https://comptroller.texas.gov/taxes/sales/remote-sellers.php')
)
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'remote_basis','below_remote_threshold','merchant_footprint_as_of','2026-11-26','first_eligible_cent',case when state='MD' then 100001 else 0 end,
 'store_minimum',state='MD','revenue_trigger_cents',first_cent,'transaction_trigger',first_count),
 source,date '2026-11-26',date '2026-12-31',date '2026-11-26','approved'
from authorities a where not exists(select from private.tax_versions v where v.state=a.state and v.kind='policy' and v.subject='state');

create function private.tax_remote_order_policy(s text,p jsonb,q jsonb,d date) returns jsonb
stable language plpgsql set search_path='' as $$
declare profile private.tax_states; proposed numeric; receipts numeric; transactions bigint; unknown_amount boolean;
begin
 if p->>'remote_basis' is distinct from 'below_remote_threshold' then return p; end if;
 -- This policy only establishes noncollection. An active or pending registration
 -- requires the state's separately reviewed collection, sourcing and fee rules.
 p:=p||jsonb_build_object('collection','review');
 select * into strict profile from private.tax_states where state=s;
 if s not in ('DC','HI','ME','VT','SD','IA','KS','NE','IN','WI','SC','NC','GA','LA','MD','MN','MO','MS','ND','NJ','NV','OH','PA','TN','UT','WV','IL','KY','OK','TX') or p->>'state' is distinct from s
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
 if unknown_amount or receipts+proposed>=(p->>'revenue_trigger_cents')::bigint or
    transactions+1>=(p->>'transaction_trigger')::integer then return p; end if;
 return p||jsonb_build_object('collection','no_obligation');
end $$;
revoke all on function private.tax_remote_order_policy(text,jsonb,jsonb,date) from public,anon,authenticated;

alter function public.tax_quote_inputs(uuid,uuid,jsonb) rename to tax_inputs_before_remote_threshold;
create function public.tax_quote_inputs(p_user uuid,p_quote uuid,p_address jsonb) returns jsonb
stable language sql security definer set search_path='' as $$
 select case when raw->'policy'->>'remote_basis'='below_remote_threshold' then
   raw||jsonb_build_object('policy',private.tax_remote_order_policy(p_address->>'state',raw->'policy',raw->'quote',(raw->>'day')::date))
   else raw end from (select public.tax_inputs_before_remote_threshold(p_user,p_quote,p_address) raw) original
$$;
revoke all on function public.tax_quote_inputs(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tax_quote_inputs(uuid,uuid,jsonb) to service_role;
update private.tax_revision set revision=revision+1;
