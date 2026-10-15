-- Preserve existing review decisions; updated scoring applies to new/repriced orders.
insert into public.app_settings(key,value,is_public) values
 ('risk_elevated_value','5000',false),('risk_high_value','10000',false),('risk_very_high_value','50000',false)
on conflict(key) do nothing;
create or replace function private.assess_order_risk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 0;
  v_signals jsonb := '[]'::jsonb;
  v_account_created timestamptz;
  v_recent_orders integer := 0;
  v_profile_postal text;
  v_customer_status text := 'normal';
  v_customer_score integer := 0;
  v_manual_review boolean := false;
  v_phone_mfa boolean := false;
  v_level text;
  v_decision text;
  v_elevated numeric := 5000;
  v_high numeric := 10000;
  v_very_high numeric := 50000;
begin
  if new.total <= 0 or (tg_op = 'UPDATE' and old.total = new.total) then
    return new;
  end if;

  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='risk_elevated_value'),5000),
    coalesce((select (value #>> '{}')::numeric from public.app_settings where key='risk_high_value'),10000),
    coalesce((select (value #>> '{}')::numeric from public.app_settings where key='risk_very_high_value'),50000)
    into v_elevated,v_high,v_very_high;
  select created_at into v_account_created from auth.users where id = new.user_id;
  select postal_code into v_profile_postal from public.profiles where id = new.user_id;
  select status, risk_score, manual_review_required
    into v_customer_status, v_customer_score, v_manual_review
  from public.customer_risk_profiles
  where user_id = new.user_id;

  select exists(select 1 from public.profiles where id=new.user_id and phone is not null and phone_verified_at is not null) into v_phone_mfa;

  if v_account_created > now() - interval '24 hours' then
    v_score := v_score + 25;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'new_account', 'label', 'Account is under 24 hours old', 'weight', 25));
  end if;

  if new.total >= v_very_high then
    v_score := v_score + 40;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'very_high_value', 'label', 'Order exceeds the very-high-value review threshold', 'weight', 40));
  elsif new.total >= v_high then
    v_score := v_score + 25;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'high_value', 'label', 'Order exceeds the high-value review threshold', 'weight', 25));
  elsif new.total >= v_elevated then
    v_score := v_score + 10;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'elevated_value', 'label', 'Order exceeds the elevated-value review threshold', 'weight', 10));
  end if;

  select count(*) into v_recent_orders
  from public.orders
  where user_id = new.user_id
    and id <> new.id
    and created_at > now() - interval '24 hours';
  if v_recent_orders >= 3 then
    v_score := v_score + 25;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'order_velocity', 'label', 'Three or more other orders in 24 hours', 'weight', 25));
  end if;

  if not v_phone_mfa then
    v_score := v_score + 20;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'phone_mfa_missing', 'label', 'No verified SMS security factor', 'weight', 20));
  end if;

  if coalesce(v_profile_postal, '') <> ''
     and coalesce(new.shipping_address ->> 'postal_code', '') <> ''
     and v_profile_postal <> new.shipping_address ->> 'postal_code' then
    v_score := v_score + 15;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'new_postal_code', 'label', 'Shipping ZIP differs from saved profile', 'weight', 15));
  end if;

  if v_customer_score > 0 then
    v_score := v_score + least(40, round(v_customer_score * 0.5)::integer);
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'customer_risk_score', 'label', 'Customer has an existing risk score', 'weight', least(40, round(v_customer_score * 0.5)::integer)));
  end if;

  if v_customer_status = 'blocked' then
    v_score := 100;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'blocked_customer', 'label', 'Customer is blocked', 'weight', 100));
  elsif v_customer_status in ('watch', 'review') then
    v_score := v_score + 20;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('code', 'customer_watch', 'label', 'Customer is on the review watchlist', 'weight', 20));
  end if;

  v_score := least(100, v_score);
  v_level := case
    when v_score >= 80 then 'critical'
    when v_score >= 60 then 'high'
    when v_score >= 30 then 'medium'
    else 'low'
  end;
  v_decision := case when v_score >= 40 or v_manual_review then 'pending' else 'approved' end;

  insert into public.order_risk_reviews (
    order_id, user_id, risk_score, risk_level, decision, signals
  ) values (
    new.id, new.user_id, v_score, v_level, v_decision, v_signals
  )
  on conflict (order_id) do update set
    risk_score = excluded.risk_score,
    risk_level = excluded.risk_level,
    decision = case
      when public.order_risk_reviews.reviewed_at is null then excluded.decision
      else public.order_risk_reviews.decision
    end,
    signals = excluded.signals;
  return new;
end;
$$;

drop trigger if exists orders_assess_risk on public.orders;
create trigger orders_assess_risk after insert or update of total on public.orders
for each row execute function private.assess_order_risk();

-- All browser risk mutations must use the audited admin service.
revoke insert,update,delete on public.customer_risk_profiles from authenticated;
revoke update,delete on public.order_risk_reviews from authenticated;

create function private.audit_browser_admin_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if (select auth.jwt()->>'role')='authenticated' then
   if not (select private.is_admin()) then raise exception 'Administrator access required' using errcode='42501'; end if;
   insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,metadata)
   values((select auth.uid()),lower(tg_table_name||'.'||tg_op),tg_table_name,
     coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'key',to_jsonb(old)->>'key'),
     jsonb_build_object('result','success'));
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function private.audit_browser_admin_change() from public,anon,authenticated;
create trigger products_audit_browser_change after insert or update or delete on public.products for each row execute function private.audit_browser_admin_change();
create trigger settings_audit_browser_change after insert or update or delete on public.app_settings for each row execute function private.audit_browser_admin_change();
create or replace function public.admin_update_order(
  p_actor_user_id uuid, p_order_id bigint, p_status text, p_payment_status text,
  p_tracking_number text, p_internal_notes text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_user_id) then raise exception 'Administrator access required'; end if;
  if p_status not in ('pending_review', 'awaiting_payment', 'payment_received', 'processing', 'shipped', 'completed', 'cancelled') then raise exception 'Invalid order status'; end if;
  if p_payment_status not in ('unpaid', 'pending', 'confirming', 'paid', 'partially_paid', 'expired', 'refunded', 'failed', 'disputed') then raise exception 'Invalid payment status'; end if;
  if char_length(coalesce(p_internal_notes, '')) > 5000 or char_length(coalesce(p_tracking_number, '')) > 200 or char_length(coalesce(p_reason, '')) > 1000 or char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A valid audit reason is required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_payment_status is distinct from v_order.payment_status then
    if v_order.payment_method <> 'wire' then raise exception 'Provider payment state must be reconciled by the payment provider'; end if;
    if v_order.status='cancelled' then raise exception 'Cancelled orders cannot accept manual payment'; end if;
    if v_order.payment_status in ('paid','refunded','disputed') and p_payment_status not in ('refunded','disputed') then raise exception 'A settled payment cannot be downgraded'; end if;
  end if;
  if v_order.status = 'cancelled'  and p_status <> 'cancelled' then raise exception 'Cancelled orders cannot be reopened automatically'; end if;
  if v_order.status <> 'cancelled' and p_status = 'cancelled' then
    update public.products products set inventory_count = products.inventory_count + lines.quantity
    from (select product_id, sum(quantity)::integer quantity from public.order_items where order_id = p_order_id and product_id is not null group by product_id) lines
    where products.id = lines.product_id;
  end if;
  update public.orders set status = p_status, payment_status = p_payment_status,
    paid_at = case when p_payment_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
    tracking_number = nullif(trim(p_tracking_number), ''), internal_notes = nullif(trim(p_internal_notes), ''), updated_at = now()
  where id = p_order_id;
  insert into public.admin_audit_log(actor_user_id, action, target_type, target_id, reason, metadata)
  values (p_actor_user_id, case when p_payment_status = 'paid' and v_order.payment_method = 'wire' then 'wire.manually_marked_paid' else 'order.updated' end,
    'order', p_order_id::text, trim(p_reason), jsonb_build_object('order_number', v_order.order_number, 'previous_status', v_order.status, 'new_status', p_status, 'previous_payment_status', v_order.payment_status, 'new_payment_status', p_payment_status));
  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

