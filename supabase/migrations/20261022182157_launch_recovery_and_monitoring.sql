-- A password-reset SMS authorization is recent and consumed exactly once.
-- This strengthens our endpoint; native Auth reset protection still needs MFA.
create function public.consume_recovery_sms(p_user_id uuid,p_session_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare consumed uuid;
begin
 if not public.check_customer_session(p_user_id,p_session_id,true) then return false;end if;
 delete from public.customer_sms_sessions s where s.user_id=p_user_id and s.session_id::text=p_session_id
 and s.purpose='recovery' and s.expires_at>clock_timestamp() and s.verified_at>clock_timestamp()-interval '5 minutes'
 and exists(select 1 from public.profiles p where p.id=p_user_id and p.phone=s.phone and p.phone_verified_at is not null)
 returning s.session_id into consumed;
 return consumed is not null;
end $$;
revoke all on function public.consume_recovery_sms(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_recovery_sms(uuid,text) to service_role;

create table private.payment_reconciliation_state(
 order_id bigint primary key references public.orders(id),
 lease_id uuid not null default gen_random_uuid(),
 next_check_at timestamptz not null default now(),
 checked_at timestamptz,
 last_error text
);
alter table private.payment_reconciliation_state enable row level security;
revoke all on private.payment_reconciliation_state from public,anon,authenticated;
create function public.claim_payment_reconciliations() returns table(order_id bigint,lease_id uuid)
language sql security definer set search_path='' as $$
 with candidates as (
  select o.id from public.orders o left join private.payment_reconciliation_state r on r.order_id=o.id
  where o.payment_method='card' and o.payment_provider='stripe' and o.provider_payment_id like 'pi_%'
  and o.payment_status in ('pending','confirming') and coalesce(r.next_check_at,'-infinity')<=clock_timestamp()
  and exists(select 1 from public.payment_attempts p where p.order_id=o.id and p.provider='stripe' and p.provider_payment_id=o.provider_payment_id and p.created_at<clock_timestamp()-interval '2 minutes')
  order by r.checked_at nulls first,o.id limit 3 for update of o skip locked
 ), claimed as (
  insert into private.payment_reconciliation_state(order_id,lease_id,next_check_at)
  select id,gen_random_uuid(),clock_timestamp()+interval '3 minutes' from candidates
  on conflict(order_id) do update set lease_id=excluded.lease_id,next_check_at=excluded.next_check_at
  returning order_id,lease_id
 ) select * from claimed;
$$;
create function public.finish_payment_reconciliation(p_order_id bigint,p_lease_id uuid,p_error text default null)
returns void language sql security definer set search_path='' as $$
 update private.payment_reconciliation_state set checked_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '2 minutes',
 last_error=case when p_error is null then null else 'reconciliation_failed' end
 where order_id=p_order_id and lease_id=p_lease_id;
$$;
revoke all on function public.claim_payment_reconciliations(),public.finish_payment_reconciliation(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_payment_reconciliations(),public.finish_payment_reconciliation(bigint,uuid,text) to service_role;

do $$begin
 if not exists(select 1 from vault.secrets where name='payment_reconciliation_token')then
 perform vault.create_secret(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'payment_reconciliation_token','Internal payment reconciliation');end if;
end $$;
create function public.check_payment_reconciliation_token(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select sha256(convert_to(p_token,'UTF8'))=sha256(convert_to(decrypted_secret,'UTF8')) from vault.decrypted_secrets where name='payment_reconciliation_token'),false);
$$;
revoke all on function public.check_payment_reconciliation_token(text) from public,anon,authenticated;
grant execute on function public.check_payment_reconciliation_token(text) to service_role;
create function private.dispatch_payment_reconciliation() returns void language plpgsql security definer set search_path='' as $$
declare secret_value text;
begin
 if not exists(select 1 from public.orders where payment_provider='stripe' and payment_status in ('pending','confirming') and provider_payment_id like 'pi_%') then return;end if;
 select decrypted_secret into secret_value from vault.decrypted_secrets where name='payment_reconciliation_token';
 if secret_value is null then return;end if;
 perform net.http_post(url:='https://goldonthespot.com/api/operations/reconcile-payments',headers:=jsonb_build_object('Content-Type','application/json','x-reconciliation-token',secret_value),body:='{}',timeout_milliseconds:=55000);
end $$;
revoke all on function private.dispatch_payment_reconciliation() from public,anon,authenticated;

create function public.get_launch_health() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'email_enabled',exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'),
 'email_failed',(select count(*) from public.order_email_outbox where status='failed'),
 'email_overdue',(select count(*) from public.order_email_outbox where status in ('pending','sending') and created_at<now()-interval '15 minutes'),
 'email_accepted',(select count(*) from public.order_email_outbox where status='sent'),
 'payment_stuck',(select count(*) from public.orders where payment_method='card' and payment_status in ('pending','confirming') and price_locked_until<now()-interval '15 minutes'),
 'payment_unbound',(select count(*) from private.card_payment_claims c join public.orders o on o.id=c.order_id where c.created_at<now()-interval '15 minutes' and (o.provider_payment_id is null or o.payment_provider is distinct from 'stripe')),
 'reconciliation_errors',(select count(*) from private.payment_reconciliation_state where last_error is not null),
 'shipping_flat',(select value from public.app_settings where key='shipping_flat'),
 'manual_capture_enabled',exists(select 1 from public.app_settings where key='card_manual_capture_enabled' and value='true'),
 'sms_required',exists(select 1 from public.app_settings where key='customer_sms_mfa_required' and value='true'),
 'checked_at',now());
$$;
revoke all on function public.get_launch_health() from public,anon,authenticated;
grant execute on function public.get_launch_health() to service_role;
-- Schedule dispatch_payment_reconciliation only after the Vercel endpoint is live.
-- Retain both ledgers on rollback; never reset or erase payment records.
