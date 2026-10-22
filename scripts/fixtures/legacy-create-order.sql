CREATE OR REPLACE FUNCTION public.create_order(p_user_id uuid, p_contact jsonb, p_shipping jsonb, p_cart jsonb, p_spot jsonb, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id bigint;
  v_order_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_spot numeric;
  v_unit numeric(14, 2);
  v_line numeric(14, 2);
  v_subtotal numeric(14, 2) := 0;
  v_shipping numeric(14, 2);
  v_surcharge numeric(14, 2);
  v_total numeric(14, 2);
  v_shipping_flat numeric := 35;
  v_free_shipping_threshold numeric := 5000;
  v_card_surcharge_percent numeric := 4;
  v_lock_minutes integer := 5;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'A valid customer account is required';
  end if;
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'The cart is empty';
  end if;
  if p_payment_method not in ('wire', 'ach', 'check', 'card') then
    raise exception 'Unsupported payment method';
  end if;
  if coalesce(p_contact ->> 'first_name', '') = '' or coalesce(p_contact ->> 'last_name', '') = ''
     or coalesce(p_contact ->> 'email', '') = '' or coalesce(p_contact ->> 'phone', '') = '' then
    raise exception 'Complete contact information is required';
  end if;
  if coalesce(p_shipping ->> 'address_line_1', '') = '' or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'state', '') = '' or coalesce(p_shipping ->> 'postal_code', '') = '' then
    raise exception 'A complete shipping address is required';
  end if;

  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'shipping_flat'), 35) into v_shipping_flat;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'free_shipping_threshold'), 5000) into v_free_shipping_threshold;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'card_surcharge_percent'), 4) into v_card_surcharge_percent;
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'price_lock_minutes'), 5) into v_lock_minutes;

  v_order_number := 'GOTS-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.orders (order_number, user_id, first_name, last_name, email, phone, payment_method, spot_snapshot, price_locked_until, shipping_address, customer_notes)
  values (v_order_number, p_user_id, p_contact ->> 'first_name', p_contact ->> 'last_name', lower(p_contact ->> 'email'), p_contact ->> 'phone', p_payment_method, p_spot, now() + make_interval(mins => v_lock_minutes), p_shipping, nullif(trim(p_notes), ''))
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_cart)
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Invalid item quantity';
    end;
    if v_quantity < 1 or v_quantity > 100 then raise exception 'Invalid item quantity'; end if;

    select * into v_product from public.products
    where id = (v_item ->> 'product_id')::bigint and is_active
    for update;
    if not found then raise exception 'A product is unavailable'; end if;
    if v_product.inventory_count < v_quantity then raise exception '% does not have enough inventory', v_product.name; end if;
    if v_product.price_mode = 'quote' then raise exception '% requires a custom quote', v_product.name; end if;

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

    insert into public.order_items (order_id, product_id, sku, product_name, metal, metal_weight_oz, quantity, unit_price, line_total, pricing_snapshot)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_product.metal, v_product.metal_weight_oz, v_quantity, v_unit, v_line,
      jsonb_build_object('spot', v_spot, 'premium_fixed', v_product.premium_fixed, 'premium_percent', v_product.premium_percent, 'price_mode', v_product.price_mode));
    update public.products set inventory_count = inventory_count - v_quantity where id = v_product.id;
  end loop;

  v_shipping := case when v_subtotal >= v_free_shipping_threshold then 0 else v_shipping_flat end;
  v_surcharge := case when p_payment_method = 'card' then round(v_subtotal * v_card_surcharge_percent / 100, 2) else 0 end;
  v_total := round(v_subtotal + v_shipping + v_surcharge, 2);
  update public.orders set subtotal = v_subtotal, shipping_amount = v_shipping, payment_surcharge = v_surcharge, total = v_total where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'subtotal', v_subtotal, 'shipping', v_shipping, 'surcharge', v_surcharge, 'total', v_total, 'price_locked_until', now() + make_interval(mins => v_lock_minutes));
end;
$function$

