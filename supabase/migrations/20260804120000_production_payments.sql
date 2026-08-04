-- Production payment ledger for Stripe Checkout, bank wire, and BitPay.
-- Provider secrets and plaintext bank instructions never live in public tables.

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('wire', 'card', 'crypto', 'ach', 'check'));

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('unpaid', 'pending', 'confirming', 'paid', 'partially_paid', 'expired', 'refunded', 'failed', 'disputed'));

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists provider_payment_id text,
  add column if not exists provider_checkout_url text,
  add column if not exists payment_reference text,
  add column if not exists payment_due_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_ip_hash text,
  add column if not exists terms_user_agent text;

alter table public.orders drop constraint if exists orders_payment_provider_check;
alter table public.orders add constraint orders_payment_provider_check
  check (payment_provider is null or payment_provider in ('manual_wire', 'stripe', 'bitpay'));

create unique index if not exists orders_provider_payment_unique
  on public.orders(payment_provider, provider_payment_id)
  where provider_payment_id is not null;
create unique index if not exists orders_payment_reference_unique
  on public.orders(payment_reference)
  where payment_reference is not null;

create table if not exists public.payment_attempts (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  provider text not null check (provider in ('manual_wire', 'stripe', 'bitpay')),
  provider_payment_id text,
  status text not null check (status in ('created', 'pending', 'confirming', 'paid', 'expired', 'failed', 'refunded', 'disputed')),
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3,10}$'),
  checkout_url text,
  expires_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_id)
);

create index if not exists payment_attempts_order_created_idx
  on public.payment_attempts(order_id, created_at desc);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('stripe', 'bitpay', 'manual_wire')),
  provider_event_id text not null,
  order_id bigint references public.orders(id) on delete set null,
  event_type text not null,
  verified boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists payment_events_order_created_idx
  on public.payment_events(order_id, created_at desc);

create table if not exists public.secure_payment_settings (
  key text primary key,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.secure_payment_settings enable row level security;

-- No client policies: these tables are service-role only. Customers see the
-- safe subset copied to their own order through the existing order RLS policy.
revoke all on public.payment_attempts from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
revoke all on public.secure_payment_settings from anon, authenticated;

create or replace function public.mark_payment_state(
  p_order_id bigint,
  p_provider text,
  p_provider_payment_id text,
  p_payment_status text,
  p_attempt_status text,
  p_paid_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock timestamptz;
  v_order_status text;
begin
  if p_provider not in ('stripe', 'bitpay', 'manual_wire') then raise exception 'Invalid provider'; end if;
  if p_payment_status not in ('unpaid', 'pending', 'confirming', 'paid', 'partially_paid', 'expired', 'refunded', 'failed', 'disputed') then raise exception 'Invalid payment status'; end if;
  if p_attempt_status not in ('created', 'pending', 'confirming', 'paid', 'expired', 'failed', 'refunded', 'disputed') then raise exception 'Invalid attempt status'; end if;

  select price_locked_until, status into v_lock, v_order_status
  from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  update public.payment_attempts
  set status = p_attempt_status, updated_at = now()
  where order_id = p_order_id and provider = p_provider
    and (p_provider_payment_id is null or provider_payment_id = p_provider_payment_id);

  update public.orders set
    payment_status = p_payment_status,
    paid_at = case when p_payment_status = 'paid' then coalesce(p_paid_at, now()) else paid_at end,
    status = case
      when p_payment_status = 'paid' and v_lock is not null and now() > v_lock then 'pending_review'
      when p_payment_status = 'paid' then 'payment_received'
      when p_payment_status in ('pending', 'confirming') then 'awaiting_payment'
      else status
    end,
    internal_notes = case
      when p_payment_status = 'paid' and v_lock is not null and now() > v_lock
      then concat_ws(E'\n', nullif(internal_notes, ''), 'PAYMENT REVIEW: Provider confirmed payment after the recorded price-lock deadline.')
      else internal_notes
    end,
    updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.mark_payment_state(bigint, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_payment_state(bigint, text, text, text, text, timestamptz) to service_role;

create or replace function public.admin_update_order(
  p_actor_user_id uuid, p_order_id bigint, p_status text, p_payment_status text,
  p_tracking_number text, p_internal_notes text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_user_id) then raise exception 'Administrator access required'; end if;
  if p_status not in ('pending_review', 'awaiting_payment', 'payment_received', 'processing', 'shipped', 'completed', 'cancelled') then raise exception 'Invalid order status'; end if;
  if p_payment_status not in ('unpaid', 'pending', 'confirming', 'paid', 'partially_paid', 'expired', 'refunded', 'failed', 'disputed') then raise exception 'Invalid payment status'; end if;
  if char_length(coalesce(p_internal_notes, '')) > 5000 or char_length(coalesce(p_tracking_number, '')) > 200 or char_length(coalesce(p_reason, '')) > 1000 or char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A valid audit reason is required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'cancelled' and p_status <> 'cancelled' then raise exception 'Cancelled orders cannot be reopened automatically'; end if;
  if v_order.status <> 'cancelled' and p_status = 'cancelled' then
    update public.products products set inventory_count = products.inventory_count + lines.quantity
    from (select product_id, sum(quantity)::integer quantity from public.order_items where order_id = p_order_id and product_id is not null group by product_id) lines
    where products.id = lines.product_id;
  end if;
  update public.orders set status = p_status, payment_status = p_payment_status,
    paid_at = case when p_payment_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
    tracking_number = nullif(trim(p_tracking_number), ''), internal_notes = nullif(trim(p_internal_notes), ''), updated_at = now()
  where id = p_order_id;
  insert into public.admin_audit_log(actor_user_id, action, target_type, target_id, reason, metadata)
  values (p_actor_user_id, case when p_payment_status = 'paid' and v_order.payment_method = 'wire' then 'wire.manually_marked_paid' else 'order.updated' end,
    'order', p_order_id::text, trim(p_reason), jsonb_build_object('order_number', v_order.order_number, 'previous_status', v_order.status, 'new_status', p_status, 'previous_payment_status', v_order.payment_status, 'new_payment_status', p_payment_status));
  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

revoke all on function public.admin_update_order(uuid, bigint, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_order(uuid, bigint, text, text, text, text, text) to service_role;
