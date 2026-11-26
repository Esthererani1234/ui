create table private.pickup_tax_approvals (
 pay_method text not null check(pay_method in ('card','wire')),
 quote_id uuid not null references public.checkout_quotes(id),
 calculation_ref text not null unique,
 tax numeric(14,2) not null check(tax>=0),
 subtotal numeric(14,2) not null check(subtotal>0), primary key(quote_id,pay_method)
);
alter table public.orders add column fulfillment_method text not null default 'delivery' check(fulfillment_method in ('delivery','pickup')), add column pickup_tax numeric(14,2) not null default 0 check(pickup_tax>=0), add column pickup_ready_at timestamptz;
create index orders_office_pickup on public.orders(created_at desc) where fulfillment_method='pickup';
create function public.record_pickup_calculation(qid uuid,uid uuid,ref text,tax_cents bigint,subtotal_cents bigint,p_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.checkout_quotes; calc private.pickup_tax_approvals;
begin
 select * into strict q from public.checkout_quotes where id=qid and user_id=uid and status='active' and expires_at>clock_timestamp() for update;
 if q.subtotal*100<>subtotal_cents or tax_cents<0 or ref !~ '^taxcalc_[a-zA-Z0-9]+$' then raise exception 'Invalid calculation'; end if;
 insert into private.pickup_tax_approvals values(p_method,qid,ref,tax_cents/100.0,q.subtotal) on conflict(quote_id,pay_method) do nothing;
 select * into strict calc from private.pickup_tax_approvals where quote_id=qid and pay_method=p_method;
 return jsonb_build_object('quote_id',qid,'pickup_tax',calc.tax,'method',p_method,'total',q.subtotal+calc.tax+case when p_method='card' then q.card_surcharge else 0 end,'expires_at',q.expires_at);
end $$;
revoke all on function public.record_pickup_calculation(uuid,uuid,text,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.record_pickup_calculation(uuid,uuid,text,bigint,bigint,text) to service_role;
CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quote public.checkout_quotes%rowtype;
  v_order_id bigint;
  pickup boolean:=(p_shipping->>'fulfillment') is not distinct from 'pickup'; tax_due numeric:=0;
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

  if pickup then
    if p_payment_method not in ('wire','card') then raise exception 'Unsupported pickup payment'; end if;
    select tax into strict tax_due from private.pickup_tax_approvals where quote_id=v_quote.id and subtotal=v_quote.subtotal and pay_method=p_payment_method;
    p_shipping:=p_shipping||jsonb_build_object('pickup_tax',tax_due);
    v_quote.shipping_amount:=0;
  end if;
  v_surcharge := case when p_payment_method = 'card' then v_quote.card_surcharge when p_payment_method = 'ach' then round(v_quote.subtotal * 0.02, 2) else 0 end;
  v_total := round(v_quote.subtotal + v_quote.shipping_amount + tax_due + v_surcharge, 2);
  if p_payment_method='ach' and v_total > 25000 then raise exception 'ACH maximum is $25,000 including fees' using errcode='P2005'; end if;
  v_order_number := private.next_customer_order_number();

  insert into public.orders (
    order_number, user_id, first_name, last_name, email, phone, payment_method,
    subtotal, payment_surcharge, shipping_amount, total, spot_snapshot,
    price_locked_until, shipping_address, fulfillment_method, pickup_tax, customer_notes
  ) values (
    v_order_number, p_user_id, p_contact ->> 'first_name', p_contact ->> 'last_name',
    lower(p_contact ->> 'email'), p_contact ->> 'phone', p_payment_method,
    v_quote.subtotal, v_surcharge, v_quote.shipping_amount, v_total,
    v_quote.spot_snapshot, v_quote.expires_at, p_shipping, case when pickup then 'pickup' else 'delivery' end, tax_due, nullif(trim(p_notes), '')
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
    'order_id', v_order_id,
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

alter table public.order_email_outbox drop constraint order_email_outbox_event_type_check;
alter table public.order_email_outbox add constraint order_email_outbox_event_type_check check(event_type in ('pickup_ready','placed','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','tracking','support_created','support_reply','support_status','wire_instructions','account_signin','account_password_changed','account_email_changed'));
create function public.notify_pickup_ready(order_key bigint) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
 if not private.is_admin() then raise insufficient_privilege;end if;
 select * into strict o from public.orders where id=order_key and fulfillment_method='pickup' for update;
 if o.payment_status<>'paid' or o.status not in ('payment_received','processing') or
 not exists(select 1 from public.order_risk_reviews where order_id=o.id and decision='approved')
 then raise exception 'Payment or order review is incomplete';end if;
 if o.pickup_ready_at is not null then return;end if;
 perform private.enqueue_order_milestone(o,'pickup_ready',null);
 if not exists(select 1 from public.order_email_outbox where order_id=o.id and event_type='pickup_ready') then raise exception 'Email notification is unavailable';end if;
 update public.orders set pickup_ready_at=now() where id=o.id;
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata) values(auth.uid(),'pickup_ready','order',o.id::text,'Merchandise ready for collection','{}');
end $$;
revoke all on function public.notify_pickup_ready(bigint) from public,anon;
grant execute on function public.notify_pickup_ready(bigint) to authenticated;

-- Pickup prices and fulfillment cannot be changed by a delivery re-quote or payment-method conversion.
create function private.freeze_pickup_financials() returns trigger language plpgsql set search_path='' as $$ begin
if old.fulfillment_method='pickup' and (new.fulfillment_method,new.subtotal,new.total,new.payment_surcharge,new.shipping_amount,new.pickup_tax,new.payment_method,new.price_locked_until) is distinct from (old.fulfillment_method,old.subtotal,old.total,old.payment_surcharge,old.shipping_amount,old.pickup_tax,old.payment_method,old.price_locked_until) then raise exception 'Pickup order must be quoted again separately';end if; return new;end $$;
create trigger freeze_pickup_financials before update on public.orders for each row execute function private.freeze_pickup_financials();