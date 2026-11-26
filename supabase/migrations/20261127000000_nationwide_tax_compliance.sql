-- Preview migration. Install on an isolated database. New orders require a server assessment.
create schema if not exists private;
create table private.tax_states (
 state text primary key check(state ~ '^[A-Z]{2}$'), physical boolean not null default false,
 disabled boolean not null default false, registration text not null default 'Requires Legal Review',
 effective date, frequency text, registration_due date, collect_from date, note text not null default ''
);
insert into private.tax_states(state,physical) select s,s='NY' from unnest(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' ')) s;
create table private.tax_revision(id boolean primary key default true check(id), revision bigint not null default 1);
insert into private.tax_revision default values;
create table private.tax_versions (
 id bigint generated always as identity primary key, state text not null references private.tax_states,
 kind text not null check(kind in ('policy','address','product','nexus')), subject text not null,
 valid_from date not null, valid_until date not null, verified_on date not null,
 source text not null check(source like 'https://%'), approval text not null check(approval in ('approved','requires_review')),
 data jsonb not null check(jsonb_typeof(data)='object'), actor uuid not null, created_at timestamptz not null default now(),
 check(valid_until>=valid_from), unique(state,kind,subject,valid_from,id)
);
create index tax_version_lookup on private.tax_versions(state,kind,subject,valid_from desc,id desc);
create table private.tax_assessments (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.checkout_quotes,
 user_id uuid not null, address jsonb not null, method text not null, fulfillment text not null,
 result jsonb not null, revision bigint not null, created_at timestamptz not null default now()
);
alter table public.orders add column tax_assessment_id uuid unique references private.tax_assessments, add column tax_amount numeric(14,2);
grant select(tax_amount) on public.orders to authenticated;
create table private.tax_ledger (
 event_key text primary key, state text not null references private.tax_states, order_id bigint references public.orders,
 booked date not null, kind text not null check(kind in ('sale','refund','remittance','adjustment')),
 channel text not null default 'direct', merchandise bigint not null, taxable bigint, exempt bigint, tax bigint,
 breakdown jsonb not null default '[]', seller_taxes jsonb not null default '[]', confirmation text, created_at timestamptz not null default now()
);
create index tax_ledger_period on private.tax_ledger(state,booked);
create table private.tax_filings (
 id bigint generated always as identity primary key, state text not null references private.tax_states,
 starts date not null, ends date not null, due date not null, confirmation text, filed date, reported bigint,
 paid bigint, paid_on date, payment_reference text, payment_method text, check(ends>=starts),check(due>=ends),
 check ((filed is null and confirmation is null and reported is null) or (filed is not null and length(trim(confirmation))>0 and reported>=0)),
 check ((paid is null and paid_on is null) or (paid>=0 and paid_on is not null and length(trim(payment_reference))>0)),
 unique(state,starts,ends)
);
create table private.tax_alerts(event_key text primary key, state text references private.tax_states, message text not null, created_at timestamptz not null default now(), emailed_at timestamptz);
create table private.tax_audit(id bigint generated always as identity primary key,actor uuid not null,action text not null,state text not null,details jsonb not null,created_at timestamptz not null default now());
create table private.tax_sources(url text primary key,state text not null references private.tax_states, digest text, checked_at timestamptz,changed_at timestamptz);
revoke all on private.tax_states,private.tax_revision,private.tax_versions,private.tax_assessments,private.tax_ledger,private.tax_filings,private.tax_alerts,private.tax_sources,private.tax_audit from public,anon,authenticated;
create function private.tax_normalize_address(a jsonb) returns jsonb immutable language sql set search_path='' as $$
 select jsonb_object_agg(k,upper(btrim(coalesce(a->>k,'')))) from unnest(array['address_line_1','address_line_2','city','state','postal_code','country']) k
$$;
create function private.tax_version(s text,k text,sub text,d date) returns jsonb stable language sql set search_path='' as $$
 select v.data || jsonb_build_object('version',v.id,'state',v.state,'approval',v.approval,'source',v.source,'verified_on',v.verified_on,'valid_from',v.valid_from,'valid_until',v.valid_until)
 from private.tax_versions v where v.state=s and v.kind=k and v.subject=sub and v.valid_from<=d order by v.valid_from desc,v.id desc limit 1
$$;
create function public.tax_quote_inputs(p_user uuid,p_quote uuid,p_address jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',r.revision,'day',d.asof_date,'quote',jsonb_build_object('subtotal',q.subtotal,'shipping_amount',q.shipping_amount,'card_surcharge',q.card_surcharge,'line_items',q.line_items),
 'policy',private.tax_version(s.state,'policy','state',d.asof_date) || jsonb_build_object('shipping_disabled',s.disabled,'registration',s.registration,'collection',
 case when s.registration='Registered' and s.effective<=d.asof_date and s.collect_from<=d.asof_date then 'collect' when s.registration='No Current Obligation' and not s.physical then 'no_obligation' else 'review' end),
 'address',private.tax_version(s.state,'address',private.tax_normalize_address(p_address)::text,d.asof_date),
 'products',(select jsonb_object_agg(i->>'product_id',private.tax_version(s.state,'product',i->>'product_id',d.asof_date)) from jsonb_array_elements(q.line_items) i))
 from public.checkout_quotes q join private.tax_states s on s.state=p_address->>'state' cross join private.tax_revision r
 cross join (select (clock_timestamp() at time zone 'America/New_York')::date as asof_date) d
 where q.id=p_quote and q.user_id=p_user and q.status='active' and q.expires_at>clock_timestamp()
$$;
create function public.store_tax_assessment(p_user uuid,p_quote uuid,p_address jsonb,p_method text,p_fulfillment text,p_result jsonb,p_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; begin
 perform 1 from private.tax_revision where revision=p_revision for share;
 if not found then raise exception 'Review changed';end if;
 perform 1 from public.checkout_quotes where id=p_quote and user_id=p_user and status='active' and expires_at>clock_timestamp() for share;
 if not found then raise exception 'Refresh the price lock';end if;
 insert into private.tax_assessments(quote_id,user_id,address,method,fulfillment,result,revision)
 values(p_quote,p_user,private.tax_normalize_address(p_address),p_method,p_fulfillment,p_result,p_revision) returning id into result_id;
 return result_id;
end $$;
CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quote public.checkout_quotes%rowtype;
  v_order_id bigint;
  assessment private.tax_assessments;
  tax numeric(14,2);
  v_order_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_surcharge numeric(14,2);
  v_total numeric(14,2);
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'A valid customer account is required';
  end if;
  if p_payment_method not in ('wire', 'card', 'crypto', 'ach') then raise exception 'Unsupported payment method'; end if;
  if coalesce(p_contact ->> 'first_name', '') = '' or coalesce(p_contact ->> 'last_name', '') = ''
     or coalesce(p_contact ->> 'email', '') = '' or coalesce(p_contact ->> 'phone', '') = '' then
    raise exception 'Complete contact information is required';
  end if;
  if coalesce(p_shipping ->> 'address_line_1', '') = '' or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'state', '') = '' or coalesce(p_shipping ->> 'postal_code', '') = '' then
    raise exception 'A complete shipping address is required';
  end if;

  select * into v_quote
  from public.checkout_quotes
  where id = p_quote_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Checkout quote not found'; end if;
  if v_quote.status <> 'active' or now() >= v_quote.expires_at then
    update public.checkout_quotes set status = 'expired', updated_at = now() where id = p_quote_id;
    raise exception 'The price lock expired. Review the refreshed total and try again.';
  end if;

  if p_shipping->>'fulfillment'='pickup' then
    v_quote.shipping_amount:=0;
    if p_shipping->>'postal_code' is distinct from '10016' or p_shipping->>'address_line_1' is distinct from '149 Madison Avenue' then raise exception 'Invalid pickup office';end if;
  end if;
  v_surcharge := case when p_payment_method = 'card' then v_quote.card_surcharge when p_payment_method = 'ach' then round(v_quote.subtotal * 0.02, 2) else 0 end;
  v_total := round(v_quote.subtotal + v_quote.shipping_amount + v_surcharge, 2);
  select a.* into assessment from private.tax_assessments a join private.tax_revision r on r.revision=a.revision
   where a.id=(p_shipping->>'tax_assessment_id')::uuid and a.quote_id=p_quote_id and a.user_id=p_user_id
   and a.address=private.tax_normalize_address(p_shipping) and a.method=p_payment_method
   and a.fulfillment=coalesce(p_shipping->>'fulfillment','delivery')
   and a.result->>'day'=(clock_timestamp() at time zone 'America/New_York')::date::text for share of r;
  if not found then raise exception 'Review the tax and total for this address and payment method.' using errcode='P2005';end if;
  if private.tax_collection_gate(assessment.result->>'state',
    private.tax_version(assessment.result->>'state','policy','state',(assessment.result->>'day')::date) ||
    jsonb_build_object('collection',assessment.result->>'collection'),(assessment.result->>'day')::date)='review' then
    raise exception 'The collection obligation needs review.' using errcode='P2005';end if;
  tax:=(assessment.result->>'tax')::bigint/100.0;
  v_total:=v_total+tax;
  if v_total*100 is distinct from (assessment.result->>'total')::bigint then raise exception 'Refresh the tax calculation.' using errcode='P2005';end if;
  if assessment.result->>'state'='NY' and (assessment.result->>'exempt')::bigint>0 and
     p_shipping->'investment_purchase' is distinct from 'true'::jsonb then
    raise exception 'Confirm the investment purchase agreement.' using errcode='P2005';
  end if;
  p_shipping:=p_shipping-'tax_assessment_id'-'investment_purchase';
  if p_payment_method='ach' and v_total > 25000 then raise exception 'ACH maximum is $25,000 including fees' using errcode='P2005'; end if;
  v_order_number := private.next_customer_order_number();

  insert into public.orders (
    tax_assessment_id, tax_amount, order_number, user_id, first_name, last_name, email, phone, payment_method,
    subtotal, payment_surcharge, shipping_amount, total, spot_snapshot,
    price_locked_until, shipping_address, customer_notes
  ) values (
    assessment.id, tax, v_order_number, p_user_id, p_contact ->> 'first_name', p_contact ->> 'last_name',
    lower(p_contact ->> 'email'), p_contact ->> 'phone', p_payment_method,
    v_quote.subtotal, v_surcharge, v_quote.shipping_amount, v_total,
    v_quote.spot_snapshot, v_quote.expires_at, p_shipping, nullif(trim(p_notes), '')
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_quote.line_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::bigint and is_active
    for update;
    if not found then raise exception 'A product is unavailable'; end if;
    if v_product.inventory_count < v_quantity then raise exception '% does not have enough inventory', v_product.name; end if;

    insert into public.order_items (
      order_id, product_id, sku, product_name, metal, metal_weight_oz,
      quantity, unit_price, line_total, pricing_snapshot
    ) values (
      v_order_id, v_product.id, v_item ->> 'sku', v_item ->> 'product_name',
      v_item ->> 'metal', (v_item ->> 'metal_weight_oz')::numeric,
      v_quantity, (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'line_total')::numeric, v_item -> 'pricing_snapshot'
    );
    update public.products set inventory_count = inventory_count - v_quantity where id = v_product.id;
  end loop;

  update public.checkout_quotes set status = 'used', updated_at = now() where id = p_quote_id;

  return jsonb_build_object(
    'order_id', v_order_id, 'tax_amount',tax,
    'order_number', v_order_number,
    'subtotal', v_quote.subtotal,
    'shipping', v_quote.shipping_amount,
    'surcharge', v_surcharge,
    'total', v_total,
    'price_locked_until', v_quote.expires_at
  );
end;
$function$
;
create function private.tax_protect_order() returns trigger language plpgsql set search_path='' as $$
begin
 if old.tax_assessment_id is not null and
 (new.tax_assessment_id,new.subtotal,new.shipping_amount,new.payment_method,new.payment_surcharge,new.tax_amount,new.total,new.shipping_address,new.price_locked_until)
 is distinct from (old.tax_assessment_id,old.subtotal,old.shipping_amount,old.payment_method,old.payment_surcharge,old.tax_amount,old.total,old.shipping_address,old.price_locked_until)
 then raise exception 'This change needs a new checkout and tax assessment.' using errcode='P2005';end if;
 return new;
end $$;
create trigger tax_preserve_order before update on public.orders for each row execute function private.tax_protect_order();
create function private.tax_record_settlement() returns trigger language plpgsql security definer set search_path='' as $$
declare a jsonb; sale_date date;begin
 if new.payment_status is not distinct from old.payment_status or new.payment_status not in ('paid','refunded') then return new;end if;
 if new.tax_assessment_id is null then
  insert into private.tax_alerts(event_key,message) values('legacy:'||new.id||':'||new.payment_status,'Review a legacy order with no tax assessment.') on conflict do nothing;return new;
 end if;
 select result into strict a from private.tax_assessments where id=new.tax_assessment_id;
 sale_date:=(clock_timestamp() at time zone 'America/New_York')::date;
 if new.payment_status='paid' then
 insert into private.tax_ledger(event_key,state,order_id,booked,kind,merchandise,taxable,exempt,tax,breakdown,seller_taxes)
 values('paid:'||new.id,a->>'state',new.id,sale_date,'sale',(a->>'subtotal')::bigint,(a->>'taxable')::bigint,(a->>'exempt')::bigint,(a->>'tax')::bigint,a->'breakdown',coalesce(a->'seller_taxes','[]')) on conflict do nothing;
 else
 insert into private.tax_alerts(event_key,state,message) values('refund:'||new.id,a->>'state','Reconcile provider-confirmed refunded line amounts and tax before posting a credit.') on conflict do nothing;
 end if;return new;
end $$;
create trigger tax_order_settlement after update of payment_status on public.orders for each row execute function private.tax_record_settlement();
create function public.tax_admin_overview(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'states',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('period',coalesce(t.amounts,'{}'::jsonb))) from private.tax_states s left join lateral (
 select jsonb_build_object('merchandise',sum(merchandise),'taxable',sum(taxable),'exempt',sum(exempt),'tax',sum(tax) filter(where kind<>'remittance'),'remitted',-sum(tax) filter(where kind='remittance'),'transactions',count(*) filter(where kind='sale')) amounts from private.tax_ledger l where l.state=s.state and l.booked between p_from and p_to) t on true),
 'filings',coalesce((select jsonb_agg(f order by due) from private.tax_filings f),'[]'),
 'alerts',coalesce((select jsonb_agg(a order by created_at desc) from (select * from private.tax_alerts order by created_at desc limit 100) a),'[]'),
 'legacy_orders',(select count(*) from public.orders where tax_assessment_id is null and payment_status='paid'),
 'as_of',now())
$$;
create function public.tax_admin_change(p_actor uuid,p_state text,p_action text,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare f private.tax_filings; begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) then raise exception 'Admin required';end if;
 perform 1 from private.tax_states where state=p_state for update;
 if not found then raise exception 'Invalid state';end if;
 if p_action='settings' then
 if p_data->>'registration' not in ('Registered','Registration Pending','Registration Required','No Current Obligation','Requires Legal Review') or p_data->>'registration' is null then raise exception 'Invalid registration';end if;
 if (p_data->>'registration'='No Current Obligation' and (select physical from private.tax_states where state=p_state)) then raise exception 'Physical nexus requires review';end if;
 update private.tax_states set disabled=(p_data->>'disabled')::boolean,registration=p_data->>'registration',effective=nullif(p_data->>'effective','')::date,
 collect_from=nullif(p_data->>'collect_from','')::date,frequency=nullif(p_data->>'frequency',''),registration_due=nullif(p_data->>'registration_due','')::date,note=left(coalesce(p_data->>'note',''),3000) where state=p_state;
 update private.tax_revision set revision=revision+1;
 elsif p_action='schedule' then
 insert into private.tax_filings(state,starts,ends,due) values(p_state,(p_data->>'starts')::date,(p_data->>'ends')::date,(p_data->>'due')::date) on conflict(state,starts,ends) do nothing;
 elsif p_action='file' then
 update private.tax_filings set confirmation=nullif(trim(p_data->>'confirmation'),''),filed=(p_data->>'filed')::date,reported=(p_data->>'reported')::bigint where id=(p_data->>'id')::bigint and state=p_state and filed is null returning * into strict f;
 if f.confirmation is null or f.filed is null or f.reported is null then raise exception 'Actual filing confirmation required';end if;
 elsif p_action='remit' then
 update private.tax_filings set paid=(p_data->>'paid')::bigint,paid_on=(p_data->>'paid_on')::date,payment_reference=nullif(trim(p_data->>'payment_reference'),''),payment_method=nullif(trim(p_data->>'payment_method'),'') where id=(p_data->>'id')::bigint and state=p_state and filed is not null and paid is null returning * into strict f;
 if f.paid is null or f.paid_on is null or f.payment_reference is null or f.payment_method is null then raise exception 'Actual payment confirmation required';end if;
 insert into private.tax_ledger(event_key,state,booked,kind,merchandise,taxable,exempt,tax,confirmation) values('remit:'||f.id,p_state,f.paid_on,'remittance',0,0,0,-f.paid,f.payment_reference);
 else raise exception 'Invalid action';end if;
 insert into private.tax_audit(actor,action,state,details) values(p_actor,p_action,p_state,p_data);
end $$;
do $$ declare fn regprocedure;begin
 foreach fn in array array['public.tax_quote_inputs(uuid,uuid,jsonb)'::regprocedure,'public.store_tax_assessment(uuid,uuid,jsonb,text,text,jsonb,bigint)'::regprocedure,'public.tax_admin_overview(date,date)'::regprocedure,'public.tax_admin_change(uuid,text,text,jsonb)'::regprocedure] loop
 execute format('revoke all on function %s from public,anon,authenticated',fn);
 execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
create function public.tax_publish_version(p_actor uuid,p_state text,p_kind text,p_subject text,p_data jsonb,p_source text,p_start date,p_end date,p_verified date,p_approval text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint; begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) then raise exception 'Admin required';end if;
 if p_verified>(now() at time zone 'America/New_York')::date or p_end<p_start then raise exception 'Invalid dates';end if;
 insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval,actor)
 values(p_state,p_kind,case when p_kind='address' then private.tax_normalize_address(p_subject::jsonb)::text else p_subject end,p_data,p_source,p_start,p_end,p_verified,p_approval,p_actor) returning id into v;
 update private.tax_revision set revision=revision+1;
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'rule_version',p_state,jsonb_build_object('version',v,'approval',p_approval));
 return v;
end $$;
create function public.tax_period_rows(p_state text,p_from date,p_to date) returns setof private.tax_ledger language sql stable security definer set search_path='' as $$
 select l.* from private.tax_ledger l where l.state=p_state and booked between p_from and p_to order by booked,event_key
$$;
create function public.tax_import_sale(p_actor uuid,p_state text,p_reference text,p_channel text,p_date date,p_merchandise bigint,p_taxable bigint,p_exempt bigint,p_tax bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) or p_channel not in ('marketplace','external_direct') or length(trim(p_reference)) not between 1 and 120 or least(p_merchandise,p_taxable,p_exempt,p_tax)<0 or p_taxable+p_exempt<>p_merchandise then raise exception 'Invalid external sale';end if;
 insert into private.tax_ledger(event_key,state,booked,kind,channel,merchandise,taxable,exempt,tax)
 values('external:'||p_channel||':'||p_reference,p_state,p_date,'sale',p_channel,p_merchandise,p_taxable,p_exempt,p_tax);
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'import_sale',p_state,jsonb_build_object('reference',p_reference));
end $$;
-- Compare calendar years independently. A previous-year hit still counts.
create function private.tax_threshold_progress(s text,d date) returns jsonb stable language plpgsql set search_path='' as $$
declare rule jsonb:=private.tax_version(s,'nexus','state',d); periods daterange[]; span daterange;
 yr date:=date_trunc('year',d)::date; quarter_start date; amount bigint;n bigint; revenue_target bigint;count_target bigint;
 revenue_pct numeric;count_pct numeric;pct numeric;highest numeric:=0;hit boolean:=false; amounts jsonb:='[]';begin
 if rule is null or rule->>'approval'<>'approved' or (rule->>'valid_until')::date<d then return null;end if;
 revenue_target:=(rule->>'revenue_trigger_cents')::bigint;count_target:=(rule->>'transaction_trigger')::bigint;
 if rule->>'period'='current_or_prior_calendar' then periods:=array[daterange(yr,d+1),daterange((yr-interval '1 year')::date,yr)];
 elsif rule->>'period'='rolling_12_months' then periods:=array[daterange(((d+1)-interval '12 months')::date,d+1)];
 elsif rule->>'period'='ny_four_completed_quarters' then quarter_start:=(date_trunc('quarter',d+interval '1 month')-interval '1 month')::date;periods:=array[daterange((quarter_start-interval '1 year')::date,quarter_start)];
 else return null;end if;
 foreach span in array periods loop
 select coalesce(sum(case when rule->>'base'='taxable' then taxable else merchandise end),0),count(*) filter(where kind='sale') into amount,n from private.tax_ledger
 where state=s and booked <@ span and (kind='sale' or (kind='refund' and rule->>'deduct_refunds'='true')) and (channel<>'marketplace' or rule->>'include_marketplace'='true');
 revenue_pct:=100.0*amount/nullif(revenue_target,0);count_pct:=100.0*n/nullif(count_target,0);
 pct:=case when rule->>'operator'='and' then least(revenue_pct,count_pct) else greatest(revenue_pct,count_pct) end;
 highest:=greatest(highest,pct);hit:=hit or pct>=100;
 amounts:=amounts||jsonb_build_array(jsonb_build_object('from',lower(span),'to',upper(span)-1,'sales_cents',amount,'transactions',n));
 end loop;
 return jsonb_build_object('version',rule->'version','percentage',round(highest,2),'reached',hit,'periods',amounts,'revenue_trigger_cents',revenue_target,'transaction_trigger',count_target);
end $$;
create function public.tax_state_profile(p_state text,p_day date) returns jsonb stable security definer language sql set search_path='' as $$
 select jsonb_build_object('nexus',private.tax_threshold_progress(p_state,p_day),'rules',coalesce((select jsonb_agg(to_jsonb(v)-'actor' order by v.id desc) from private.tax_versions v where state=p_state),'[]'),
 'sales_years',coalesce((select jsonb_object_agg(yr,x) from (select extract(year from booked)::int yr,jsonb_build_object('sales_cents',sum(merchandise),'transactions',count(*) filter(where kind='sale')) x from private.tax_ledger where state=p_state and kind in ('sale','refund') and booked between (date_trunc('year',p_day)-interval '1 year')::date and p_day group by 1) y),'{}'),
 'history',coalesce((select jsonb_agg(to_jsonb(z)-'actor') from (select * from private.tax_audit where state=p_state order by id desc limit 50) z),'[]'))
$$;
create function public.tax_deadline_scan(p_day date) returns void language plpgsql security definer set search_path='' as $$
declare s private.tax_states; p jsonb; mark int; begin
 insert into private.tax_alerts(event_key,state,message)
 select 'filing:'||id||':'||case when due<p_day then 'overdue' else (due-p_day)::text end,state,case when due<p_day then 'Filing overdue' else 'Filing due in '||(due-p_day)||' days' end
 from private.tax_filings where filed is null and (due<p_day or due-p_day in(30,14,7,1,0)) on conflict do nothing;
 insert into private.tax_alerts(event_key,state,message) select 'payment:'||id,state,'Payment remains outstanding' from private.tax_filings where filed is not null and coalesce(paid,0)<reported on conflict do nothing;
 insert into private.tax_alerts(event_key,state,message) select 'expiry:'||id,state,'A reviewed tax rule is expiring or has expired.' from private.tax_versions where approval='approved' and valid_until between p_day-1 and p_day+7 on conflict do nothing;
 for s in select * from private.tax_states loop
 p:=private.tax_threshold_progress(s.state,p_day);if p is not null then
 foreach mark in array array[50,75,90,100] loop
 if (p->>'percentage')::numeric>=mark then insert into private.tax_alerts(event_key,state,message)
 values('nexus:'||s.state||':'||(p->>'version')||':'||extract(year from p_day)||':'||mark,s.state,'Reviewed nexus threshold reached '||mark||'%') on conflict do nothing;end if;
 end loop;end if;
 if s.registration_due<=p_day+30 and s.registration<>'Registered' then insert into private.tax_alerts(event_key,state,message) values('register:'||s.state||':'||s.registration_due,s.state,'Review registration before '||s.registration_due) on conflict do nothing;end if;
 end loop;
end $$;
create function public.tax_source_observation(p_state text,p_url text,p_digest text,p_day date) returns void language plpgsql security definer set search_path='' as $$
declare previous text;begin
 if p_digest is null then insert into private.tax_alerts(event_key,state,message) values('source-unavailable:'||p_url||':'||p_day,p_state,'Government source unavailable: '||p_url) on conflict do nothing;return;end if;
 select digest into previous from private.tax_sources where url=p_url for update;
 insert into private.tax_sources(url,state,digest,checked_at,changed_at) values(p_url,p_state,p_digest,now(),null)
 on conflict(url) do update set digest=excluded.digest,checked_at=now(),changed_at=case when excluded.digest<>private.tax_sources.digest then now() else private.tax_sources.changed_at end;
 if previous is not null and previous<>p_digest then insert into private.tax_alerts(event_key,state,message) values('source-change:'||p_url||':'||p_digest,p_state,'Government source changed; review the applicable rule: '||p_url) on conflict do nothing;end if;
end $$;
do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'tax\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',fn);execute format('grant execute on function %s to service_role',fn);end loop;
end $$;
-- Return one scalar array for CSV exports so the REST row cap cannot truncate a filing.
create function public.tax_report_rows(p_state text,p_from date,p_to date) returns jsonb stable security definer language sql set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.booked,r.event_key),'[]') from public.tax_period_rows(p_state,p_from,p_to) r
$$;
revoke all on function public.tax_report_rows(text,date,date) from public,anon,authenticated;
grant execute on function public.tax_report_rows(text,date,date) to service_role;
create function public.tax_monitor_sources() returns jsonb stable security definer language sql set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select distinct state,source from private.tax_versions where valid_until>=current_date and approval='approved') s
$$;
revoke all on function public.tax_monitor_sources() from public,anon,authenticated;
grant execute on function public.tax_monitor_sources() to service_role;
-- Historical orders are reconciled independently. Missing taxes are unknown, never inferred as zero.
create function public.tax_refund_entry(p_actor uuid,p_state text,p_order bigint,p_reference text,p_date date,p_merchandise bigint,p_taxable bigint,p_exempt bigint,p_components jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare sale private.tax_ledger; used_row record; component jsonb; original jsonb; prior bigint; tax_total bigint:=0;begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) or nullif(trim(p_reference),'') is null or length(p_reference)>120 or p_date is null or
 p_merchandise is null or p_taxable is null or p_exempt is null or least(p_merchandise,p_taxable,p_exempt)<0 or p_taxable+p_exempt<>p_merchandise or jsonb_typeof(p_components) is distinct from 'array' then raise exception 'Invalid refund evidence';end if;
 select * into strict sale from private.tax_ledger where state=p_state and order_id=p_order and kind='sale' for update;
 if p_date<sale.booked or p_date>current_date then raise exception 'Invalid refund date';end if;
 select -coalesce(sum(taxable),0) taxable,-coalesce(sum(exempt),0) exempt into used_row from private.tax_ledger where order_id=p_order and kind='refund';
 if p_taxable+used_row.taxable>sale.taxable or p_exempt+used_row.exempt>sale.exempt then raise exception 'Refund exceeds remaining merchandise';end if;
 if exists(select 1 from jsonb_array_elements(p_components) c group by c->>'code' having count(*)>1) then raise exception 'Duplicate jurisdiction';end if;
 for component in select * from jsonb_array_elements(p_components) loop
 select c into strict original from jsonb_array_elements(sale.breakdown) c where c->>'code'=component->>'code';
 select -coalesce(sum((b->>'cents')::bigint),0) into prior from private.tax_ledger l cross join lateral jsonb_array_elements(l.breakdown) b where l.order_id=p_order and l.kind='refund' and b->>'code'=component->>'code';
 if not(component ? 'cents') or (component->>'cents')::bigint<0 or (component->>'cents')::bigint+prior>(original->>'cents')::bigint then raise exception 'Refund exceeds original jurisdiction tax';end if;
 tax_total:=tax_total+(component->>'cents')::bigint;
 end loop;
 insert into private.tax_ledger(event_key,state,order_id,booked,kind,merchandise,taxable,exempt,tax,confirmation,breakdown)
 values('refund:'||p_order||':'||p_reference,p_state,p_order,p_date,'refund',-p_merchandise,-p_taxable,-p_exempt,-tax_total,p_reference,
 coalesce((select jsonb_agg(o||jsonb_build_object('cents',-(c->>'cents')::bigint)) from jsonb_array_elements(p_components)c join jsonb_array_elements(sale.breakdown)o on o->>'code'=c->>'code'),'[]'));
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'confirmed_refund',p_state,jsonb_build_object('order_id',p_order,'reference',p_reference));
end $$;
revoke all on function public.tax_refund_entry(uuid,text,bigint,text,date,bigint,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tax_refund_entry(uuid,text,bigint,text,date,bigint,bigint,bigint,jsonb) to service_role;

-- Generate calendar rows only when a registered NY seller has confirmed its assigned frequency.
-- Explicit office-confirmed deadlines are required where holidays move the statutory date.
create function public.tax_pending_email() returns jsonb security definer language sql set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select event_key,state,message,created_at from private.tax_alerts where emailed_at is null order by created_at,event_key limit 12)t
$$;
create function public.tax_ack_email(p_key text) returns void security definer language sql set search_path='' as $$
 update private.tax_alerts set emailed_at=coalesce(emailed_at,now()) where event_key=p_key
$$;
revoke all on function public.tax_pending_email(),public.tax_ack_email(text) from public,anon,authenticated;
grant execute on function public.tax_pending_email(),public.tax_ack_email(text) to service_role;

create function private.tax_source_revision() returns trigger language plpgsql set search_path='' as $$
begin if new.digest is distinct from old.digest then update private.tax_revision set revision=revision+1;end if;return new;end $$;
create trigger invalidate_changed_tax_source after update on private.tax_sources for each row execute function private.tax_source_revision();
create or replace function private.tax_version(s text,k text,sub text,d date) returns jsonb stable language sql set search_path='' as $$
 select v.data||jsonb_build_object('version',v.id,'state',v.state,'approval',case when src.changed_at>v.created_at then 'requires_review' else v.approval end,'source',v.source,'verified_on',v.verified_on,'valid_from',v.valid_from,'valid_until',v.valid_until)
 from private.tax_versions v left join private.tax_sources src on src.url=v.source
 where v.state=s and v.kind=k and v.subject=sub and v.valid_from<=d order by v.valid_from desc,v.id desc limit 1
$$;
create table private.tax_documents(id uuid primary key,state text not null references private.tax_states,kind text not null,display_name text not null,object_path text not null unique,actor uuid not null,created_at timestamptz not null default now());
revoke all on private.tax_documents from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('tax-compliance-private','tax-compliance-private',false,2097152,array['application/pdf','image/png','image/jpeg']);
create function public.tax_documents_for_state(p_state text) returns jsonb stable security definer language sql set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'kind',kind,'created_at',created_at) order by created_at desc),'[]') from private.tax_documents where state=p_state
$$;
create function public.tax_record_document(p_actor uuid,p_id uuid,p_state text,p_kind text,p_name text,p_path text) returns void security definer language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) or p_kind not in ('permit','filing','payment','exemption') then raise exception 'Invalid evidence';end if;
 insert into private.tax_documents values(p_id,p_state,p_kind,left(p_name,160),p_path,p_actor,now());
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'document',p_state,jsonb_build_object('kind',p_kind,'id',p_id));
end $$;
create function public.tax_document_path(p_id uuid,p_state text) returns text stable security definer language sql set search_path='' as $$
 select object_path from private.tax_documents where id=p_id and state=p_state
$$;
revoke all on function public.tax_documents_for_state(text),public.tax_record_document(uuid,uuid,text,text,text,text),public.tax_document_path(uuid,text) from public,anon,authenticated;
grant execute on function public.tax_documents_for_state(text),public.tax_record_document(uuid,uuid,text,text,text,text),public.tax_document_path(uuid,text) to service_role;
create table private.tax_calendar(state text not null references private.tax_states,frequency text not null,starts date not null,ends date not null,due date not null,source text not null,verified date not null,primary key(state,frequency,starts));
insert into private.tax_calendar values('NY','quarterly','2026-09-01','2026-11-30','2026-12-21','https://www.tax.ny.gov/forms/quarterly_filer_forms_st100_series.htm','2026-11-26');
create function public.tax_calendar_refresh() returns void security definer language sql set search_path='' as $$
 insert into private.tax_filings(state,starts,ends,due)
 select s.state,c.starts,c.ends,c.due from private.tax_states s join private.tax_calendar c on c.state=s.state and lower(s.frequency)=c.frequency
 where s.registration='Registered' and s.effective<=c.ends on conflict(state,starts,ends) do nothing
$$;
revoke all on function public.tax_calendar_refresh() from public,anon,authenticated;
grant execute on function public.tax_calendar_refresh() to service_role;
-- All three checks must survive signing the quote: live obligation, source review, current data.
create function private.tax_collection_gate(s text,p jsonb,d date) returns text stable language plpgsql set search_path='' as $$
declare nexus jsonb; begin
 if p->>'collection'='collect' then return 'collect';end if;
 if p->>'collection'='no_obligation' and s<>'NY' and p->>'history_reconciled'='true' then
  if p->>'no_general_collection_regime'='true' then return 'no_obligation';end if;
  nexus:=private.tax_threshold_progress(s,d);
  if nexus is not null and nexus->>'reached'='false' then return 'no_obligation';end if;
 end if;
 return 'review';
end $$;
alter function public.tax_quote_inputs(uuid,uuid,jsonb) rename to tax_base_quote_inputs;
create function public.tax_quote_inputs(p_user uuid,p_quote uuid,p_address jsonb) returns jsonb stable security definer language sql set search_path='' as $$
 select raw || jsonb_build_object('policy',(raw->'policy')||jsonb_build_object('collection',private.tax_collection_gate(p_address->>'state',raw->'policy',(raw->>'day')::date)))
 from (select public.tax_base_quote_inputs(p_user,p_quote,p_address) raw) q where raw is not null
$$;
revoke all on function public.tax_quote_inputs(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tax_quote_inputs(uuid,uuid,jsonb) to service_role;
-- Reuse the storefront pricing function inside a savepoint. Cart estimates
-- discard every quote write, including changes to any existing price lock.
create function public.tax_cart_inputs(p_user uuid,p_cart jsonb,p_spot jsonb,p_address jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb; result jsonb;begin
 begin
 q:=public.create_checkout_quote(p_user,p_cart,p_spot);
 result:=public.tax_quote_inputs(p_user,(q->>'quote_id')::uuid,p_address);
 raise exception using errcode='TAX01',message='discard estimate writes';
 exception when sqlstate 'TAX01' then null;
 end;
 return result;
end $$;
revoke all on function public.tax_cart_inputs(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.tax_cart_inputs(uuid,jsonb,jsonb,jsonb) to service_role;


-- Aggregate posted sales and confirmed refunds with the jurisdiction metadata preserved at checkout.
create function public.tax_period_components(p_state text,p_from date,p_to date) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(component || jsonb_build_object('cents',net) order by component->>'code'),'[]')
 from (
   select item-'cents' as component,sum((item->>'cents')::bigint) as net
   from public.tax_period_rows(p_state,p_from,p_to) r
   cross join lateral jsonb_array_elements(r.breakdown) item
   where r.kind in ('sale','refund')
   group by item-'cents'
 ) parts
$$;
revoke all on function public.tax_period_components(text,date,date) from public,anon,authenticated;
grant execute on function public.tax_period_components(text,date,date) to service_role;
