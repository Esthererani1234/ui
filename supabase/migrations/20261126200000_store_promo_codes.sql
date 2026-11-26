create table private.store_promos(code text primary key check(code ~ '^[A-Z0-9_-]{3,32}$'),kind text not null check(kind in ('usd','percent')),amount numeric(14,2) not null check(amount>0 and (kind<>'percent' or amount<100)),max_uses int not null check(max_uses between 1 and 1000000),used int not null default 0,enabled boolean not null default true,created_by uuid not null,created_at timestamptz not null default now());
alter table private.store_promos enable row level security;
revoke all on private.store_promos from public,anon,authenticated;
create table private.promo_quotes(quote_id uuid primary key references public.checkout_quotes(id) on delete cascade,code text not null references private.store_promos,discount numeric(14,2) not null);
alter table private.promo_quotes enable row level security;
revoke all on private.promo_quotes from public,anon,authenticated;
alter table public.orders add column promo_code text,add column discount_amount numeric(14,2) not null default 0;
create function public.manage_store_promos(action text,code_input text default null,kind_input text default null,amount_input numeric default null,limit_input int default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise insufficient_privilege; end if;
 if action='create' then insert into private.store_promos(code,kind,amount,max_uses,created_by) values(upper(trim(code_input)),kind_input,amount_input,limit_input,auth.uid());
 elsif action='disable' then update private.store_promos set enabled=false where code=upper(trim(code_input));
 elsif action is distinct from 'list' then raise exception 'Unknown action';end if;
 return coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by created_at desc) from private.store_promos p),'[]');end $$;
revoke all on function public.manage_store_promos(text,text,text,numeric,int) from public,anon;grant execute on function public.manage_store_promos(text,text,text,numeric,int) to authenticated;
create function private.promo_discount(gross numeric,kind text,amount numeric) returns numeric language sql immutable set search_path='' as $$select case kind when 'percent' then round(gross*amount/100,2) else amount end$$;
create function public.create_promo_quote(p_user_id uuid,p_cart jsonb,p_spot jsonb,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.store_promos; q jsonb; d numeric; net numeric; fee numeric; shipping numeric;begin
 select * into p from private.store_promos where code=upper(trim(p_code)) and enabled and used<max_uses;
 if not found then raise exception 'Code unavailable' using errcode='P2010';end if;
 q:=public.create_checkout_quote(p_user_id,p_cart,p_spot);
 d:=private.promo_discount((q->>'subtotal')::numeric,p.kind,p.amount); net:=(q->>'subtotal')::numeric-d;
 if net<0.50 or d<=0 then raise exception 'Discount not applicable' using errcode='P2010';end if;
 shipping:=(q->>'shipping')::numeric;
 fee:=round(net*coalesce((select (value#>>'{}')::numeric from public.app_settings where key='card_surcharge_percent'),4)/100,2);
 update public.checkout_quotes set subtotal=net,wire_total=net+shipping,card_total=net+shipping+fee,card_surcharge=fee where id=(q->>'quote_id')::uuid;
 insert into private.promo_quotes values((q->>'quote_id')::uuid,p.code,d);
 return q||jsonb_build_object('promo_code',p.code,'discount_amount',d,'subtotal',net,'wire_total',net+shipping,'card_total',net+shipping+fee,'card_surcharge',fee);
end $$;
revoke all on function public.create_promo_quote(uuid,jsonb,jsonb,text) from public,anon,authenticated;grant execute on function public.create_promo_quote(uuid,jsonb,jsonb,text) to service_role;
create function private.consume_store_promo() returns trigger language plpgsql security definer set search_path='' as $$
declare p private.promo_quotes;begin
 select * into p from private.promo_quotes where quote_id=new.quote_id;
 if found then
 update private.store_promos set used=used+1 where code=p.code and enabled and used<max_uses;
 if not found then raise exception 'Promo code is no longer available. Remove it and refresh your quote.' using errcode='P2005';end if;
 update public.orders set promo_code=p.code,discount_amount=p.discount where id=new.order_id;
 end if;return new;end $$;
create trigger consume_store_promo after insert on private.checkout_order_receipts for each row execute function private.consume_store_promo();
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

  v_shipping := private.shipping_for_cart((select jsonb_agg(jsonb_build_object('product_id',product_id)) from public.order_items where order_id=p_order_id),v_subtotal);
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
