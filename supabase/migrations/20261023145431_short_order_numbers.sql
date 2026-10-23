-- New orders only: preserve previously issued numbers and banking references.
create sequence private.customer_order_numbers start with 100001;
revoke all on sequence private.customer_order_numbers from public,anon,authenticated;
do $$
declare highest bigint;
begin
 select max(substring(order_number from '^G-([0-9]+)$')::bigint) into highest
 from public.orders where order_number ~ '^G-[0-9]+$';
 if highest>=100001 then perform setval('private.customer_order_numbers',highest,true); end if;
end $$;
create function private.next_customer_order_number() returns text
language sql volatile security definer set search_path='' as $$
 select 'G-'||nextval('private.customer_order_numbers'::regclass)::text;
$$;
revoke all on function private.next_customer_order_number() from public,anon,authenticated;

-- Replace only number generation/reference expressions; retain all authorization,
-- pricing, inventory, consent, idempotency and notification logic and existing grants.
do $$
declare signature text; original text; revised text;
 old_assignment text := $old$v_order_number := 'GOTS-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));$old$;
begin
 foreach signature in array array[
 'public.create_order(uuid,jsonb,jsonb,jsonb,jsonb,text,text)',
 'public.create_order_from_quote(uuid,uuid,jsonb,jsonb,text,text)'] loop
   original:=pg_get_functiondef(signature::regprocedure);
   if strpos(original,old_assignment)=0 then raise exception 'Unexpected order-number implementation: %',signature; end if;
   revised:=replace(original,old_assignment,'v_order_number := private.next_customer_order_number();');
   execute revised;
 end loop;
 foreach signature in array array[
 'public.place_checkout_order(uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,text,text)',
 'public.accept_wire_order(bigint,uuid,jsonb,text,text)'] loop
   original:=pg_get_functiondef(signature::regprocedure);
   if strpos(original,$old$'GOTS-'||order_number$old$)=0 then raise exception 'Unexpected payment-reference implementation: %',signature; end if;
   execute replace(original,$old$'GOTS-'||order_number$old$,'order_number');
 end loop;
end $$;
-- Rollback: restore the four previous function definitions. Keep the sequence to
-- prevent reuse of issued numbers. Do not renumber historical orders.
