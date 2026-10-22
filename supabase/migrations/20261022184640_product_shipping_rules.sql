-- Null inherits store defaults. No existing products or locked orders change.
alter table public.products add column shipping_fee numeric(14,2)
 check(shipping_fee between 0 and 10000);
alter table public.products add column free_shipping_minimum numeric(14,2)
 check(free_shipping_minimum between 0 and 1000000);

create function private.shipping_for_cart(p_cart jsonb,p_subtotal numeric)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare fee numeric; threshold numeric; result numeric;
begin
 if p_subtotal is null or p_subtotal<0 or p_subtotal='NaN'::numeric
 or jsonb_typeof(p_cart) is distinct from 'array' then raise exception 'Invalid shipping calculation';end if;
 if jsonb_array_length(p_cart) not between 1 and 25 then raise exception 'Invalid shipping cart';end if;
 if exists(select 1 from jsonb_array_elements(p_cart) i left join public.products p on p.id=(i->>'product_id')::bigint where p.id is null) then raise exception 'Shipping product unavailable';end if;
 select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='shipping_flat'),35) into fee;
 select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='free_shipping_threshold'),5000) into threshold;
 select max(case when p_subtotal>=coalesce(p.free_shipping_minimum,threshold) then 0 else coalesce(p.shipping_fee,fee) end)
 into result from jsonb_array_elements(p_cart) i join public.products p on p.id=(i->>'product_id')::bigint;
 return round(result,2);
end $$;
revoke all on function private.shipping_for_cart(jsonb,numeric) from public,anon,authenticated;

-- Replace only the shipping assignment in the current guarded functions.
-- Fail the migration if the expected implementation changed; preserve grants.
do $$
declare signature text; definition text; cart_expression text;
 old_assignment text:='v_shipping := case when v_subtotal >= v_free_shipping_threshold then 0 else v_shipping_flat end;';
begin
 foreach signature in array array[
  'public.create_checkout_quote(uuid,jsonb,jsonb)',
  'public.create_order(uuid,jsonb,jsonb,jsonb,jsonb,text,text)',
  'public.refresh_card_order_quote(bigint,jsonb)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,old_assignment,'')))/length(old_assignment)<>1 then raise exception 'Unexpected shipping function: %',signature;end if;
  cart_expression:=case when signature like '%refresh_card_order_quote%' then
   '(select jsonb_agg(jsonb_build_object(''product_id'',product_id)) from public.order_items where order_id=p_order_id)' else 'p_cart' end;
  execute replace(definition,old_assignment,'v_shipping := private.shipping_for_cart('||cart_expression||',v_subtotal);');
 end loop;
end $$;

create function private.audit_product_shipping() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and (new.shipping_fee is not null or new.free_shipping_minimum is not null))
 or (tg_op='UPDATE' and (new.shipping_fee is distinct from old.shipping_fee or new.free_shipping_minimum is distinct from old.free_shipping_minimum)) then
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
 values(auth.uid(),'product_shipping_updated','product',new.id::text,'Product shipping settings saved',
 jsonb_build_object('shipping_fee',new.shipping_fee,'free_shipping_minimum',new.free_shipping_minimum,
 'previous_shipping_fee',case when tg_op='UPDATE' then old.shipping_fee end,
 'previous_free_shipping_minimum',case when tg_op='UPDATE' then old.free_shipping_minimum end));
 end if;return new;
end $$;
revoke all on function private.audit_product_shipping() from public,anon,authenticated;
create trigger audit_product_shipping after insert or update of shipping_fee,free_shipping_minimum
 on public.products for each row execute function private.audit_product_shipping();
-- Rollback behavior: set both product fields to null through an admin session.
-- Keep columns/audit history; never reprice existing locked quotes or orders.
