-- Local preparation only. Deploy before the matching server code. No historical
-- payment is rewritten, no claim is expired, and manual capture stays disabled.
create table private.card_payment_requests (
  order_id bigint not null references public.orders(id),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  amount_cents bigint not null check(amount_cents > 0),
  provider_payment_id text unique,
  created_at timestamptz not null default clock_timestamp(),
  primary key(order_id,request_hash)
);
alter table private.card_payment_requests enable row level security;
revoke all on private.card_payment_requests from public,anon,authenticated;

-- New entry point keeps an old server deployment from creating recovery rows
-- without the matching Stripe metadata during a migration-first rollout.
create function public.claim_card_payment_request(p_order_id bigint,p_user_id uuid,p_request_hash text,p_expected_total numeric)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; v_hash text;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.total is distinct from p_expected_total or o.total<=0 or o.payment_method<>'card'
    or o.status not in ('pending_review','awaiting_payment') or o.payment_status in ('paid','refunded','disputed')
    or o.price_locked_until is null or o.price_locked_until<=clock_timestamp()
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select request_hash into v_hash from private.card_payment_claims where order_id=p_order_id;
  if found then
    if v_hash<>p_request_hash or not exists(select 1 from private.card_payment_requests
      where order_id=p_order_id and request_hash=p_request_hash) then return false; end if;
  else
    -- A completed request cannot be reused after its claim has been released.
    if exists(select 1 from private.card_payment_requests where order_id=p_order_id and request_hash=p_request_hash)
      or exists(select 1 from public.payment_attempts where order_id=p_order_id and provider='stripe' and status in ('created','pending','confirming','paid')) then return false; end if;
    insert into private.card_payment_claims(order_id,request_hash) values(p_order_id,p_request_hash);
  end if;
  insert into private.card_payment_requests(order_id,request_hash,amount_cents)
    values(p_order_id,p_request_hash,round(o.total*100)::bigint) on conflict do nothing;
  return true;
end $$;

-- Only the server may attest a canonical Stripe intent. The durable claim,
-- order owner, amount and one-to-one intent mapping must all agree.
create function public.bind_card_payment_intent(p_order_id bigint,p_user_id uuid,p_request_hash text,p_intent_id text,p_amount_cents bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; r private.card_payment_requests%rowtype;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.payment_method<>'card' or p_intent_id is null or p_intent_id !~ '^pi_[A-Za-z0-9]+$'
    or p_amount_cents is null or p_amount_cents<=0 or round(o.total*100)<>p_amount_cents then
    raise exception 'Payment identity mismatch'; end if;
  select * into r from private.card_payment_requests where order_id=p_order_id and request_hash=p_request_hash for update;
  if not found or r.amount_cents<>p_amount_cents or (r.provider_payment_id is not null and r.provider_payment_id<>p_intent_id) then
    raise exception 'Payment claim mismatch'; end if;
  if o.payment_provider='stripe' and o.provider_payment_id=p_intent_id then
    if exists(select 1 from private.card_payment_claims where order_id=o.id and request_hash<>p_request_hash) then
      raise exception 'A newer payment request is unresolved'; end if;
    if r.provider_payment_id is distinct from p_intent_id or not exists(select 1 from public.payment_attempts
      where order_id=o.id and provider='stripe' and provider_payment_id=p_intent_id and amount=o.total and currency='USD') then
      raise exception 'Payment binding mismatch'; end if;
    -- Webhook/worker replays never reset an already-settled or failed attempt.
    return to_jsonb(o);
  end if;
  if r.provider_payment_id is not null or o.payment_status in ('paid','refunded','disputed')
    or o.status not in ('pending_review','awaiting_payment')
    or not exists(select 1 from private.card_payment_claims where order_id=o.id and request_hash=p_request_hash)
    or exists(select 1 from public.payment_attempts where order_id=o.id and provider='stripe' and status in ('created','pending','confirming','paid'))
    or (o.provider_payment_id is not null and not exists(select 1 from public.payment_attempts
      where order_id=o.id and provider='stripe' and provider_payment_id=o.provider_payment_id and status in ('failed','expired'))) then
    raise exception 'Payment cannot replace the current attempt'; end if;
  update private.card_payment_requests set provider_payment_id=p_intent_id where order_id=o.id and request_hash=p_request_hash;
  insert into public.payment_attempts(order_id,provider,provider_payment_id,status,amount,currency,expires_at)
    values(o.id,'stripe',p_intent_id,'pending',o.total,'USD',o.price_locked_until);
  -- A fresh attempt starts pending, independently of a previous decline.
  -- Existing mark_payment_state monotonicity still protects each bound attempt.
  update public.orders set payment_provider='stripe',provider_payment_id=p_intent_id,provider_checkout_url=null,
    payment_due_at=price_locked_until,payment_status='pending',updated_at=now()
    where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

create function public.get_card_payment_recovery(p_order_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('request_hash',c.request_hash,'provider_payment_id',r.provider_payment_id,'legacy',r.order_id is null)
  from private.card_payment_claims c left join private.card_payment_requests r
    on r.order_id=c.order_id and r.request_hash=c.request_hash where c.order_id=p_order_id;
$$;
revoke all on function public.claim_card_payment_request(bigint,uuid,text,numeric),public.bind_card_payment_intent(bigint,uuid,text,text,bigint),public.get_card_payment_recovery(bigint) from public,anon,authenticated;
grant execute on function public.claim_card_payment_request(bigint,uuid,text,numeric),public.bind_card_payment_intent(bigint,uuid,text,text,bigint),public.get_card_payment_recovery(bigint) to service_role;

create or replace function public.claim_payment_reconciliations() returns table(order_id bigint,lease_id uuid)
language sql security definer set search_path='' as $$
  with candidates as (
    select o.id from public.orders o left join private.payment_reconciliation_state r on r.order_id=o.id
    where o.payment_method='card' and o.payment_status not in ('paid','refunded','disputed')
      and coalesce(r.next_check_at,'-infinity')<=clock_timestamp()
      and (exists(select 1 from private.card_payment_claims c where c.order_id=o.id and c.created_at<clock_timestamp()-interval '2 minutes')
        or (o.payment_provider='stripe' and o.provider_payment_id like 'pi_%' and exists(
          select 1 from public.payment_attempts p where p.order_id=o.id and p.provider='stripe' and p.provider_payment_id=o.provider_payment_id
            and p.status in ('created','pending','confirming') and p.created_at<clock_timestamp()-interval '2 minutes')))
    order by r.checked_at nulls first,o.id limit 3 for update of o skip locked
  ), claimed as (
    insert into private.payment_reconciliation_state(order_id,lease_id,next_check_at)
    select id,gen_random_uuid(),clock_timestamp()+interval '3 minutes' from candidates
    on conflict(order_id) do update set lease_id=excluded.lease_id,next_check_at=excluded.next_check_at
    returning order_id,lease_id
  ) select * from claimed;
$$;
create or replace function private.dispatch_payment_reconciliation() returns void language plpgsql security definer set search_path='' as $$
declare secret_value text;
begin
  if not exists(select 1 from private.card_payment_claims)
    and not exists(select 1 from public.orders where payment_provider='stripe' and payment_status in ('pending','confirming') and provider_payment_id like 'pi_%') then return; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where name='payment_reconciliation_token';
  if secret_value is null then return; end if;
  perform net.http_post(url:='https://goldonthespot.com/api/operations/reconcile-payments',headers:=jsonb_build_object('Content-Type','application/json','x-reconciliation-token',secret_value),body:='{}',timeout_milliseconds:=55000);
end $$;

-- Runs for provider settlement AND an administrator's wire-paid action. The
-- review reset and its audit commit with the payment; stale approvals conflict.
create function private.hold_late_payment() returns trigger
language plpgsql security definer set search_path='' as $$
declare deadline timestamptz; previous_decision text;
begin
  if new.payment_status<>'paid' or old.payment_status='paid' then return new; end if;
  deadline:=case when old.payment_method='wire' then old.payment_due_at else old.price_locked_until end;
  if old.status<>'cancelled' and deadline is not null and clock_timestamp()<=deadline then return new; end if;
  select decision into previous_decision from public.order_risk_reviews where order_id=old.id for update;
  insert into public.order_risk_reviews(order_id,user_id,decision,signals,reviewed_at,updated_at)
    values(old.id,old.user_id,'pending',jsonb_build_array(jsonb_build_object('code','late_payment','label','Settlement requires explicit review')),
      clock_timestamp(),now())
    on conflict(order_id) do update set decision=case when public.order_risk_reviews.decision='rejected' then 'rejected' else 'pending' end,
      signals=coalesce(public.order_risk_reviews.signals,'[]'::jsonb)||excluded.signals,
      reviewed_by=null,reviewed_at=excluded.reviewed_at,updated_at=now();
  insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
    values(null,'payment.late_review_required','order',old.id::text,'Settlement after payment deadline or cancellation',
      jsonb_build_object('previous_decision',previous_decision,'deadline',deadline,'provider',new.payment_provider,'provider_payment_id',new.provider_payment_id));
  if old.status in ('pending_review','awaiting_payment','payment_received') then new.status:='pending_review'; end if;
  new.internal_notes:=concat_ws(E'\n',nullif(new.internal_notes,''),'PAYMENT REVIEW: late settlement; approve the reset risk review before fulfillment.');
  return new;
end $$;
revoke all on function private.hold_late_payment() from public,anon,authenticated;
create trigger orders_00_late_payment_review before update of payment_status on public.orders
  for each row execute function private.hold_late_payment();

-- Preserve the state machine, moving deadline enforcement to the common trigger
-- above so timely wires are not classified using a ten-minute spot quote.
create or replace function public.mark_payment_state(p_order_id bigint,p_provider text,p_provider_payment_id text,
  p_payment_status text,p_attempt_status text,p_paid_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
  if p_provider not in ('stripe','bitpay','nowpayments','manual_wire') then raise exception 'Invalid provider'; end if;
  if p_payment_status not in ('unpaid','pending','confirming','paid','partially_paid','expired','refunded','failed','disputed') then raise exception 'Invalid payment state'; end if;
  if p_attempt_status not in ('created','pending','confirming','paid','expired','failed','refunded','disputed') then raise exception 'Invalid attempt state'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_provider is distinct from p_provider or o.provider_payment_id is distinct from p_provider_payment_id then raise exception 'Payment reference mismatch'; end if;
  if not exists(select 1 from public.payment_attempts where order_id=p_order_id and provider=p_provider
    and provider_payment_id=p_provider_payment_id and amount=o.total and currency='USD') then raise exception 'Payment amount mismatch'; end if;
  -- A callback for the previous decline must not release a newer unbound claim.
  if p_provider='stripe' and exists(select 1 from private.card_payment_claims c
    join private.card_payment_requests r on r.order_id=c.order_id and r.request_hash=c.request_hash
    where c.order_id=p_order_id and r.provider_payment_id is distinct from p_provider_payment_id) then
    raise exception 'A newer payment request is unresolved'; end if;
  if o.payment_status in ('refunded','disputed') or (o.payment_status='paid' and p_payment_status not in ('refunded','disputed')) then return; end if;
  if o.payment_status in ('failed','expired') and p_payment_status in ('unpaid','pending','confirming','partially_paid') then return; end if;
  update public.payment_attempts set status=p_attempt_status,updated_at=now()
    where order_id=p_order_id and provider=p_provider and provider_payment_id=p_provider_payment_id;
  update public.orders set payment_status=p_payment_status,
    paid_at=case when p_payment_status='paid' then coalesce(p_paid_at,now()) else paid_at end,
    status=case when o.status in ('cancelled','processing','shipped','completed') then o.status
      when p_payment_status='paid' then 'payment_received'
      when p_payment_status in ('pending','confirming') then 'awaiting_payment' else o.status end,
    updated_at=now() where id=p_order_id;
  if p_payment_status in ('paid','failed','expired','refunded','disputed') then delete from private.card_payment_claims where order_id=p_order_id; end if;
end $$;
-- Existing service-only grants on replaced RPCs remain unchanged. Keep the
-- request ledger on rollback: it is reconciliation evidence, not a retry TTL.
