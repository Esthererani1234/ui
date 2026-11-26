alter table public.orders add column pickup_ready_at timestamptz;
create index orders_madison_pickups on public.orders(id desc) where shipping_address->>'fulfillment'='pickup';
CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quote public.checkout_quotes%rowtype;
  v_order_id bigint;
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
  if p_payment_method='ach' and v_total > 25000 then raise exception 'ACH maximum is $25,000 including fees' using errcode='P2005'; end if;
  v_order_number := private.next_customer_order_number();

  insert into public.orders (
    order_number, user_id, first_name, last_name, email, phone, payment_method,
    subtotal, payment_surcharge, shipping_amount, total, spot_snapshot,
    price_locked_until, shipping_address, customer_notes
  ) values (
    v_order_number, p_user_id, p_contact ->> 'first_name', p_contact ->> 'last_name',
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
CREATE OR REPLACE FUNCTION public.refresh_card_order_quote(p_order_id bigint, p_spot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_product public.products%rowtype;
  v_spot numeric;
  v_unit numeric(14,2);
  v_line numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_shipping numeric(14,2);
  v_surcharge numeric(14,2);
  v_total numeric(14,2);
  v_shipping_flat numeric := 35;
  v_free_shipping_threshold numeric := 5000;
  v_card_surcharge_percent numeric := 4;
  v_lock_minutes integer := 10;
  v_expires_at timestamptz;
  v_lines jsonb;
  d numeric:=0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_method <> 'card' then raise exception 'Only card orders can be repriced here'; end if;
  if v_order.payment_status in ('paid', 'refunded', 'disputed') then raise exception 'This order cannot be repriced'; end if;
  if v_order.status in ('cancelled', 'completed', 'shipped') then raise exception 'This order cannot be repriced'; end if;

  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'shipping_flat'), 35) into v_shipping_flat;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'free_shipping_threshold'), 5000) into v_free_shipping_threshold;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'card_surcharge_percent'), 4) into v_card_surcharge_percent;
  select greatest(1, coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'price_lock_minutes'), 10)) into v_lock_minutes;

  for v_item in select * from public.order_items where order_id = p_order_id order by id for update
  loop
    select * into v_product from public.products where id = v_item.product_id;
    if not found or not v_product.is_active then raise exception 'A product is unavailable'; end if;
    v_spot := null;
    if v_product.price_mode = 'fixed' then
      v_unit := round(v_product.fixed_price, 2);
    else
      begin
        v_spot := (p_spot ->> v_product.metal)::numeric;
      exception when others then
        raise exception 'Invalid spot price';
      end;
      if v_spot <= 0 then raise exception 'Invalid spot price'; end if;
      v_unit := round((v_spot * v_product.metal_weight_oz) * (1 + v_product.premium_percent / 100) + v_product.premium_fixed, 2);
    end if;
    v_line := round(v_unit * v_item.quantity, 2);
    v_subtotal := v_subtotal + v_line;
    update public.order_items
    set unit_price = v_unit,
        line_total = v_line,
        pricing_snapshot = jsonb_build_object(
          'spot', v_spot,
          'premium_fixed', v_product.premium_fixed,
          'premium_percent', v_product.premium_percent,
          'price_mode', v_product.price_mode
        )
    where id = v_item.id;
  end loop;

  v_shipping := case when v_order.shipping_address->>'fulfillment'='pickup' then 0 else private.shipping_for_cart((select jsonb_agg(jsonb_build_object('product_id',product_id)) from public.order_items where order_id=p_order_id),v_subtotal) end;
  if v_order.promo_code is not null then
    select private.promo_discount(v_subtotal,kind,amount) into strict d from private.store_promos where code=v_order.promo_code;
    if v_subtotal-d<0.50 then raise exception 'Contact support to reprice this discounted order.' using errcode='P2005';end if;
    v_subtotal:=v_subtotal-d;
  end if;
  v_surcharge := round(v_subtotal * v_card_surcharge_percent / 100, 2);
  v_total := round(v_subtotal + v_shipping + v_surcharge, 2);
  v_expires_at := now() + make_interval(mins => v_lock_minutes);

  update public.orders
  set discount_amount=d, subtotal = v_subtotal,
      shipping_amount = v_shipping,
      payment_surcharge = v_surcharge,
      total = v_total,
      spot_snapshot = p_spot,
      price_locked_until = v_expires_at,
      payment_due_at = v_expires_at,
      updated_at = now()
  where id = p_order_id;

  update public.payment_attempts
  set amount = v_total, expires_at = v_expires_at, updated_at = now()
  where order_id = p_order_id and provider = 'stripe' and status in ('created', 'failed', 'expired');

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', oi.product_id,
    'product_name', oi.product_name,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'line_total', oi.line_total,
    'image_url', coalesce(p.image_url, p.image_urls[1])
  ) order by oi.id), '[]'::jsonb)
  into v_lines
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'promo_code',v_order.promo_code,'discount_amount',d,'order_number', v_order.order_number,
    'first_name', v_order.first_name,
    'last_name', v_order.last_name,
    'email', v_order.email,
    'phone', v_order.phone,
    'shipping_address', v_order.shipping_address,
    'line_items', v_lines,
    'spot_snapshot', p_spot,
    'subtotal', v_subtotal,
    'shipping', v_shipping,
    'card_surcharge', v_surcharge,
    'card_total', v_total,
    'expires_at', v_expires_at,
    'lock_minutes', v_lock_minutes
  );
end;
$function$
;
alter table public.order_email_outbox drop constraint order_email_outbox_event_type_check;
alter table public.order_email_outbox add constraint order_email_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['pickup_ready'::text,'placed'::text, 'awaiting_payment'::text, 'paid'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text, 'refunded'::text, 'tracking'::text, 'support_created'::text, 'support_reply'::text, 'support_status'::text, 'wire_instructions'::text, 'account_signin'::text, 'account_password_changed'::text, 'account_email_changed'::text])));
create function public.notify_pickup_ready(order_key bigint) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
 if not private.is_admin() then raise insufficient_privilege;end if;
 select * into strict o from public.orders where id=order_key and shipping_address->>'fulfillment'='pickup' for update;
 if o.payment_status<>'paid' or o.status not in ('payment_received','processing') or not exists(select 1 from public.order_risk_reviews where order_id=o.id and decision='approved') then raise exception 'Confirm cleared payment and approve risk review first';end if;
 if o.pickup_ready_at is not null then return;end if;
 perform private.enqueue_order_milestone(o,'pickup_ready',null);
 if not exists(select 1 from public.order_email_outbox where order_id=o.id and event_type='pickup_ready') then raise exception 'Pickup notification could not be queued';end if;
 update public.orders set pickup_ready_at=now() where id=o.id;
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata) values(auth.uid(),'pickup_ready','order',o.id::text,'Office pickup ready','{}');
end $$;
revoke all on function public.notify_pickup_ready(bigint) from public,anon;
grant execute on function public.notify_pickup_ready(bigint) to authenticated;