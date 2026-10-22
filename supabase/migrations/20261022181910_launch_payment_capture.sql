-- Opt-in until Stripe test-mode/3DS acceptance is complete. Existing payments
-- retain their original capture mode; no historical order is rewritten.
insert into public.app_settings(key,value,is_public) values('card_manual_capture_enabled','false',false) on conflict(key) do nothing;
create table private.card_capture_authorizations (
 provider_payment_id text primary key,
 order_id bigint not null references public.orders(id),
 amount_cents bigint not null check(amount_cents>0),
 authorized_at timestamptz not null default clock_timestamp(),
 lock_expires_at timestamptz not null
);
alter table private.card_capture_authorizations enable row level security;
revoke all on private.card_capture_authorizations from public,anon,authenticated;

create function public.authorize_card_capture(p_order_id bigint,p_intent_id text,p_amount_cents bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id for update;
 if not found or o.payment_method<>'card' or o.payment_provider<>'stripe'
   or o.provider_payment_id is distinct from p_intent_id
   or o.status not in ('pending_review','awaiting_payment')
   or o.payment_status not in ('unpaid','pending','confirming')
   or p_amount_cents is null or p_amount_cents<=0 or round(o.total*100)<>p_amount_cents
   or o.price_locked_until is null or o.price_locked_until<=clock_timestamp()+interval '15 seconds'
   or not exists(select 1 from private.card_payment_claims where order_id=o.id)
   or not exists(select 1 from public.payment_attempts where order_id=o.id and provider='stripe' and provider_payment_id=p_intent_id and amount=o.total and currency='USD')
 then return false;end if;
 insert into private.card_capture_authorizations(provider_payment_id,order_id,amount_cents,lock_expires_at)
 values(p_intent_id,o.id,p_amount_cents,o.price_locked_until) on conflict do nothing;
 return exists(select 1 from private.card_capture_authorizations where provider_payment_id=p_intent_id and order_id=o.id and amount_cents=p_amount_cents and lock_expires_at=o.price_locked_until);
end $$;
revoke all on function public.authorize_card_capture(bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.authorize_card_capture(bigint,text,bigint) to service_role;

-- Rollback: set card_manual_capture_enabled=false. Keep reconciliation available
-- for already-authorized intents and preserve financial audit/history tables.
