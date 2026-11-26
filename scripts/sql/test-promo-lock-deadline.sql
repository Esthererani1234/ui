-- Manual database regression test. All fixtures are rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); k text:=upper(left(replace(u::text,'-',''),16)); c jsonb; q jsonb; a jsonb; b jsonb; r jsonb; deadline timestamptz:=clock_timestamp()+interval '47 seconds';begin
 if has_function_privilege('authenticated','public.revise_checkout_promo(uuid,uuid,text)','execute') then raise exception 'Unsafe grant';end if;
 insert into auth.users(id) values(u);
 insert into private.store_promos(code,kind,amount,max_uses,created_by) values(k,'usd',3,1,u);
 select jsonb_build_array(jsonb_build_object('product_id',id,'quantity',1)) into strict c from public.products where is_active and inventory_count>0 and metal='gold' and price_mode<>'quote' limit 1;
 q:=public.create_checkout_quote(u,c,'{"gold":4000}'::jsonb);
 update public.checkout_quotes set expires_at=deadline where id=(q->>'quote_id')::uuid;
 begin perform public.revise_checkout_promo(gen_random_uuid(),(q->>'quote_id')::uuid,k);raise exception 'Wrong owner';exception when sqlstate 'P2011' then null;end;
 begin perform public.revise_checkout_promo(u,(q->>'quote_id')::uuid,'');raise exception using errcode='P2999';exception when sqlstate 'P2999' then null;end;
 begin perform public.revise_checkout_promo(u,(q->>'quote_id')::uuid,'INVALID_'||k);raise exception 'Accepted invalid code';exception when sqlstate 'P2010' then null;end;
 a:=public.revise_checkout_promo(u,(q->>'quote_id')::uuid,k);
 b:=public.revise_checkout_promo(u,(a->>'quote_id')::uuid,k);
 r:=public.revise_checkout_promo(u,(b->>'quote_id')::uuid,'');
 if (a->>'expires_at')::timestamptz<>deadline or (b->>'expires_at')::timestamptz<>deadline or (r->>'expires_at')::timestamptz<>deadline or a->'subtotal'<>b->'subtotal' or (q->>'subtotal')::numeric-(a->>'subtotal')::numeric<>3 or r->'card_total'<>q->'card_total' or a->'spot_snapshot'<>q->'spot_snapshot' or r->'line_items'<>q->'line_items' then raise exception 'Lock or price changed';end if;
 begin perform public.revise_checkout_promo(u,(q->>'quote_id')::uuid,k);raise exception 'Reused superseded lock';exception when sqlstate 'P2011' then null;end;
 update public.checkout_quotes set expires_at=clock_timestamp()-interval '1 second' where id=(r->>'quote_id')::uuid;
 begin perform public.revise_checkout_promo(u,(r->>'quote_id')::uuid,k);raise exception 'Revived expired lock';exception when sqlstate 'P2011' then null;end;
end $$;
rollback;