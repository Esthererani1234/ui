create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.products (
  id bigint generated always as identity primary key,
  slug text not null unique,
  sku text not null unique,
  name text not null,
  short_description text,
  description text,
  features text[] not null default '{}'::text[] check (cardinality(features) <= 12),
  metal text not null check (metal in ('gold', 'silver', 'platinum', 'palladium')),
  category text not null check (category in ('coin', 'bar', 'round')),
  metal_weight_oz numeric(12, 6) not null check (metal_weight_oz > 0),
  price_mode text not null default 'dynamic' check (price_mode in ('dynamic', 'fixed', 'quote')),
  fixed_price numeric(14, 2) check (fixed_price is null or fixed_price >= 0),
  premium_fixed numeric(14, 2) not null default 0 check (premium_fixed >= 0),
  premium_percent numeric(8, 4) not null default 0 check (premium_percent between -99 and 99),
  inventory_count integer not null default 0 check (inventory_count >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  is_active boolean not null default false,
  is_featured boolean not null default false,
  badge text,
  image_url text,
  image_urls text[] not null default '{}'::text[] check (cardinality(image_urls) <= 8),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  status text not null default 'pending_review' check (status in ('pending_review', 'awaiting_payment', 'payment_received', 'processing', 'shipped', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'refunded', 'failed')),
  payment_method text not null check (payment_method in ('wire', 'ach', 'check', 'card')),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  payment_surcharge numeric(14, 2) not null default 0 check (payment_surcharge >= 0),
  shipping_amount numeric(14, 2) not null default 0 check (shipping_amount >= 0),
  insurance_amount numeric(14, 2) not null default 0 check (insurance_amount >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  spot_snapshot jsonb not null default '{}'::jsonb,
  price_locked_until timestamptz,
  shipping_address jsonb not null,
  customer_notes text,
  internal_notes text,
  tracking_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.checkout_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_started_at timestamptz not null default now(),
  minute_count integer not null default 1,
  day_started_at timestamptz not null default now(),
  day_count integer not null default 1,
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  metal text not null,
  metal_weight_oz numeric(12, 6) not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  line_total numeric(14, 2) not null check (line_total >= 0),
  pricing_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table public.support_tickets (
  id bigint generated always as identity primary key,
  ticket_number text not null unique default ('SUP-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('order', 'product', 'payment', 'shipping', 'account', 'other')),
  order_number text check (order_number is null or char_length(order_number) <= 40),
  subject text not null check (char_length(subject) between 4 and 120),
  message text not null check (char_length(message) between 10 and 3000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_response text check (admin_response is null or char_length(admin_response) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_snapshots (
  id bigint generated always as identity primary key,
  metal text not null check (metal in ('gold', 'silver', 'platinum', 'palladium')),
  price numeric(14, 4) not null check (price > 0),
  source text not null,
  captured_at timestamptz not null default now()
);

create index products_active_sort_idx on public.products (sort_order, id) where is_active;
create index products_metal_active_idx on public.products (metal, sort_order, id) where is_active;
create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index orders_status_created_idx on public.orders (status, created_at desc);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);
create index support_tickets_user_created_idx on public.support_tickets (user_id, created_at desc);
create index support_tickets_status_created_idx on public.support_tickets (status, created_at desc);
create index price_snapshots_metal_captured_idx on public.price_snapshots (metal, captured_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function private.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function private.set_updated_at();
create trigger support_tickets_set_updated_at before update on public.support_tickets for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (new.id, new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      not exists (
        select 1 from auth.mfa_factors
        where user_id = (select auth.uid()) and status = 'verified'
      )
      or coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    )
    and exists (select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create or replace function private.enforce_order_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  if (select count(*) from public.orders where user_id = new.user_id and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Too many checkout attempts. Please wait a minute and try again.';
  end if;
  if (select count(*) from public.orders where user_id = new.user_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'The daily checkout limit was reached. Please contact support if you need help.';
  end if;
  return new;
end;
$$;

create trigger orders_enforce_rate_limit
before insert on public.orders
for each row execute function private.enforce_order_rate_limit();

create or replace function private.enforce_support_ticket_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 1));
  if (select count(*) from public.support_tickets where user_id = new.user_id and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Support ticket rate limit reached. Please wait before sending another request.';
  end if;
  if (select count(*) from public.support_tickets where user_id = new.user_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Daily support ticket rate limit reached. Please try again tomorrow.';
  end if;
  return new;
end;
$$;

create trigger support_tickets_enforce_rate_limit
before insert on public.support_tickets
for each row execute function private.enforce_support_ticket_rate_limit();

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.app_settings enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.support_tickets enable row level security;
alter table public.price_snapshots enable row level security;

create policy "users or admins read profiles" on public.profiles for select to authenticated using ((select auth.uid()) = id or (select private.is_admin()));
create policy "users or admins update profiles" on public.profiles for update to authenticated using ((select auth.uid()) = id or (select private.is_admin())) with check ((select auth.uid()) = id or (select private.is_admin()));

create policy "users or admins read admin memberships" on public.admin_users for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "anon reads public settings" on public.app_settings for select to anon using (is_public);
create policy "users read public settings or admins read all" on public.app_settings for select to authenticated using (is_public or (select private.is_admin()));
create policy "admins insert settings" on public.app_settings for insert to authenticated with check ((select private.is_admin()));
create policy "admins update settings" on public.app_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete settings" on public.app_settings for delete to authenticated using ((select private.is_admin()));

create policy "anon reads active products" on public.products for select to anon using (is_active);
create policy "users read active products or admins read all" on public.products for select to authenticated using (is_active or (select private.is_admin()));
create policy "admins insert products" on public.products for insert to authenticated with check ((select private.is_admin()));
create policy "admins update products" on public.products for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete products" on public.products for delete to authenticated using ((select private.is_admin()));

create policy "users or admins read orders" on public.orders for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy "admins update orders" on public.orders for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "users or admins read order items" on public.order_items for select to authenticated using (
  (select private.is_admin()) or exists (select 1 from public.orders where orders.id = order_items.order_id and orders.user_id = (select auth.uid()))
);

create policy "users or admins read support tickets" on public.support_tickets for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy "users create their own support tickets" on public.support_tickets for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'open' and admin_response is null);
create policy "admins update support tickets" on public.support_tickets for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "admins read price snapshots" on public.price_snapshots for select to authenticated using ((select private.is_admin()));

grant usage on schema public to anon, authenticated;
grant select on public.products, public.app_settings to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.admin_users to authenticated;
grant insert, update, delete on public.products, public.app_settings to authenticated;
grant update on public.orders to authenticated;
grant select (
  id, order_number, user_id, first_name, last_name, email, phone, status, payment_status,
  payment_method, subtotal, payment_surcharge, shipping_amount, insurance_amount, total,
  spot_snapshot, price_locked_until, shipping_address, customer_notes, tracking_number,
  created_at, updated_at
) on public.orders to authenticated;
grant select on public.order_items, public.price_snapshots to authenticated;
grant select, update on public.support_tickets to authenticated;
grant insert (user_id, category, order_number, subject, message) on public.support_tickets to authenticated;
grant usage, select on all sequences in schema public to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "admins upload product images" on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy "admins update product images" on storage.objects for update to authenticated
using (bucket_id = 'product-images' and (select private.is_admin()))
with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy "admins delete product images" on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (select private.is_admin()));

insert into public.app_settings (key, value, is_public) values
  ('shipping_flat', '35'::jsonb, true),
  ('free_shipping_threshold', '5000'::jsonb, true),
  ('card_surcharge_percent', '4'::jsonb, true),
  ('price_lock_minutes', '5'::jsonb, true)
on conflict (key) do nothing;

create or replace function public.check_checkout_rate_limit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minute_count integer;
  v_day_count integer;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    return false;
  end if;

  insert into private.checkout_rate_limits (user_id)
  values (p_user_id)
  on conflict (user_id) do update set
    minute_started_at = case
      when private.checkout_rate_limits.minute_started_at <= now() - interval '1 minute' then now()
      else private.checkout_rate_limits.minute_started_at
    end,
    minute_count = case
      when private.checkout_rate_limits.minute_started_at <= now() - interval '1 minute' then 1
      else private.checkout_rate_limits.minute_count + 1
    end,
    day_started_at = case
      when private.checkout_rate_limits.day_started_at <= now() - interval '24 hours' then now()
      else private.checkout_rate_limits.day_started_at
    end,
    day_count = case
      when private.checkout_rate_limits.day_started_at <= now() - interval '24 hours' then 1
      else private.checkout_rate_limits.day_count + 1
    end,
    updated_at = now()
  returning minute_count, day_count into v_minute_count, v_day_count;

  return v_minute_count <= 5 and v_day_count <= 50;
end;
$$;

revoke all on function public.check_checkout_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.check_checkout_rate_limit(uuid) to service_role;

create or replace function public.create_order(
  p_user_id uuid,
  p_contact jsonb,
  p_shipping jsonb,
  p_cart jsonb,
  p_spot jsonb,
  p_payment_method text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.create_order(uuid, jsonb, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_order(uuid, jsonb, jsonb, jsonb, jsonb, text, text) to service_role;
