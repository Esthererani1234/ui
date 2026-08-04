-- Replace the active crypto checkout provider with NOWPayments. BitPay remains
-- accepted only for historical ledger rows created before this migration.

alter table public.orders drop constraint if exists orders_payment_provider_check;
alter table public.orders add constraint orders_payment_provider_check
  check (payment_provider is null or payment_provider in ('manual_wire', 'stripe', 'bitpay', 'nowpayments'));

alter table public.payment_attempts drop constraint if exists payment_attempts_provider_check;
alter table public.payment_attempts add constraint payment_attempts_provider_check
  check (provider in ('manual_wire', 'stripe', 'bitpay', 'nowpayments'));

alter table public.payment_events drop constraint if exists payment_events_provider_check;
alter table public.payment_events add constraint payment_events_provider_check
  check (provider in ('stripe', 'bitpay', 'nowpayments', 'manual_wire'));

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
  if p_provider not in ('stripe', 'bitpay', 'nowpayments', 'manual_wire') then raise exception 'Invalid provider'; end if;
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
