-- Owner-authorized: $10k merchandise, $10,450 final card charge. No order repricing.
insert into public.admin_audit_log(action,target_type,target_id,reason,metadata)
select 'payment.card_limit_updated','store','card_order_maximum',
 'Owner requested $10,450 internal cap with $10,000 merchandise eligibility',
 jsonb_build_object('previous',value,'maximum',10450,'merchandise_maximum',10000,'result','success')
from public.app_settings where key='card_order_maximum';
update public.app_settings set value='10450'::jsonb where key='card_order_maximum';
create function private.enforce_card_cart_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.payment_method='card' then
  if new.subtotal is null or new.subtotal<0 or new.subtotal='NaN'::numeric or new.subtotal>10000 then
   raise exception 'Card payments are limited to $10,000 in merchandise. Choose bank wire or reduce your cart.' using errcode='P2005';
  end if;
  if new.total is null or new.total<=0 or new.total='NaN'::numeric or new.total>10450 then
   raise exception 'This order exceeds the card payment limit after fees and shipping. Choose bank wire.' using errcode='P2005';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.enforce_card_cart_limit() from public,anon,authenticated;
create trigger enforce_card_cart_limit before insert or update of payment_method,subtotal,total
on public.orders for each row execute function private.enforce_card_cart_limit();
-- Rollback: drop this trigger/function and restore prior card_order_maximum.
-- Preserve audit history and existing orders. Existing configured limits remain additional checks.
