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
update private.tax_states s set registration='Not Registered' where state='WA'
 and registration='Requires Legal Review' and not physical and not disabled and note=''
 and effective is null and collect_from is null and registration_due is null
 and not exists(select 1 from private.tax_audit where state='WA' and action='settings');

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
