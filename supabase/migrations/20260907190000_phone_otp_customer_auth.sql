-- Recognize Supabase phone-OTP customers as having verified SMS identity.
-- Existing password + phone-MFA customers continue to qualify unchanged.

do $migration$
declare
  v_definition text;
  v_old text := $old$  select exists (
    select 1 from auth.mfa_factors
    where user_id = new.user_id
      and status = 'verified'
      and factor_type = 'phone'
  ) into v_phone_mfa;$old$;
  v_new text := $new$  select (
    exists (
      select 1 from auth.mfa_factors
      where user_id = new.user_id
        and status = 'verified'
        and factor_type = 'phone'
    ) or exists (
      select 1 from auth.users
      where id = new.user_id
        and phone is not null
        and phone_confirmed_at is not null
    )
  ) into v_phone_mfa;$new$;
begin
  select pg_get_functiondef('private.assess_order_risk()'::regprocedure)
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'The order-risk function did not match the expected version';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

create or replace function public.admin_customer_security_summary()
returns table (user_id uuid, has_phone_mfa boolean, has_any_mfa boolean)
language sql
security definer
set search_path = ''
as $$
  select
    users.id,
    (
      users.phone is not null
      and users.phone_confirmed_at is not null
    ) or exists (
      select 1 from auth.mfa_factors factors
      where factors.user_id = users.id
        and factors.status = 'verified'
        and factors.factor_type = 'phone'
    ),
    (
      users.phone is not null
      and users.phone_confirmed_at is not null
    ) or exists (
      select 1 from auth.mfa_factors factors
      where factors.user_id = users.id
        and factors.status = 'verified'
    )
  from auth.users users;
$$;

revoke all on function public.admin_customer_security_summary()
from public, anon, authenticated;
grant execute on function public.admin_customer_security_summary()
to service_role;
