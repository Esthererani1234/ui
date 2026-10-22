-- Reserve a verified mobile number to its account at the database boundary.
-- Existing shared numbers remain usable by their existing accounts only; no
-- customer data or access is removed while those legacy accounts are reviewed.
create function private.normalized_customer_phone(p_phone text)
returns text language sql immutable strict set search_path = '' as $$
  select case when digits ~ '^[0-9]{10}$' then '+1' || digits
    when digits ~ '^1[0-9]{10}$' then '+' || digits else null end
  from (select regexp_replace(p_phone, '[^0-9]', '', 'g') as digits) d;
$$;
revoke all on function private.normalized_customer_phone(text) from public, anon, authenticated;

create table private.customer_phone_claims (
  phone text primary key check (phone ~ '^\+1[0-9]{10}$'),
  -- Multiple IDs are permitted only for numbers already shared before migration.
  user_ids uuid[] not null check (cardinality(user_ids) > 0),
  claimed_at timestamptz not null default now()
);
alter table private.customer_phone_claims enable row level security;
revoke all on private.customer_phone_claims from public, anon, authenticated;

-- Serialize the backfill with profile updates; keep production data intact.
lock table public.profiles in share row exclusive mode;
do $$ begin
  if exists (select 1 from public.profiles where phone_verified_at is not null
    and private.normalized_customer_phone(phone) is null) then
    raise exception 'Review invalid verified phone numbers before applying migration';
  end if;
end $$;
insert into private.customer_phone_claims(phone, user_ids, claimed_at)
select private.normalized_customer_phone(phone), array_agg(id order by phone_verified_at, id), min(phone_verified_at)
from public.profiles where phone_verified_at is not null
group by private.normalized_customer_phone(phone);

create function public.can_enroll_customer_phone(p_user_id uuid, p_phone text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and private.normalized_customer_phone(p_phone) is not null
    and not exists (select 1 from private.customer_phone_claims c
      where c.phone = private.normalized_customer_phone(p_phone)
        and not (p_user_id = any(c.user_ids)));
$$;
revoke all on function public.can_enroll_customer_phone(uuid,text) from public, anon, authenticated;
grant execute on function public.can_enroll_customer_phone(uuid,text) to service_role;

create function private.claim_verified_customer_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_users uuid[];
begin
  if new.phone_verified_at is null then return new; end if;
  v_phone := private.normalized_customer_phone(new.phone);
  if v_phone is null then raise exception 'Invalid verified mobile number' using errcode='22023'; end if;
  -- The unique primary key arbitrates simultaneous claims. A prior "available"
  -- response is advisory; it never permits two accounts to win verification.
  insert into private.customer_phone_claims(phone,user_ids)
    values(v_phone,array[new.id]) on conflict(phone) do nothing;
  select user_ids into v_users from private.customer_phone_claims where phone=v_phone for update;
  if not (new.id = any(v_users)) then
    raise exception 'Mobile number already registered' using errcode='P2001';
  end if;
  -- Hold the old number during an unfinished change. Release it only after
  -- another number is successfully verified. Preserve any legacy co-owners.
  delete from private.customer_phone_claims where phone<>v_phone and user_ids=array[new.id];
  update private.customer_phone_claims set user_ids=array_remove(user_ids,new.id)
    where phone<>v_phone and new.id=any(user_ids);
  return new;
end $$;
revoke all on function private.claim_verified_customer_phone() from public, anon, authenticated;
-- BEFORE triggers run alphabetically: clear_changed_phone_verification must
-- run first so a normal phone edit cannot claim an unverified number.
create trigger profiles_zz_claim_verified_phone before insert or update of phone,phone_verified_at
on public.profiles for each row execute function private.claim_verified_customer_phone();

create function private.release_deleted_customer_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from private.customer_phone_claims where user_ids=array[old.id];
  update private.customer_phone_claims set user_ids=array_remove(user_ids,old.id)
    where old.id=any(user_ids);
  return old;
end $$;
revoke all on function private.release_deleted_customer_phone() from public, anon, authenticated;
create trigger profiles_release_deleted_phone after delete on public.profiles
for each row execute function private.release_deleted_customer_phone();

-- Rollback (only after reverting the Edge Function): drop the two new profile
-- triggers, their private functions, can_enroll_customer_phone, the claims table,
-- and normalized_customer_phone. No existing table or customer data was changed.
