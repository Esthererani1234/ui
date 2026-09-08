-- GoldOnTheSpot-managed customer SMS verification using MessageBird Verify.
-- Supabase continues to own email/password auth; customer SMS state is tied to
-- the Supabase auth session_id so every new sign-in requires a fresh code.

alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

update public.profiles profiles
set phone_verified_at = coalesce(users.phone_confirmed_at, now())
from auth.users users
where users.id = profiles.id
  and profiles.phone is not null
  and profiles.phone_verified_at is null
  and (
    users.phone_confirmed_at is not null
    or exists (
      select 1
      from auth.mfa_factors factors
      where factors.user_id = profiles.id
        and factors.factor_type = 'phone'
        and factors.status = 'verified'
    )
  );

create table if not exists public.customer_sms_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  provider_verify_id text not null unique,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null check (purpose in ('signup', 'signin', 'recovery', 'enrollment')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_sms_challenges_user_session_created_idx
  on public.customer_sms_challenges (user_id, session_id, created_at desc);
create index if not exists customer_sms_challenges_created_idx
  on public.customer_sms_challenges (created_at desc);

create table if not exists public.customer_sms_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null default 'signin' check (purpose in ('signup', 'signin', 'recovery', 'enrollment')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, session_id)
);

create index if not exists customer_sms_sessions_user_expires_idx
  on public.customer_sms_sessions (user_id, expires_at desc);

alter table public.customer_sms_challenges enable row level security;
alter table public.customer_sms_sessions enable row level security;
revoke all on public.customer_sms_challenges from public, anon, authenticated;
revoke all on public.customer_sms_sessions from public, anon, authenticated;
grant all on public.customer_sms_challenges to service_role;
grant all on public.customer_sms_sessions to service_role;

create or replace function public.get_sms_provider_secret()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret::jsonb
  from vault.decrypted_secrets
  where name = 'customer_sms_provider'
  order by created_at desc
  limit 1;
$$;

create or replace function public.set_sms_provider_secret(secret_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if coalesce(secret_value ->> 'provider', '') <> 'messagebird'
     or length(coalesce(secret_value ->> 'access_key', '')) < 10 then
    raise exception 'Invalid SMS provider secret';
  end if;

  select id into existing_id
  from vault.secrets
  where name = 'customer_sms_provider'
  order by created_at desc
  limit 1;

  if existing_id is null then
    perform vault.create_secret(
      secret_value::text,
      'customer_sms_provider',
      'Encrypted GoldOnTheSpot customer SMS provider credentials'
    );
  else
    perform vault.update_secret(
      existing_id,
      secret_value::text,
      'customer_sms_provider',
      'Encrypted GoldOnTheSpot customer SMS provider credentials'
    );
  end if;
end;
$$;

revoke all on function public.get_sms_provider_secret() from public, anon, authenticated;
revoke all on function public.set_sms_provider_secret(jsonb) from public, anon, authenticated;
grant execute on function public.get_sms_provider_secret() to service_role;
grant execute on function public.set_sms_provider_secret(jsonb) to service_role;

create or replace function private.customer_sms_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not coalesce((
      select (settings.value #>> '{}')::boolean
      from public.app_settings settings
      where settings.key = 'customer_sms_mfa_required'
    ), false)
    or (select private.is_admin())
    or exists (
      select 1
      from public.customer_sms_sessions sessions
      where sessions.user_id = (select auth.uid())
        and sessions.session_id::text = coalesce((select auth.jwt() ->> 'session_id'), '')
        and sessions.expires_at > now()
    );
$$;

revoke all on function private.customer_sms_verified() from public, anon;
grant execute on function private.customer_sms_verified() to authenticated;

drop policy if exists "users or admins read orders" on public.orders;
create policy "users or admins read orders" on public.orders
for select to authenticated
using (
  ((select auth.uid()) = user_id and (select private.customer_sms_verified()))
  or (select private.is_admin())
);

drop policy if exists "users or admins read order items" on public.order_items;
create policy "users or admins read order items" on public.order_items
for select to authenticated
using (
  (select private.is_admin())
  or (
    (select private.customer_sms_verified())
    and exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "users or admins read support tickets" on public.support_tickets;
create policy "users or admins read support tickets" on public.support_tickets
for select to authenticated
using (
  ((select auth.uid()) = user_id and (select private.customer_sms_verified()))
  or (select private.is_admin())
);

drop policy if exists "users create their own support tickets" on public.support_tickets;
create policy "users create their own support tickets" on public.support_tickets
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.customer_sms_verified())
  and status = 'open'
  and admin_response is null
);

drop policy if exists "ticket participants read messages" on public.support_ticket_messages;
create policy "ticket participants read messages" on public.support_ticket_messages
for select to authenticated
using (
  (select private.is_admin())
  or (
    (select private.customer_sms_verified())
    and exists (
      select 1 from public.support_tickets tickets
      where tickets.id = support_ticket_messages.ticket_id
        and tickets.user_id = (select auth.uid())
    )
  )
);

-- Customers may edit normal profile fields but cannot assert that a phone is verified.
revoke update on public.profiles from authenticated;
grant update (
  first_name, last_name, phone, address_line_1, address_line_2,
  city, state, postal_code, marketing_opt_in, updated_at
) on public.profiles to authenticated;

create or replace function private.clear_changed_phone_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone
     and new.phone_verified_at is not distinct from old.phone_verified_at then
    new.phone_verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_changed_phone_verification on public.profiles;
create trigger profiles_clear_changed_phone_verification
before update of phone on public.profiles
for each row execute function private.clear_changed_phone_verification();

insert into public.app_settings (key, value, is_public) values
  ('sms_provider_name', '"messagebird"'::jsonb, true),
  ('sms_code_ttl_seconds', '300'::jsonb, true),
  ('sms_resend_seconds', '30'::jsonb, true),
  ('sms_max_attempts', '5'::jsonb, true),
  ('sms_session_hours', '720'::jsonb, false),
  ('sms_provider_ready', 'false'::jsonb, true),
  ('customer_sms_mfa_required', 'false'::jsonb, true)
on conflict (key) do update
set value = excluded.value,
    is_public = excluded.is_public,
    updated_at = now();

create or replace function public.admin_customer_security_summary()
returns table (user_id uuid, has_phone_mfa boolean, has_any_mfa boolean)
language sql
security definer
set search_path = ''
as $$
  select
    users.id,
    (
      profiles.phone is not null
      and profiles.phone_verified_at is not null
    ) or exists (
      select 1 from auth.mfa_factors factors
      where factors.user_id = users.id
        and factors.status = 'verified'
        and factors.factor_type = 'phone'
    ),
    (
      profiles.phone is not null
      and profiles.phone_verified_at is not null
    ) or exists (
      select 1 from auth.mfa_factors factors
      where factors.user_id = users.id
        and factors.status = 'verified'
    )
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id;
$$;

revoke all on function public.admin_customer_security_summary()
from public, anon, authenticated;
grant execute on function public.admin_customer_security_summary()
to service_role;
