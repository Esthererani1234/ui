create or replace function public.convert_unpaid_card_order_to_wire(
  p_order_id bigint,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_wire_total numeric(14,2);
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order not found';
  end if;

  if v_order.payment_method = 'wire' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'payment_method', v_order.payment_method,
      'subtotal', v_order.subtotal,
      'shipping', v_order.shipping_amount,
      'surcharge', v_order.payment_surcharge,
      'total', v_order.total,
      'price_locked_until', v_order.price_locked_until
    );
  end if;

  if v_order.payment_method <> 'card' then
    raise exception 'Only an unpaid card order can change to bank wire';
  end if;
  if v_order.payment_status in ('paid', 'refunded', 'disputed') then
    raise exception 'This order can no longer change payment method';
  end if;
  if v_order.status in ('cancelled', 'completed', 'shipped') then
    raise exception 'This order can no longer change payment method';
  end if;

  v_wire_total := round(v_order.subtotal + v_order.shipping_amount, 2);

  update public.payment_attempts
  set status = 'expired',
      checkout_url = null,
      expires_at = now(),
      updated_at = now()
  where order_id = v_order.id
    and provider = 'stripe'
    and status in ('created', 'pending', 'confirming');

  update public.orders
  set payment_method = 'wire',
      payment_status = 'unpaid',
      payment_provider = null,
      provider_payment_id = null,
      provider_checkout_url = null,
      payment_due_at = null,
      payment_surcharge = 0,
      total = v_wire_total,
      status = 'pending_review',
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_method', v_order.payment_method,
    'subtotal', v_order.subtotal,
    'shipping', v_order.shipping_amount,
    'surcharge', v_order.payment_surcharge,
    'total', v_order.total,
    'price_locked_until', v_order.price_locked_until
  );
end;
$$;

revoke all on function public.convert_unpaid_card_order_to_wire(bigint, uuid)
from public, anon, authenticated;
grant execute on function public.convert_unpaid_card_order_to_wire(bigint, uuid)
to service_role;
