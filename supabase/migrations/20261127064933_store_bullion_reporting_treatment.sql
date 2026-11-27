-- Owner-selected treatment in the private admin report, effective at release.
-- Keep it independent of recorded tax, verified rules and collection decisions.
create table private.tax_store_bullion_exemptions (
  state text primary key references private.tax_states(state),
  effective_at timestamptz not null default transaction_timestamp(),
  ends_at timestamptz check (ends_at>effective_at)
);
alter table private.tax_store_bullion_exemptions enable row level security;
revoke all on private.tax_store_bullion_exemptions from public,anon,authenticated;
insert into private.tax_store_bullion_exemptions(state) values ('AK'),('CO');

create or replace function public.tax_admin_new_orders(p_actor uuid,p_from date,p_to date,p_before bigint default null)
returns jsonb stable language plpgsql security definer set search_path='' as $$
declare report jsonb;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_before<=0 then raise exception 'Invalid period or cursor';end if;
 with batch as (
  select o.id,o.order_number,o.created_at,case when o.shipping_address->>'fulfillment'='pickup' then 'NY'
   else private.tax_admin_state(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}')) end as state,
   j.result,j.checked_at,o.shipping_address from public.orders o cross join private.tax_report_start s left join lateral
     (select q.result,q.checked_at from private.tax_order_reports q where q.order_id=o.id and q.input_hash=private.tax_report_input_hash(o)) j on true
   where o.created_at>=greatest(s.starts_at,p_from::timestamp at time zone 'America/New_York')
   and o.created_at<(p_to+1)::timestamp at time zone 'America/New_York' and (p_before is null or o.id<p_before)
   order by o.id desc limit 26
 ), visible as (select * from batch order by id desc limit 25), report_rows as (
   select v.id,v.order_number,v.created_at,v.state,v.result,v.checked_at,
          case when e.state is not null then jsonb_build_object(
            'treatment','exempt','amount_cents',0,'effective_at',e.effective_at) end as store_treatment
   from visible v
   left join private.tax_store_bullion_exemptions e on e.state=v.state and v.created_at>=e.effective_at
     and (e.ends_at is null or v.created_at<e.ends_at)
     and coalesce(v.shipping_address->>'fulfillment','delivery')='delivery'
     and private.tax_admin_state(coalesce(v.shipping_address->'address',v.shipping_address)->>'state')=v.state
     and upper(trim(coalesce(v.shipping_address->'address',v.shipping_address)->>'country'))='US'
     and (select count(*)>0 and bool_and(coalesce(i.metal::text in ('gold','silver'),false))
            from public.order_items i where i.order_id=v.id)
 )
 select jsonb_build_object('starts_at',(select starts_at from private.tax_report_start),
   'store_exemptions',(select coalesce(jsonb_agg(e.state order by e.state),'[]') from private.tax_store_bullion_exemptions e
     where now()>=e.effective_at and (e.ends_at is null or now()<e.ends_at)),
   'orders',coalesce(jsonb_agg(to_jsonb(v) order by id desc),'[]'),'next',case when (select count(*) from batch)>25 then min(id) end)
 into report from report_rows v;
 return report;
end $$;
revoke all on function public.tax_admin_new_orders(uuid,date,date,bigint) from public,anon,authenticated;
grant execute on function public.tax_admin_new_orders(uuid,date,date,bigint) to service_role;
