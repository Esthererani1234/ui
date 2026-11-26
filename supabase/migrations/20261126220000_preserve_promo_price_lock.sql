alter table private.promo_quotes add column base_card_fee numeric(14,2);
create function public.revise_checkout_promo(p_user_id uuid,p_quote_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.checkout_quotes; promo private.store_promos; id_new uuid; gross numeric; d numeric:=0; net numeric; fee numeric; original_fee numeric; begin
 select * into q from public.checkout_quotes where id=p_quote_id and user_id=p_user_id for update;
 if not found or q.status<>'active' or q.expires_at<=clock_timestamp() then raise exception 'Lock unavailable' using errcode='P2011';end if;
 select sum((i->>'line_total')::numeric) into strict gross from jsonb_array_elements(q.line_items) i;
 if gross is null or gross<=0 or q.subtotal<=0 then raise exception 'Invalid quote';end if;
 select base_card_fee into original_fee from private.promo_quotes where quote_id=q.id;
 original_fee:=coalesce(original_fee,round(q.card_surcharge*gross/q.subtotal,2));
 if p_code<>'' then
 select * into promo from private.store_promos where code=p_code and enabled and used<max_uses;
 if not found then raise exception 'Invalid promo' using errcode='P2010';end if;
 d:=private.promo_discount(gross,promo.kind,promo.amount);
 if d<=0 or gross-d<0.50 then raise exception 'Discount unavailable' using errcode='P2010';end if;
 end if;
 net:=gross-d;fee:=round(original_fee*net/gross,2);
 update public.checkout_quotes set status='expired',updated_at=now() where id=q.id;
 insert into public.checkout_quotes(user_id,cart,line_items,spot_snapshot,subtotal,shipping_amount,card_surcharge,wire_total,card_total,created_at,expires_at)
 values(q.user_id,q.cart,q.line_items,q.spot_snapshot,net,q.shipping_amount,fee,net+q.shipping_amount,net+q.shipping_amount+fee,q.created_at,q.expires_at) returning id into id_new;
 if d>0 then insert into private.promo_quotes(quote_id,code,discount,base_card_fee) values(id_new,p_code,d,original_fee);end if;
 return jsonb_build_object('quote_id',id_new,'line_items',q.line_items,'spot_snapshot',q.spot_snapshot,'subtotal',net,'shipping',q.shipping_amount,'card_surcharge',fee,'wire_total',net+q.shipping_amount,'card_total',net+q.shipping_amount+fee,'promo_code',promo.code,'discount_amount',d,'expires_at',q.expires_at);
end $$;
revoke all on function public.revise_checkout_promo(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.revise_checkout_promo(uuid,uuid,text) to service_role;

create or replace function public.create_promo_quote(p_user_id uuid,p_cart jsonb,p_spot jsonb,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.store_promos; q jsonb; d numeric; net numeric; fee numeric; shipping numeric;begin
 select * into p from private.store_promos where code=upper(trim(p_code)) and enabled and used<max_uses;
 if not found then raise exception 'Code unavailable' using errcode='P2010';end if;
 q:=public.create_checkout_quote(p_user_id,p_cart,p_spot);
 d:=private.promo_discount((q->>'subtotal')::numeric,p.kind,p.amount); net:=(q->>'subtotal')::numeric-d;
 if net<0.50 or d<=0 then raise exception 'Discount not applicable' using errcode='P2010';end if;
 shipping:=(q->>'shipping')::numeric;
 fee:=round(net*coalesce((select (value#>>'{}')::numeric from public.app_settings where key='card_surcharge_percent'),4)/100,2);
 update public.checkout_quotes set subtotal=net,wire_total=net+shipping,card_total=net+shipping+fee,card_surcharge=fee where id=(q->>'quote_id')::uuid;
 insert into private.promo_quotes (quote_id,code,discount,base_card_fee) values((q->>'quote_id')::uuid,p.code,d,(q->>'card_surcharge')::numeric);
 return q||jsonb_build_object('promo_code',p.code,'discount_amount',d,'subtotal',net,'wire_total',net+shipping,'card_total',net+shipping+fee,'card_surcharge',fee);
end $$;
