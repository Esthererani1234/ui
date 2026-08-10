-- Server-owned checkout quotes provide a real 10-minute price lock. Customers
-- never submit prices or totals; only service-role code may create/use quotes.

insert into public.app_settings (key, value)
values ('price_lock_minutes', '10'::jsonb)
on conflict (key) do update set value = excluded.value;

create table if not exists public.checkout_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cart jsonb not null,
  line_items jsonb not null,
  spot_snapshot jsonb not null,
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  shipping_amount numeric(14, 2) not null check (shipping_amount >= 0),
  card_surcharge numeric(14, 2) not null check (card_surcharge >= 0),
  wire_total numeric(14, 2) not null check (wire_total >= 0),
  card_total numeric(14, 2) not null check (card_total >= 0),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkout_quotes_user_status_idx
  on public.checkout_quotes(user_id, status, expires_at desc);

alter table public.checkout_quotes enable row level security;
revoke all on public.checkout_quotes from public, anon, authenticated;

create or replace function public.create_checkout_quote(
  p_user_id uuid,
  p_cart jsonb,
  p_spot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_quote_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_spot numeric;
  v_unit numeric(14,2);
  v_line numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_subtotal numeric(14,2) := 0;
  v_shipping numeric(14,2);
  v_surcharge numeric(14,2);
  v_shipping_flat numeric := 35;
  v_free_shipping_threshold numeric := 5000;
  v_card_surcharge_percent numeric := 4;
  v_lock_minutes integer := 10;
  v_expires_at timestamptz;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'A valid customer account is required';
  end if;
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 or jsonb_array_length(p_cart) > 25 then
    raise exception 'The cart is empty or invalid';
  end if;

  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'shipping_flat'), 35) into v_shipping_flat;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'free_shipping_threshold'), 5000) into v_free_shipping_threshold;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'card_surcharge_percent'), 4) into v_card_surcharge_percent;
  select greatest(1, coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'price_lock_minutes'), 10)) into v_lock_minutes;

  for v_item in select value from jsonb_array_elements(p_cart)
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Invalid item quantity';
    end;
    if v_quantity < 1 or v_quantity > 100 then raise exception 'Invalid item quantity'; end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::bigint and is_active;
    if not found then raise exception 'A product is unavailable'; end if;
    if v_product.inventory_count < v_quantity then raise exception '% does not have enough inventory', v_product.name; end if;
    if v_product.price_mode = 'quote' then raise exception '% requires a custom quote', v_product.name; end if;

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
    v_line := round(v_unit * v_quantity, 2);
    v_subtotal := v_subtotal + v_line;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'sku', v_product.sku,
      'product_name', v_product.name,
      'metal', v_product.metal,
      'metal_weight_oz', v_product.metal_weight_oz,
      'quantity', v_quantity,
      'unit_price', v_unit,
      'line_total', v_line,
      'image_url', coalesce(v_product.image_url, v_product.image_urls[1]),
      'pricing_snapshot', jsonb_build_object(
        'spot', v_spot,
        'premium_fixed', v_product.premium_fixed,
        'premium_percent', v_product.premium_percent,
        'price_mode', v_product.price_mode
      )
    ));
  end loop;

  v_shipping := case when v_subtotal >= v_free_shipping_threshold then 0 else v_shipping_flat end;
  v_surcharge := round(v_subtotal * v_card_surcharge_percent / 100, 2);
  v_expires_at := now() + make_interval(mins => v_lock_minutes);

  update public.checkout_quotes
  set status = 'expired', updated_at = now()
  where user_id = p_user_id and status = 'active';

  insert into public.checkout_quotes (
    user_id, cart, line_items, spot_snapshot, subtotal, shipping_amount,
    card_surcharge, wire_total, card_total, expires_at
  ) values (
    p_user_id, p_cart, v_lines, p_spot, v_subtotal, v_shipping,
    v_surcharge, round(v_subtotal + v_shipping, 2),
    round(v_subtotal + v_shipping + v_surcharge, 2), v_expires_at
  ) returning id into v_quote_id;

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'line_items', v_lines,
    'spot_snapshot', p_spot,
    'subtotal', v_subtotal,
    'shipping', v_shipping,
    'card_surcharge', v_surcharge,
    'wire_total', round(v_subtotal + v_shipping, 2),
    'card_total', round(v_subtotal + v_shipping + v_surcharge, 2),
    'expires_at', v_expires_at,
    'lock_minutes', v_lock_minutes
  );
end;
$function$;

create or replace function public.create_order_from_quote(
  p_user_id uuid,
  p_quote_id uuid,
  p_contact jsonb,
  p_shipping jsonb,
  p_payment_method text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  if p_payment_method not in ('wire', 'card', 'crypto') then raise exception 'Unsupported payment method'; end if;
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

  v_surcharge := case when p_payment_method = 'card' then v_quote.card_surcharge else 0 end;
  v_total := round(v_quote.subtotal + v_quote.shipping_amount + v_surcharge, 2);
  v_order_number := 'GOTS-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

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

  -- Lock inventory rows in a consistent order across concurrent checkouts.
  for v_item in
    select value
    from jsonb_array_elements(v_quote.line_items)
    order by (value ->> 'product_id')::bigint
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
$function$;

create or replace function public.refresh_card_order_quote(
  p_order_id bigint,
  p_spot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  v_shipping := case when v_subtotal >= v_free_shipping_threshold then 0 else v_shipping_flat end;
  v_surcharge := round(v_subtotal * v_card_surcharge_percent / 100, 2);
  v_total := round(v_subtotal + v_shipping + v_surcharge, 2);
  v_expires_at := now() + make_interval(mins => v_lock_minutes);

  update public.orders
  set subtotal = v_subtotal,
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
    'order_number', v_order.order_number,
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
$function$;

revoke all on function public.create_checkout_quote(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_order_from_quote(uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.refresh_card_order_quote(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_quote(uuid, jsonb, jsonb) to service_role;
grant execute on function public.create_order_from_quote(uuid, uuid, jsonb, jsonb, text, text) to service_role;
grant execute on function public.refresh_card_order_quote(bigint, jsonb) to service_role;

-- Legacy privileged functions also remain service-only.
revoke all on function public.create_order(uuid, jsonb, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.mark_payment_state(bigint, text, text, text, text, timestamptz) from public, anon, authenticated;
