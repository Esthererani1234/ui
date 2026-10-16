-- Preserve current payment/status on tracking-only edits. No production rows are rewritten.
create or replace function private.guard_inflight_payment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.total is distinct from old.total or new.payment_method is distinct from old.payment_method
      or new.price_locked_until is distinct from old.price_locked_until or (new.status='cancelled' and old.status<>'cancelled'))
    and (exists(select 1 from private.card_payment_claims where order_id=old.id)
      or exists(select 1 from public.payment_attempts where order_id=old.id and provider='stripe' and status in ('created','pending','confirming'))) then
    raise exception 'A card payment is unresolved. Reconcile it before changing this order.' using errcode='23514';
  end if;
  if old.status='cancelled' and new.status<>'cancelled' then raise exception 'Cancelled orders cannot be reopened'; end if;
  if new.status is distinct from old.status then
    if old.status='completed' or (old.status='shipped' and new.status not in ('completed','cancelled'))
      or (old.status='processing' and new.status not in ('shipped','cancelled')) then
      raise exception 'Fulfillment cannot be moved backwards';
    end if;
    if new.status='payment_received' and new.payment_status<>'paid' then raise exception 'Payment is required before fulfillment'; end if;
  end if;
  if new.status in ('processing','shipped','completed') and new.status is distinct from old.status then
    if new.payment_status<>'paid' then raise exception 'Payment is required before fulfillment'; end if;
    if exists(select 1 from public.order_risk_reviews where order_id=old.id and decision<>'approved') then
      raise exception 'Complete the risk review before fulfillment';
    end if;
    if (new.status='processing' and old.status not in ('pending_review','awaiting_payment','payment_received'))
      or (new.status='shipped' and old.status<>'processing') or (new.status='completed' and old.status<>'shipped') then
      raise exception 'Invalid fulfillment transition';
    end if;
  end if;
  if old.status in ('shipped','completed') and new.status='cancelled' then raise exception 'Shipped orders require a return process'; end if;
  return new;
end $$;

create or replace function public.admin_update_order(
  p_actor_user_id uuid, p_order_id bigint, p_status text, p_payment_status text,
  p_tracking_number text, p_internal_notes text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_status text; v_payment_status text;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_user_id) then raise exception 'Administrator access required'; end if;
  if char_length(coalesce(p_internal_notes, '')) > 5000 or char_length(coalesce(p_tracking_number, '')) > 200 or char_length(coalesce(p_reason, '')) > 1000 or char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A valid audit reason is required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  v_status := coalesce(p_status, v_order.status);
  v_payment_status := coalesce(p_payment_status, v_order.payment_status);
  if v_status not in ('pending_review', 'awaiting_payment', 'payment_received', 'processing', 'shipped', 'completed', 'cancelled') then raise exception 'Invalid order status'; end if;
  if v_payment_status not in ('unpaid', 'pending', 'confirming', 'paid', 'partially_paid', 'expired', 'refunded', 'failed', 'disputed') then raise exception 'Invalid payment status'; end if;
  if v_payment_status is distinct from v_order.payment_status then
    if v_order.payment_method <> 'wire' then raise exception 'Provider payment state must be reconciled by the payment provider'; end if;
    if v_order.status='cancelled' then raise exception 'Cancelled orders cannot accept manual payment'; end if;
    if v_order.payment_status in ('paid','refunded','disputed') and v_payment_status not in ('refunded','disputed') then raise exception 'A settled payment cannot be downgraded'; end if;
  end if;
  if v_order.status = 'cancelled'  and v_status <> 'cancelled' then raise exception 'Cancelled orders cannot be reopened automatically'; end if;
  if v_order.status <> 'cancelled' and v_status = 'cancelled' then
    update public.products products set inventory_count = products.inventory_count + lines.quantity
    from (select product_id, sum(quantity)::integer quantity from public.order_items where order_id = p_order_id and product_id is not null group by product_id) lines
    where products.id = lines.product_id;
  end if;
  -- A single admin shipment action records the required intermediate state atomically.
  -- Both updates still run payment and risk triggers; any failure rolls back everything.
  if v_status = 'shipped' and v_order.status in ('pending_review','awaiting_payment','payment_received') then
    update public.orders set status='processing', payment_status=v_payment_status where id=p_order_id;
  end if;
  update public.orders set status = v_status, payment_status = v_payment_status,
    paid_at = case when v_payment_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
    tracking_number = case when p_tracking_number is null then tracking_number else nullif(trim(p_tracking_number), '') end,
    internal_notes = case when p_internal_notes is null then internal_notes else nullif(trim(p_internal_notes), '') end, updated_at = now()
  where id = p_order_id;
  insert into public.admin_audit_log(actor_user_id, action, target_type, target_id, reason, metadata)
  values (p_actor_user_id, case when v_payment_status = 'paid' and v_order.payment_status is distinct from 'paid' and v_order.payment_method = 'wire' then 'wire.manually_marked_paid' else 'order.updated' end,
    'order', p_order_id::text, trim(p_reason), jsonb_build_object('order_number', v_order.order_number, 'previous_status', v_order.status, 'new_status', v_status, 'previous_payment_status', v_order.payment_status, 'new_payment_status', v_payment_status, 'tracking_changed', p_tracking_number is not null and nullif(trim(p_tracking_number),'') is distinct from v_order.tracking_number, 'notes_changed', p_internal_notes is not null and nullif(trim(p_internal_notes),'') is distinct from v_order.internal_notes));
  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

revoke all on function public.admin_update_order(uuid,bigint,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_update_order(uuid,bigint,text,text,text,text,text) to service_role;
