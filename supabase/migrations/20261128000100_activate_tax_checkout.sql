-- Activate alongside the tax-aware checkout after verifying supported orders.
CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quote public.checkout_quotes%rowtype;
  v_order_id bigint;
  assessment private.tax_assessments;
  effective_policy jsonb;
  tax numeric(14,2);
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

  if p_shipping->>'fulfillment'='pickup' then
    v_quote.shipping_amount:=0;
    if p_shipping->>'postal_code' is distinct from '10016' or p_shipping->>'address_line_1' is distinct from '149 Madison Avenue' then raise exception 'Invalid pickup office';end if;
  end if;
  v_surcharge := case when p_payment_method = 'card' then v_quote.card_surcharge when p_payment_method = 'ach' then round(v_quote.subtotal * 0.02, 2) else 0 end;
  v_total := round(v_quote.subtotal + v_quote.shipping_amount + v_surcharge, 2);
  select a.* into assessment from private.tax_assessments a join private.tax_revision r on r.revision=a.revision
   where a.id=(p_shipping->>'tax_assessment_id')::uuid and a.quote_id=p_quote_id and a.user_id=p_user_id
   and a.address=private.tax_normalize_address(p_shipping) and a.method=p_payment_method
   and a.fulfillment=coalesce(p_shipping->>'fulfillment','delivery')
   and a.result->>'day'=(clock_timestamp() at time zone 'America/New_York')::date::text for share of r;
  if not found then raise exception 'Review the tax and total for this address and payment method.' using errcode='P2005';end if;
  effective_policy:=public.tax_quote_inputs(p_user_id,p_quote_id,private.tax_normalize_address(p_shipping))->'policy';
  if effective_policy->>'approval' is distinct from 'approved'
     or coalesce((effective_policy->>'valid_until')::date < (assessment.result->>'day')::date,true)
     or effective_policy->>'shipping_disabled' is distinct from 'false'
     or assessment.result->>'state' is distinct from upper(trim(p_shipping->>'state'))
     or coalesce(effective_policy->>'collection','review') not in ('collect','no_obligation')
     or effective_policy->>'collection' is distinct from assessment.result->>'collection' then
    raise exception 'The collection obligation needs review.' using errcode='P2005';end if;
  if assessment.result->>'state'='NY' and (assessment.result->>'exempt')::bigint>0
     and coalesce(effective_policy->>'ny_dealer_status','') not in ('registered','registration_not_required') then
    raise exception 'New York bullion dealer eligibility needs review.' using errcode='P2005';end if;
  tax:=(assessment.result->>'tax')::bigint/100.0;
  v_total:=v_total+tax;
  if v_total*100 is distinct from (assessment.result->>'total')::bigint then raise exception 'Refresh the tax calculation.' using errcode='P2005';end if;
  if assessment.result->>'state'='NY' and (assessment.result->>'exempt')::bigint>0 and
     p_shipping->'investment_purchase' is distinct from 'true'::jsonb then
    raise exception 'Confirm the investment purchase agreement.' using errcode='P2005';
  end if;
  p_shipping:=p_shipping-'tax_assessment_id'-'investment_purchase';
  if p_payment_method='ach' and v_total > 25000 then raise exception 'ACH maximum is $25,000 including fees' using errcode='P2005'; end if;
  v_order_number := private.next_customer_order_number();

  insert into public.orders (
    tax_assessment_id, tax_amount, order_number, user_id, first_name, last_name, email, phone, payment_method,
    subtotal, payment_surcharge, shipping_amount, total, spot_snapshot,
    price_locked_until, shipping_address, customer_notes
  ) values (
    assessment.id, tax, v_order_number, p_user_id, p_contact ->> 'first_name', p_contact ->> 'last_name',
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
    'order_id', v_order_id, 'tax_amount',tax,
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

create trigger tax_preserve_order before update on public.orders for each row execute function private.tax_protect_order();

create trigger tax_order_settlement after update of payment_status on public.orders for each row execute function private.tax_record_settlement();
