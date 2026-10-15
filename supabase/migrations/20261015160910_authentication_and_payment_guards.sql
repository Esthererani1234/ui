-- Additive guardrails. No customer/order records are deleted or rewritten.
create table private.security_rate_limits (
  scope text not null, subject text not null,
  started_at timestamptz not null default now(), hits integer not null default 1,
  primary key(scope, subject)
);
alter table private.security_rate_limits enable row level security;
revoke all on private.security_rate_limits from public, anon, authenticated;

create function public.consume_security_rate_limit(p_scope text, p_subject text, p_limit integer, p_seconds integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v private.security_rate_limits%rowtype;
begin
  if length(p_scope) not between 1 and 80 or length(p_subject) not between 1 and 128
    or p_limit not between 1 and 10000 or p_seconds not between 1 and 86400
    or p_scope is null or p_subject is null or p_limit is null or p_seconds is null then
    raise exception 'Invalid rate limit';
  end if;
  insert into private.security_rate_limits as limits(scope,subject) values(p_scope,p_subject)
  on conflict(scope,subject) do update set
    started_at = case when limits.started_at <= now() - make_interval(secs => p_seconds) then now() else limits.started_at end,
    hits = case when limits.started_at <= now() - make_interval(secs => p_seconds) then 1 else least(limits.hits + 1, p_limit + 1) end
  returning * into v;
  return case when v.hits <= p_limit then 0 else greatest(1,ceil(extract(epoch from v.started_at + make_interval(secs => p_seconds) - now()))::integer) end;
end $$;
revoke all on function public.consume_security_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_security_rate_limit(text,text,integer,integer) to service_role;

create function public.check_customer_session(p_user_id uuid, p_session_id text, p_require_sms boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.user_id=p_user_id and s.id::text=p_session_id
      and (s.not_after is null or s.not_after>now())
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
  ) and (not p_require_sms
    or exists(select 1 from public.app_settings where key='customer_sms_mfa_required' and value='false'::jsonb)
    or exists (
      select 1 from public.customer_sms_sessions s join public.profiles p on p.id=s.user_id
      where s.user_id=p_user_id and s.session_id::text=p_session_id and s.expires_at>now()
        and p.phone=s.phone and p.phone_verified_at is not null
    ));
$$;
revoke all on function public.check_customer_session(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.check_customer_session(uuid,text,boolean) to service_role;

create function private.active_session() returns boolean language sql stable security definer set search_path = '' as $$
  select public.check_customer_session((select auth.uid()),coalesce((select auth.jwt()->>'session_id'),''),false);
$$;
revoke all on function private.active_session() from public,anon;
grant execute on function private.active_session() to authenticated;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.active_session()) and coalesce((select auth.jwt()->>'aal'),'')='aal2'
    and exists(select 1 from public.admin_users where user_id=(select auth.uid()));
$$;
create or replace function private.customer_sms_verified() returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.is_admin()) or public.check_customer_session((select auth.uid()),coalesce((select auth.jwt()->>'session_id'),''),true);
$$;
create policy "active profile session" on public.profiles as restrictive for all to authenticated
  using ((select private.active_session())) with check ((select private.active_session()));
create policy "active admin membership session" on public.admin_users as restrictive for select to authenticated
  using ((select private.active_session()));

-- A password-only session cannot swap an already enrolled second factor.
-- Existing authenticated sessions must prove the OLD phone before editing it.
create or replace function private.clear_changed_phone_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is distinct from old.phone then
    if old.phone_verified_at is not null and (select auth.jwt()->>'role')='authenticated'
      and not (select private.is_admin()) and not exists (
        select 1 from public.customer_sms_sessions s where s.user_id=old.id and s.phone=old.phone
          and s.session_id::text=coalesce((select auth.jwt()->>'session_id'),'') and s.expires_at>now()
          and (select private.active_session())
      ) then raise exception 'Verify your current phone before changing it' using errcode='42501'; end if;
    delete from public.customer_sms_sessions where user_id=old.id;
    -- Only service operations may supply verification; client column grants exclude it.
    if new.phone_verified_at is not distinct from old.phone_verified_at then new.phone_verified_at:=null; end if;
  end if;
  return new;
end $$;

create function public.claim_sms_attempt(p_challenge_id uuid,p_user_id uuid,p_session_id text,p_max_attempts integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.customer_sms_challenges%rowtype;
begin
  if not public.check_customer_session(p_user_id,p_session_id,false) then return null; end if;
  update public.customer_sms_challenges set attempt_count=attempt_count+1
    where id=p_challenge_id and user_id=p_user_id and session_id::text=p_session_id
      and status='pending' and expires_at>now() and attempt_count<least(greatest(p_max_attempts,3),10)
    returning * into v;
  if not found then return null; end if;
  return to_jsonb(v);
end $$;
create function public.complete_sms_challenge(p_challenge_id uuid,p_user_id uuid,p_session_id text,p_session_hours integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.customer_sms_challenges%rowtype; p public.profiles%rowtype;
begin
  if not public.check_customer_session(p_user_id,p_session_id,false) then return false; end if;
  select * into p from public.profiles where id=p_user_id for update;
  if not found then return false; end if;
  select * into v from public.customer_sms_challenges where id=p_challenge_id and user_id=p_user_id
    and session_id::text=p_session_id and status='pending' and expires_at>now() and attempt_count>0 for update;
  if not found then return false; end if;
  -- An older challenge must not replace a phone enrolled by another request.
  if p.phone_verified_at is not null and p.phone is distinct from v.phone then return false; end if;
  update public.profiles set phone=v.phone,phone_verified_at=now() where id=p_user_id;
  insert into public.customer_sms_sessions(session_id,user_id,phone,purpose,verified_at,expires_at)
    values(v.session_id,p_user_id,v.phone,v.purpose,now(),now()+make_interval(hours=>least(greatest(p_session_hours,1),2160)))
    on conflict(session_id) do update set phone=excluded.phone,purpose=excluded.purpose,verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  update public.customer_sms_challenges set status=case when id=v.id then 'verified' else 'expired' end,
    verified_at=case when id=v.id then now() else verified_at end
    where user_id=p_user_id and session_id=v.session_id and status='pending';
  return true;
end $$;
revoke all on function public.claim_sms_attempt(uuid,uuid,text,integer), public.complete_sms_challenge(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_sms_attempt(uuid,uuid,text,integer), public.complete_sms_challenge(uuid,uuid,text,integer) to service_role;

-- Only the audited service operation may update orders, even for browser admins.
revoke update on public.orders from authenticated;
drop policy if exists "admins update orders" on public.orders;

-- Webhook delivery and its order update commit together, or both roll back.
create function public.apply_payment_event(p_provider text,p_event_id text,p_order_id bigint,p_event_type text,
  p_provider_payment_id text,p_payment_status text,p_attempt_status text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_provider not in ('stripe','nowpayments') or p_event_id is null or length(p_event_id)>250 then raise exception 'Invalid event'; end if;
  insert into public.payment_events(provider,provider_event_id,order_id,event_type,verified,payload)
    values(p_provider,p_event_id,p_order_id,p_event_type,true,p_payload)
    on conflict(provider,provider_event_id) do nothing returning id into v_id;
  if v_id is null then return false; end if;
  perform public.mark_payment_state(p_order_id,p_provider,p_provider_payment_id,p_payment_status,p_attempt_status,null);
  update public.payment_events set processed_at=now() where id=v_id;
  return true;
end $$;
revoke all on function public.apply_payment_event(text,text,bigint,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_payment_event(text,text,bigint,text,text,text,text,jsonb) to service_role;

create table private.card_payment_claims (
  order_id bigint primary key references public.orders(id) on delete cascade,
  request_hash text not null, created_at timestamptz not null default now()
);
alter table private.card_payment_claims enable row level security;
revoke all on private.card_payment_claims from public,anon,authenticated;
create function public.claim_card_payment(p_order_id bigint,p_user_id uuid,p_request_hash text,p_expected_total numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; v_hash text;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.total is distinct from p_expected_total or o.payment_method<>'card' or o.status not in ('pending_review','awaiting_payment')
    or o.payment_status in ('paid','refunded','disputed') or o.price_locked_until is null
    or o.price_locked_until<=now() or p_request_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select request_hash into v_hash from private.card_payment_claims where order_id=p_order_id;
  if found then return v_hash=p_request_hash; end if;
  if exists(select 1 from public.payment_attempts where order_id=p_order_id and provider='stripe' and status in ('created','pending','confirming','paid')) then return false; end if;
  insert into private.card_payment_claims(order_id,request_hash) values(p_order_id,p_request_hash);
  return true;
end $$;
create function public.release_card_payment(p_order_id bigint,p_request_hash text)
returns void language sql security definer set search_path = '' as $$
  delete from private.card_payment_claims where order_id=p_order_id and request_hash=p_request_hash;
$$;
revoke all on function public.claim_card_payment(bigint,uuid,text,numeric),public.release_card_payment(bigint,text) from public,anon,authenticated;
grant execute on function public.claim_card_payment(bigint,uuid,text,numeric),public.release_card_payment(bigint,text) to service_role;

create function private.guard_inflight_payment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.total is distinct from old.total or new.payment_method is distinct from old.payment_method
      or new.price_locked_until is distinct from old.price_locked_until or (new.status='cancelled' and old.status<>'cancelled'))
    and (exists(select 1 from private.card_payment_claims where order_id=old.id)
      or exists(select 1 from public.payment_attempts where order_id=old.id and provider='stripe' and status in ('created','pending','confirming'))) then
    raise exception 'A card payment is unresolved. Reconcile it before changing this order.' using errcode='23514';
  end if;
  if old.status='cancelled' and new.status<>'cancelled' then raise exception 'Cancelled orders cannot be reopened'; end if;
  if new.status in ('processing','shipped','completed') and new.status is distinct from old.status then
    if new.payment_status<>'paid' then raise exception 'Payment is required before fulfillment'; end if;
    if exists(select 1 from public.order_risk_reviews where order_id=old.id and decision<>'approved') then
      raise exception 'Complete the risk review before fulfillment';
    end if;
    if (new.status='processing' and old.status not in ('pending_review','payment_received'))
      or (new.status='shipped' and old.status<>'processing') or (new.status='completed' and old.status<>'shipped') then
      raise exception 'Invalid fulfillment transition';
    end if;
  end if;
  if old.status in ('shipped','completed') and new.status='cancelled' then raise exception 'Shipped orders require a return process'; end if;
  return new;
end $$;
create trigger orders_guard_inflight before update on public.orders for each row execute function private.guard_inflight_payment();

create or replace function public.mark_payment_state(p_order_id bigint,p_provider text,p_provider_payment_id text,
  p_payment_status text,p_attempt_status text,p_paid_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  if p_provider not in ('stripe','bitpay','nowpayments','manual_wire') then raise exception 'Invalid provider'; end if;
  if p_payment_status not in ('unpaid','pending','confirming','paid','partially_paid','expired','refunded','failed','disputed') then raise exception 'Invalid payment state'; end if;
  if p_attempt_status not in ('created','pending','confirming','paid','expired','failed','refunded','disputed') then raise exception 'Invalid attempt state'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_provider is distinct from p_provider or o.provider_payment_id is distinct from p_provider_payment_id then
    raise exception 'Payment reference mismatch'; end if;
  if not exists(select 1 from public.payment_attempts where order_id=p_order_id and provider=p_provider
    and provider_payment_id=p_provider_payment_id and amount=o.total and currency='USD') then raise exception 'Payment amount mismatch'; end if;
  -- Financial truth is monotonic even when callbacks arrive out of order.
  if o.payment_status in ('refunded','disputed') or (o.payment_status='paid' and p_payment_status not in ('refunded','disputed')) then return; end if;
  if o.payment_status in ('failed','expired') and p_payment_status in ('unpaid','pending','confirming','partially_paid') then return; end if;
  update public.payment_attempts set status=p_attempt_status,updated_at=now()
    where order_id=p_order_id and provider=p_provider and provider_payment_id=p_provider_payment_id;
  update public.orders set payment_status=p_payment_status,
    paid_at=case when p_payment_status='paid' then coalesce(p_paid_at,now()) else paid_at end,
    status=case
      when o.status in ('cancelled','processing','shipped','completed') then o.status
      when p_payment_status='paid' and (o.price_locked_until is null or now()>o.price_locked_until) then 'pending_review'
      when p_payment_status='paid' then 'payment_received'
      when p_payment_status in ('pending','confirming') then 'awaiting_payment' else o.status end,
    internal_notes=case when p_payment_status='paid' and (o.status='cancelled' or o.price_locked_until is null or now()>o.price_locked_until)
      then concat_ws(E'\n',nullif(internal_notes,''),'PAYMENT REVIEW: payment arrived after cancellation or price-lock expiration; reconcile before fulfillment.') else internal_notes end,
    updated_at=now() where id=p_order_id;
  if p_payment_status in ('paid','failed','expired','refunded','disputed') then delete from private.card_payment_claims where order_id=p_order_id; end if;
end $$;

create function private.protect_attempt_amount() returns trigger language plpgsql set search_path='' as $$
begin
 if new.amount is distinct from old.amount or new.currency is distinct from old.currency then
   new.amount:=old.amount; new.currency:=old.currency;
 end if;
 return new;
end $$;
create trigger payment_attempts_preserve_amount before update on public.payment_attempts for each row execute function private.protect_attempt_amount();
