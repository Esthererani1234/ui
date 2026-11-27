-- Capture only orders created after installation. An older wire paid later stays outside this queue.
create table private.tax_report_start(singleton boolean primary key check(singleton), starts_at timestamptz not null);
insert into private.tax_report_start values(true,clock_timestamp());
create table private.tax_order_reports(
 order_id bigint primary key references public.orders on delete cascade,
 available_at timestamptz not null default now(), lease uuid, attempts int not null default 0,
 input_hash text not null, rule_revision bigint not null,
 result jsonb, checked_at timestamptz
);
alter table private.tax_report_start enable row level security;
alter table private.tax_order_reports enable row level security;
revoke all on private.tax_report_start,private.tax_order_reports from public,anon,authenticated;
create index tax_order_reports_pending on private.tax_order_reports(available_at,order_id) where available_at<'infinity';

create function private.tax_report_input_hash(o public.orders) returns text stable language sql set search_path='' as $$
 select md5(jsonb_build_array(o.created_at,o.paid_at,o.shipping_address,o.subtotal,o.shipping_amount,o.payment_surcharge,
    o.insurance_amount,o.tax_amount,o.total,o.tax_assessment_id,
    (select jsonb_agg(jsonb_build_array(i.product_id,i.sku,i.product_name,i.metal,i.metal_weight_oz,i.quantity,i.line_total)
       order by i.product_id,i.sku,i.product_name,i.line_total,i.quantity) from public.order_items i where i.order_id=o.id))::text)
$$;
revoke all on function private.tax_report_input_hash(public.orders) from public,anon,authenticated;

create function private.queue_new_order_reports() returns void language plpgsql set search_path='' as $$
begin
 insert into private.tax_order_reports(order_id,input_hash,rule_revision)
 select o.id,private.tax_report_input_hash(o),r.revision from public.orders o cross join private.tax_report_start start_at
 cross join private.tax_revision r where o.created_at>=start_at.starts_at
 and not exists(select from private.tax_order_reports j where j.order_id=o.id)
 on conflict(order_id) do nothing;
 -- Republish a pending review when its supporting rules change. Completed amounts
 -- remain evidence of the rules used at the time. Changed order facts always need a new report.
 update private.tax_order_reports j set result=null,checked_at=null,attempts=0,lease=null,available_at=now(),
    input_hash=private.tax_report_input_hash(o),rule_revision=r.revision
 from public.orders o,private.tax_revision r where j.order_id=o.id and
    (j.input_hash<>private.tax_report_input_hash(o) or (j.result->>'status'='review' and j.rule_revision<>r.revision));
end $$;
revoke all on function private.queue_new_order_reports() from public,anon,authenticated;

create function public.claim_new_order_tax_reports() returns table(order_id bigint,lease uuid)
language sql security definer set search_path='' as $$
 with candidate as (
   select j.order_id from private.tax_order_reports j where j.available_at<=clock_timestamp()
    order by j.available_at,j.order_id limit 4 for update skip locked
 ) update private.tax_order_reports j set lease=gen_random_uuid(),available_at=now()+interval '2 minutes',attempts=j.attempts+1
 from candidate c where c.order_id=j.order_id returning j.order_id,j.lease
$$;
revoke all on function public.claim_new_order_tax_reports() from public,anon,authenticated;
grant execute on function public.claim_new_order_tax_reports() to service_role;

create function private.tax_report_calculation_inputs(p_order bigint)
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
 with required as (
   select s.state,'policy'::text kind,'state'::text subject,null::text sku,null::text title,null::text metal,null::numeric weight from private.tax_states s
   union all select s.state,'product',p.id::text,p.sku,p.name,p.metal::text,p.metal_weight_oz from private.tax_states s cross join public.products p where p.is_active
 ), reviewed as materialized (select q.*,private.tax_version(q.state,q.kind,q.subject,sale_day) v from required q)
 select count(*) into missing from reviewed where v->>'approval' is distinct from 'approved'
    or not coalesce(sale_day between (v->>'valid_from')::date and (v->>'valid_until')::date,false)
    or not coalesce((v->>'verified_on')::date<=sale_day,false)
    or (kind='product' and (coalesce(v->>'treatment','') not in ('eligible','taxable')
      or (v->>'catalog_sku',v->>'catalog_name',v->>'metal',(v->>'catalog_weight')::numeric) is distinct from (sku,title,metal,weight)));
 if missing>0 or (select count(*) from private.tax_states)<>51 or not exists(select from public.products where is_active) then
   return jsonb_build_object('review','Nationwide rules and product reviews are incomplete for this order date.','day',sale_day);end if;
 if profile.registration='Registered' and coalesce(profile.effective,profile.active_confirmed_on)<=sale_day
    and coalesce(profile.collect_from,profile.active_confirmed_on)<=sale_day then collection:='collect';
 elsif policy->>'no_general_collection_regime'='true' and state_code in ('DE','NH','OR') then collection:='no_obligation';
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

create function public.new_order_tax_inputs(p_order bigint,p_lease uuid) returns jsonb stable language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from private.tax_order_reports j where j.order_id=p_order and j.lease=p_lease and j.available_at>clock_timestamp())
    then raise exception 'Report lease expired';end if;
 return private.tax_report_calculation_inputs(p_order);
end $$;
revoke all on function public.new_order_tax_inputs(bigint,uuid) from public,anon,authenticated;
grant execute on function public.new_order_tax_inputs(bigint,uuid) to service_role;

create function public.finish_new_order_tax_report(p_order bigint,p_lease uuid,p_result jsonb,p_retry boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare j private.tax_order_reports; o public.orders; revision_at_finish bigint;
begin
 select * into j from private.tax_order_reports where order_id=p_order and lease=p_lease and available_at>clock_timestamp() for update;
 if not found then return false;end if;
 select * into strict o from public.orders where id=p_order;
 select revision into strict revision_at_finish from private.tax_revision;
 if j.input_hash<>private.tax_report_input_hash(o) or j.rule_revision<>revision_at_finish then
   update private.tax_order_reports set input_hash=private.tax_report_input_hash(o),rule_revision=revision_at_finish,
     lease=null,attempts=0,result=null,available_at=now(),checked_at=null where order_id=p_order;
   return false;
 end if;
 if p_retry is null or coalesce(p_result->>'status','') not in ('review','recorded','calculated')
    or (p_result->>'status'='review' and (p_result?'tax' or length(coalesce(p_result->>'reason',''))=0))
    or (p_result->>'status'<>'review' and (p_retry or coalesce(p_result->>'tax','') !~ '^[0-9]{1,15}$'))
    then raise exception 'Invalid tax report';end if;
 update private.tax_order_reports set result=p_result,checked_at=now(),lease=null,
   available_at=case when p_retry then now()+least(interval '6 hours',interval '1 minute'*power(2,least(j.attempts,9))) else 'infinity' end
   where order_id=p_order;
 return true;
end $$;
revoke all on function public.finish_new_order_tax_report(bigint,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finish_new_order_tax_report(bigint,uuid,jsonb,boolean) to service_role;

-- Both new-order estimates and untouched older assessed sales feed the same period CSV.
alter function private.tax_admin_order_rows(date,date) rename to tax_original_order_rows;
create function private.tax_admin_order_rows(period_start date,period_end date)
returns table(order_id bigint,order_number text,state text,paid_on date,payment_status text,merchandise bigint,customer_total bigint,
 recorded_tax bigint,calculated_tax bigint,taxable bigint,exempt bigint,breakdown jsonb,review_reason text)
stable language sql set search_path='' as $$
 select r.order_id,r.order_number,r.state,r.paid_on,r.payment_status,r.merchandise,r.customer_total,r.recorded_tax,
  case when j.result->>'status' in ('recorded','calculated') then (j.result->>'tax')::bigint else r.calculated_tax end,
  coalesce((j.result->>'taxable')::bigint,r.taxable),coalesce((j.result->>'exempt')::bigint,r.exempt),coalesce(j.result->'breakdown',r.breakdown),
  case when j.result->>'status' in ('recorded','calculated') then null else coalesce(j.result->>'reason',r.review_reason) end
 from private.tax_original_order_rows(period_start,period_end) r join public.orders o on o.id=r.order_id
 left join private.tax_order_reports j on j.order_id=r.order_id and j.input_hash=private.tax_report_input_hash(o)
$$;
revoke all on function private.tax_admin_order_rows(date,date) from public,anon,authenticated;

create function public.tax_admin_new_orders(p_actor uuid,p_from date,p_to date,p_before bigint default null)
returns jsonb stable language plpgsql security definer set search_path='' as $$
declare report jsonb;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_before<=0 then raise exception 'Invalid period or cursor';end if;
 with batch as (
  select o.id,o.order_number,o.created_at,case when o.shipping_address->>'fulfillment'='pickup' then 'NY'
   else private.tax_admin_state(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}')) end as state,
   j.result,j.checked_at from public.orders o cross join private.tax_report_start s left join lateral
     (select q.result,q.checked_at from private.tax_order_reports q where q.order_id=o.id and q.input_hash=private.tax_report_input_hash(o)) j on true
   where o.created_at>=greatest(s.starts_at,p_from::timestamp at time zone 'America/New_York')
   and o.created_at<(p_to+1)::timestamp at time zone 'America/New_York' and (p_before is null or o.id<p_before)
   order by o.id desc limit 26
 ), visible as (select * from batch order by id desc limit 25)
 select jsonb_build_object('starts_at',(select starts_at from private.tax_report_start),
   'orders',coalesce(jsonb_agg(to_jsonb(v) order by id desc),'[]'),'next',case when (select count(*) from batch)>25 then min(id) end) into report from visible v;
 return report;
end $$;
revoke all on function public.tax_admin_new_orders(uuid,date,date,bigint) from public,anon,authenticated;
grant execute on function public.tax_admin_new_orders(uuid,date,date,bigint) to service_role;

create or replace function public.tax_admin_calculation_inputs(p_actor uuid,p_order bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cached jsonb;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 if not exists(select from public.orders where id=p_order and paid_at is not null) then raise exception 'Paid order unavailable';end if;
 select j.result into cached from private.tax_order_reports j join public.orders o on o.id=j.order_id
 where j.order_id=p_order and j.input_hash=private.tax_report_input_hash(o);
 if cached is not null then return jsonb_build_object('report',cached);end if;
 return private.tax_report_calculation_inputs(p_order);
end $$;

-- Scheduler authentication is independent of store payments and email.
do $$begin
 if not exists(select from vault.secrets where name='gots_order_tax_worker') then
  perform vault.create_secret(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
      'gots_order_tax_worker','Private order tax reporting');
 end if;
end $$;
create function public.valid_order_tax_worker_token(p_token text) returns boolean stable language sql security definer set search_path='' as $$
 select coalesce((select sha256(convert_to(p_token,'UTF8'))=sha256(convert_to(decrypted_secret,'UTF8'))
   from vault.decrypted_secrets where name='gots_order_tax_worker'),false)
$$;
revoke all on function public.valid_order_tax_worker_token(text) from public,anon,authenticated;
grant execute on function public.valid_order_tax_worker_token(text) to service_role;
create function private.dispatch_new_order_tax() returns void language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('gots.new.order.tax.report',0)) then return;end if;
 perform private.queue_new_order_reports();
 if not exists(select from private.tax_order_reports where available_at<=clock_timestamp()) then return;end if;
 select decrypted_secret into strict token from vault.decrypted_secrets where name='gots_order_tax_worker';
 perform net.http_post(url:='https://goldonthespot.com/api/operations/order-tax',
  headers:=jsonb_build_object('content-type','application/json','x-order-tax-token',token),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function private.dispatch_new_order_tax() from public,anon,authenticated;
select cron.schedule('gots-new-order-tax','* * * * *','select private.dispatch_new_order_tax()');
