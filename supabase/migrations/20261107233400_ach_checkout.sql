-- ACH: additive support; existing orders and card/wire pricing are unchanged.
insert into public.app_settings(key,value,is_public) values ('ach_order_maximum','25000',true) on conflict(key) do nothing;
CREATE OR REPLACE FUNCTION public.bind_card_payment_intent(p_order_id bigint, p_user_id uuid, p_request_hash text, p_intent_id text, p_amount_cents bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; r private.card_payment_requests%rowtype;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.payment_method not in ('card','ach') or p_intent_id is null or p_intent_id !~ '^pi_[A-Za-z0-9]+$'
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
end $function$
;
CREATE OR REPLACE FUNCTION public.claim_card_payment_request(p_order_id bigint, p_user_id uuid, p_request_hash text, p_expected_total numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; v_hash text;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.total is distinct from p_expected_total or o.total<=0 or o.payment_method not in ('card','ach')
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
end $function$
;
CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quote public.checkout_quotes%rowtype;
  v_order_id bigint;
  v_order_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_surcharge numeric(14,2);
  v_total numeric(14,2);
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'A valid customer account is required';
  end if;
  if p_payment_method not in ('wire', 'card', 'crypto', 'ach') then raise exception 'Unsupported payment method'; end if;
  if coalesce(p_contact ->> 'first_name', '') = '' or coalesce(p_contact ->> 'last_name', '') = ''
     or coalesce(p_contact ->> 'email', '') = '' or coalesce(p_contact ->> 'phone', '') = '' then
    raise exception 'Complete contact information is required';
  end if;
  if coalesce(p_shipping ->> 'address_line_1', '') = '' or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'state', '') = '' or coalesce(p_shipping ->> 'postal_code', '') = '' then
    raise exception 'A complete shipping address is required';
  end if;

  select * into v_quote
  from public.checkout_quotes
  where id = p_quote_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Checkout quote not found'; end if;
  if v_quote.status <> 'active' or now() >= v_quote.expires_at then
    update public.checkout_quotes set status = 'expired', updated_at = now() where id = p_quote_id;
    raise exception 'The price lock expired. Review the refreshed total and try again.';
  end if;

  v_surcharge := case when p_payment_method = 'card' then v_quote.card_surcharge when p_payment_method = 'ach' then round(v_quote.subtotal * 0.02, 2) else 0 end;
  v_total := round(v_quote.subtotal + v_quote.shipping_amount + v_surcharge, 2);
  if p_payment_method='ach' and v_total > 25000 then raise exception 'ACH maximum is $25,000 including fees' using errcode='P2005'; end if;
  v_order_number := private.next_customer_order_number();

  insert into public.orders (
    order_number, user_id, first_name, last_name, email, phone, payment_method,
    subtotal, payment_surcharge, shipping_amount, total, spot_snapshot,
    price_locked_until, shipping_address, customer_notes
  ) values (
    v_order_number, p_user_id, p_contact ->> 'first_name', p_contact ->> 'last_name',
    lower(p_contact ->> 'email'), p_contact ->> 'phone', p_payment_method,
    v_quote.subtotal, v_surcharge, v_quote.shipping_amount, v_total,
    v_quote.spot_snapshot, v_quote.expires_at, p_shipping, nullif(trim(p_notes), '')
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_quote.line_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::bigint and is_active
    for update;
    if not found then raise exception 'A product is unavailable'; end if;
    if v_product.inventory_count < v_quantity then raise exception '% does not have enough inventory', v_product.name; end if;

    insert into public.order_items (
      order_id, product_id, sku, product_name, metal, metal_weight_oz,
      quantity, unit_price, line_total, pricing_snapshot
    ) values (
      v_order_id, v_product.id, v_item ->> 'sku', v_item ->> 'product_name',
      v_item ->> 'metal', (v_item ->> 'metal_weight_oz')::numeric,
      v_quantity, (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'line_total')::numeric, v_item -> 'pricing_snapshot'
    );
    update public.products set inventory_count = inventory_count - v_quantity where id = v_product.id;
  end loop;

  update public.checkout_quotes set status = 'used', updated_at = now() where id = p_quote_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_quote.subtotal,
    'shipping', v_quote.shipping_amount,
    'surcharge', v_surcharge,
    'total', v_total,
    'price_locked_until', v_quote.expires_at
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.place_checkout_order(p_user_id uuid, p_quote_id uuid, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_notes text, p_terms jsonb, p_wire_agreement jsonb, p_user_agent text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; existing_id bigint; o public.orders%rowtype;
begin
 if p_terms->'accepted' is distinct from 'true'::jsonb or coalesce(p_terms->>'version','') not in ('2026-10-22','2026-10-22-v2') then
   raise exception 'Accept the current Terms of Purchase before placing the order.' using errcode='P2006'; end if;
 perform id from public.checkout_quotes where id=p_quote_id and user_id=p_user_id for update;
 if not found then raise exception 'Checkout quote not found' using errcode='P0002'; end if;
 select order_id into existing_id from private.checkout_order_receipts where quote_id=p_quote_id and user_id=p_user_id;
 if existing_id is not null then
   select * into o from public.orders where id=existing_id and user_id=p_user_id;
   return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'payment_method',o.payment_method,'total',o.total,
     'subtotal',o.subtotal,'shipping',o.shipping_amount,'surcharge',o.payment_surcharge,'price_locked_until',o.price_locked_until,'payment_due_at',o.payment_due_at);
 end if;
 result:=public.create_order_from_quote(p_user_id,p_quote_id,p_contact,p_shipping,p_payment_method,p_notes);
 update public.orders set terms_version=p_terms->>'version',terms_accepted_at=clock_timestamp(),
   terms_user_agent=left(p_user_agent,500),terms_ip_hash=case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash else null end,
   payment_provider=case p_payment_method when 'wire' then 'manual_wire' when 'card' then 'stripe' when 'ach' then 'stripe' else 'nowpayments' end,
   payment_reference=order_number,payment_due_at=price_locked_until
 where id=(result->>'order_id')::bigint;
 if p_payment_method='wire' then result:=public.accept_wire_order((result->>'order_id')::bigint,p_user_id,p_wire_agreement,p_user_agent,p_ip_hash); end if;
 -- Wire acceptance keeps its own immutable agreement; record the actual general terms separately.
 update public.orders set terms_version=p_terms->>'version' where id=(result->>'order_id')::bigint;
 insert into private.checkout_order_receipts values(p_quote_id,(result->>'order_id')::bigint,p_user_id);
 return result;
end $function$
;


CREATE OR REPLACE FUNCTION public.claim_payment_reconciliations() returns table(order_id bigint,lease_id uuid)
language sql security definer set search_path='' as $function$
  with candidates as (
    select o.id from public.orders o left join private.payment_reconciliation_state r on r.order_id=o.id
    where o.payment_method in ('card','ach') and o.payment_status not in ('paid','refunded','disputed')
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
$function$;
