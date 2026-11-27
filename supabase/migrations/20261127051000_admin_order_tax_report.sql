-- Read-only reporting. Payment date selects the reporting period in New York time.
-- Refund status is reported separately; a status cannot establish a refund amount.
create function private.tax_admin_state(input_state text) returns text
language sql immutable set search_path='' as $$
 select code from (values
   ('AL','ALABAMA'),
   ('AK','ALASKA'),
   ('AZ','ARIZONA'),
   ('AR','ARKANSAS'),
   ('CA','CALIFORNIA'),
   ('CO','COLORADO'),
   ('CT','CONNECTICUT'),
   ('DE','DELAWARE'),
   ('DC','DISTRICT OF COLUMBIA'),
   ('FL','FLORIDA'),
   ('GA','GEORGIA'),
   ('HI','HAWAII'),
   ('ID','IDAHO'),
   ('IL','ILLINOIS'),
   ('IN','INDIANA'),
   ('IA','IOWA'),
   ('KS','KANSAS'),
   ('KY','KENTUCKY'),
   ('LA','LOUISIANA'),
   ('ME','MAINE'),
   ('MD','MARYLAND'),
   ('MA','MASSACHUSETTS'),
   ('MI','MICHIGAN'),
   ('MN','MINNESOTA'),
   ('MS','MISSISSIPPI'),
   ('MO','MISSOURI'),
   ('MT','MONTANA'),
   ('NE','NEBRASKA'),
   ('NV','NEVADA'),
   ('NH','NEW HAMPSHIRE'),
   ('NJ','NEW JERSEY'),
   ('NM','NEW MEXICO'),
   ('NY','NEW YORK'),
   ('NC','NORTH CAROLINA'),
   ('ND','NORTH DAKOTA'),
   ('OH','OHIO'),
   ('OK','OKLAHOMA'),
   ('OR','OREGON'),
   ('PA','PENNSYLVANIA'),
   ('RI','RHODE ISLAND'),
   ('SC','SOUTH CAROLINA'),
   ('SD','SOUTH DAKOTA'),
   ('TN','TENNESSEE'),
   ('TX','TEXAS'),
   ('UT','UTAH'),
   ('VT','VERMONT'),
   ('VA','VIRGINIA'),
   ('WA','WASHINGTON'),
   ('WV','WEST VIRGINIA'),
   ('WI','WISCONSIN'),
   ('WY','WYOMING')
 ) as postal(code,name) where upper(btrim(input_state)) in (code,name)
 or (code='DC' and upper(btrim(input_state)) in ('D.C.','WASHINGTON, D.C.','WASHINGTON DC','WASHINGTON, DC'))
$$;
revoke all on function private.tax_admin_state(text) from public,anon,authenticated;

create function private.tax_admin_order_rows(period_start date, period_end date)
returns table(order_id bigint, order_number text, state text, paid_on date, payment_status text,
    merchandise bigint, customer_total bigint, recorded_tax bigint, calculated_tax bigint,
    taxable bigint, exempt bigint, breakdown jsonb, review_reason text)
language sql stable set search_path='' as $$
 with sales as (
   select o.*,case when lower(coalesce(o.shipping_address->>'fulfillment','delivery'))='pickup' then 'NY'
     else private.tax_admin_state(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}')) end as destination
   from public.orders o
   where o.paid_at >= (period_start::timestamp at time zone 'America/New_York')
     and o.paid_at < ((period_end+1)::timestamp at time zone 'America/New_York')
 ), matched as (
   select o.*,s.state as verified_state,a.result as r,
     (s.state is not null and a.user_id=o.user_id and o.tax_amount is not null
       and private.tax_normalize_address(a.address)=private.tax_normalize_address(coalesce(o.shipping_address->'address',o.shipping_address))
       and a.result @> jsonb_build_object('state',s.state,'tax',o.tax_amount*100,'total',o.total*100,
          'subtotal',o.subtotal*100,'shipping',coalesce(o.shipping_amount,0)*100,'fee',coalesce(o.payment_surcharge,0)*100)
       and jsonb_typeof(a.result->'breakdown')='array') as reconciled
   from sales o left join private.tax_states s on s.state=o.destination
   left join private.tax_assessments a on a.id=o.tax_assessment_id
 )
 select id,order_number,coalesce(verified_state,'UNASSIGNED'),(paid_at at time zone 'America/New_York')::date,payment_status::text,
    (subtotal*100)::bigint,(total*100)::bigint,(tax_amount*100)::bigint,
    case when reconciled then (r->>'tax')::bigint end,
    case when reconciled and r->>'taxable' ~ '^[0-9]{1,15}$' then (r->>'taxable')::bigint end,
    case when reconciled and r->>'exempt' ~ '^[0-9]{1,15}$' then (r->>'exempt')::bigint end,
    case when reconciled then coalesce(r->'breakdown','[]') else '[]'::jsonb end,
    case when verified_state is null then 'Destination needs review'
      when tax_assessment_id is null then 'No verified tax calculation on file'
      when reconciled is not true then 'Order and tax calculation need reconciliation' end
 from matched
$$;
revoke all on function private.tax_admin_order_rows(date,date) from public,anon,authenticated;

create function public.tax_admin_order_report(p_actor uuid,p_from date,p_to date,p_state text default null,p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare report jsonb;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or (p_before is not null and p_before<=0) then raise exception 'Invalid reporting period or cursor'; end if;
 if p_state is not null then
   if p_state<>'UNASSIGNED' and not exists(select from private.tax_states where state=p_state) then raise exception 'Invalid jurisdiction';end if;
   with page as (
     select * from private.tax_admin_order_rows(p_from,p_to) t
     where t.state=p_state and (p_before is null or t.order_id<p_before) order by order_id desc limit 26
   ), visible as (select * from page order by order_id desc limit 25)
   select jsonb_build_object('orders',coalesce(jsonb_agg(to_jsonb(v) order by v.order_id desc),'[]'),
     'next',case when (select count(*) from page)>25 then min(v.order_id) end) into report from visible v;
 else
   with sales as materialized(select * from private.tax_admin_order_rows(p_from,p_to)), destinations as (
     select state from private.tax_states union all select 'UNASSIGNED' where exists(select from sales where state='UNASSIGNED')
   ), totals as (
     select d.state,count(s.order_id) as orders,count(*) filter(where s.payment_status='refunded') as refunded_orders,
       sum(s.merchandise) as merchandise,sum(s.customer_total) as customer_total,
       sum(s.recorded_tax) as recorded_tax,sum(s.calculated_tax) as calculated_tax,
       count(*) filter(where s.order_id is not null and s.recorded_tax is null) as missing_recorded,
       count(*) filter(where s.review_reason is not null) as needs_review
     from destinations d left join sales s on d.state=s.state group by d.state
   )
   select jsonb_build_object('states',jsonb_agg(to_jsonb(t) order by state),
      'missing_payment_date',(select count(*) from public.orders where paid_at is null
         and payment_status::text in ('paid','refunded','partially_refunded'))) into report from totals t;
 end if;
 return report;
end $$;
revoke all on function public.tax_admin_order_report(uuid,date,date,text,bigint) from public,anon,authenticated;
grant execute on function public.tax_admin_order_report(uuid,date,date,text,bigint) to service_role;

-- Reconstruct a report from an order without requiring an active checkout quote.
-- Today's registration must never be used as proof for an earlier sale.
create function public.tax_admin_calculation_inputs(p_actor uuid,p_order bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 o public.orders; profile private.tax_states; policy jsonb; destination jsonb; district jsonb;
 products jsonb; lines jsonb; sale_day date; state_code text; collection text; saved jsonb; missing integer;
begin
 if not exists(select from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 select * into strict o from public.orders where id=p_order and paid_at is not null;
 sale_day:=(o.created_at at time zone 'America/New_York')::date;
 if o.tax_assessment_id is not null then
   select r.breakdown,r.review_reason into district,collection from private.tax_admin_order_rows(
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
revoke all on function public.tax_admin_calculation_inputs(uuid,bigint) from public,anon,authenticated;
grant execute on function public.tax_admin_calculation_inputs(uuid,bigint) to service_role;
