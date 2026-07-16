create table if not exists public.customer_risk_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'normal' check (status in ('normal', 'watch', 'review', 'blocked')),
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 20),
  manual_review_required boolean not null default false,
  checkout_disabled boolean not null default false,
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 5000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_risk_reviews (
  order_id bigint primary key references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  decision text not null default 'approved' check (decision in ('pending', 'approved', 'rejected')),
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 5000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 3 and 100),
  target_type text not null check (char_length(target_type) between 2 and 60),
  target_id text,
  reason text check (reason is null or char_length(reason) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists customer_risk_status_score_idx
  on public.customer_risk_profiles (status, risk_score desc);
create index if not exists order_risk_decision_score_idx
  on public.order_risk_reviews (decision, risk_score desc, created_at desc);
create index if not exists order_risk_user_created_idx
  on public.order_risk_reviews (user_id, created_at desc);
create index if not exists admin_audit_created_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_target_idx
  on public.admin_audit_log (target_type, target_id, created_at desc);

drop trigger if exists customer_risk_set_updated_at on public.customer_risk_profiles;
create trigger customer_risk_set_updated_at
before update on public.customer_risk_profiles
for each row execute function private.set_updated_at();

drop trigger if exists order_risk_set_updated_at on public.order_risk_reviews;
create trigger order_risk_set_updated_at
before update on public.order_risk_reviews
for each row execute function private.set_updated_at();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1
      from public.admin_users
      where user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;

  insert into public.customer_risk_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

insert into public.customer_risk_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function private.assess_order_risk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 0;
  v_signals jsonb := '[]'::jsonb;
  v_account_created timestamptz;
  v_recent_orders integer := 0;
  v_profile_postal text;
  v_customer_status text := 'normal';
  v_customer_score integer := 0;
  v_manual_review boolean := false;
  v_phone_mfa boolean := false;
  v_level text;
  v_decision text;
begin
  if new.total <= 0 or (tg_op = 'UPDATE' and old.total = new.total) then
    return new;
  end if;

  select created_at into v_account_created from auth.users where id = new.user_id;
  select postal_code into v_profile_postal from public.profiles where id = new.user_id;
  select status, risk_score, manual_review_required
    into v_customer_status, v_customer_score, v_manual_review
  from public.customer_risk_profiles
  where user_id = new.user_id;

  select exists (
    select 1 from auth.mfa_factors
    where user_id = new.user_id
      and status = 'verified'
      and factor_type = 'phone'
  ) into v_phone_mfa;

  if v_account_created > now() - interval '24 hours' then
    v_score := v_score + 25;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'new_account', 'label', 'Account is under 24 hours old', 'weight', 25));
  end if;

  if new.total >= 50000 then
    v_score := v_score + 40;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'very_high_value', 'label', 'Order is at least $50,000', 'weight', 40));
  elsif new.total >= 10000 then
    v_score := v_score + 25;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'high_value', 'label', 'Order is at least $10,000', 'weight', 25));
  elsif new.total >= 5000 then
    v_score := v_score + 10;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'elevated_value', 'label', 'Order is at least $5,000', 'weight', 10));
  end if;

  select count(*) into v_recent_orders
  from public.orders
  where user_id = new.user_id
    and id <> new.id
    and created_at > now() - interval '24 hours';
  if v_recent_orders >= 3 then
    v_score := v_score + 25;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'order_velocity', 'label', 'Three or more other orders in 24 hours', 'weight', 25));
  end if;

  if not v_phone_mfa then
    v_score := v_score + 20;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'phone_mfa_missing', 'label', 'No verified SMS security factor', 'weight', 20));
  end if;

  if coalesce(v_profile_postal, '') <> ''
     and coalesce(new.shipping_address ->> 'postal_code', '') <> ''
     and v_profile_postal <> new.shipping_address ->> 'postal_code' then
    v_score := v_score + 15;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'new_postal_code', 'label', 'Shipping ZIP differs from saved profile', 'weight', 15));
  end if;

  if v_customer_score > 0 then
    v_score := v_score + least(40, round(v_customer_score * 0.5)::integer);
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'customer_risk_score', 'label', 'Customer has an existing risk score', 'weight', least(40, round(v_customer_score * 0.5)::integer)));
  end if;

  if v_customer_status = 'blocked' then
    v_score := 100;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'blocked_customer', 'label', 'Customer is blocked', 'weight', 100));
  elsif v_customer_status in ('watch', 'review') then
    v_score := v_score + 20;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'customer_watch', 'label', 'Customer is on the review watchlist', 'weight', 20));
  end if;

  v_score := least(100, v_score);
  v_level := case
    when v_score >= 80 then 'critical'
    when v_score >= 60 then 'high'
    when v_score >= 30 then 'medium'
    else 'low'
  end;
  v_decision := case when v_score >= 40 or v_manual_review then 'pending' else 'approved' end;

  insert into public.order_risk_reviews (
    order_id, user_id, risk_score, risk_level, decision, signals
  ) values (
    new.id, new.user_id, v_score, v_level, v_decision, v_signals
  )
  on conflict (order_id) do update set
    risk_score = excluded.risk_score,
    risk_level = excluded.risk_level,
    decision = case
      when public.order_risk_reviews.reviewed_at is null then excluded.decision
      else public.order_risk_reviews.decision
    end,
    signals = excluded.signals;
  return new;
end;
$$;

drop trigger if exists orders_assess_risk on public.orders;
create trigger orders_assess_risk
after update of total on public.orders
for each row execute function private.assess_order_risk();

create or replace function public.admin_customer_security_summary()
returns table (user_id uuid, has_phone_mfa boolean, has_any_mfa boolean)
language sql
security definer
set search_path = ''
as $$
  select
    users.id,
    exists (
      select 1 from auth.mfa_factors factors
      where factors.user_id = users.id
        and factors.status = 'verified'
        and factors.factor_type = 'phone'
    ),
    exists (
      select 1 from auth.mfa_factors factors
      where factors.user_id = users.id
        and factors.status = 'verified'
    )
  from auth.users users;
$$;

revoke all on function public.admin_customer_security_summary() from public, anon, authenticated;
grant execute on function public.admin_customer_security_summary() to service_role;

create or replace function public.admin_update_order(
  p_actor_user_id uuid,
  p_order_id bigint,
  p_status text,
  p_payment_status text,
  p_tracking_number text,
  p_internal_notes text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_user_id) then
    raise exception 'Administrator access required';
  end if;
  if p_status not in ('pending_review', 'awaiting_payment', 'payment_received', 'processing', 'shipped', 'completed', 'cancelled') then
    raise exception 'Invalid order status';
  end if;
  if p_payment_status not in ('unpaid', 'pending', 'paid', 'refunded', 'failed') then
    raise exception 'Invalid payment status';
  end if;
  if char_length(coalesce(p_internal_notes, '')) > 5000
     or char_length(coalesce(p_tracking_number, '')) > 200
     or char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'Order update is too long';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'Cancelled orders cannot be reopened automatically';
  end if;

  if v_order.status <> 'cancelled' and p_status = 'cancelled' then
    update public.products products
    set inventory_count = products.inventory_count + lines.quantity
    from (
      select product_id, sum(quantity)::integer as quantity
      from public.order_items
      where order_id = p_order_id and product_id is not null
      group by product_id
    ) lines
    where products.id = lines.product_id;
  end if;

  update public.orders set
    status = p_status,
    payment_status = p_payment_status,
    tracking_number = nullif(trim(p_tracking_number), ''),
    internal_notes = nullif(trim(p_internal_notes), '')
  where id = p_order_id;

  insert into public.admin_audit_log (
    actor_user_id, action, target_type, target_id, reason, metadata
  ) values (
    p_actor_user_id,
    'order.updated',
    'order',
    p_order_id::text,
    nullif(trim(p_reason), ''),
    jsonb_build_object(
      'order_number', v_order.order_number,
      'previous_status', v_order.status,
      'new_status', p_status,
      'previous_payment_status', v_order.payment_status,
      'new_payment_status', p_payment_status
    )
  );

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

revoke all on function public.admin_update_order(uuid, bigint, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.admin_update_order(uuid, bigint, text, text, text, text, text)
to service_role;

alter table public.customer_risk_profiles enable row level security;
alter table public.order_risk_reviews enable row level security;
alter table public.admin_audit_log enable row level security;

create policy "admins read customer risk" on public.customer_risk_profiles
for select to authenticated using ((select private.is_admin()));
create policy "admins insert customer risk" on public.customer_risk_profiles
for insert to authenticated with check ((select private.is_admin()));
create policy "admins update customer risk" on public.customer_risk_profiles
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "admins read order risk" on public.order_risk_reviews
for select to authenticated using ((select private.is_admin()));
create policy "admins update order risk" on public.order_risk_reviews
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "admins read audit log" on public.admin_audit_log
for select to authenticated using ((select private.is_admin()));

grant select, insert, update on public.customer_risk_profiles to authenticated;
grant select, update on public.order_risk_reviews to authenticated;
grant select on public.admin_audit_log to authenticated;

insert into public.app_settings (key, value, is_public) values
  ('sms_provider_ready', 'false'::jsonb, true),
  ('customer_sms_mfa_required', 'false'::jsonb, true),
  ('branded_email_ready', 'false'::jsonb, true)
on conflict (key) do nothing;

drop policy if exists "admins update products" on public.products;
create policy "admins update products" on public.products for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
