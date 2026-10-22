-- Limits are USD final-order totals, not browser estimates. Existing orders remain intact.
insert into public.app_settings(key,value,is_public) values
 ('card_order_maximum','10000',true),('wire_order_maximum','100000',true),
 ('crypto_order_maximum','2000000',true) on conflict(key) do nothing;

alter table public.app_settings add constraint valid_payment_maximum check (
 key not in ('card_order_maximum','wire_order_maximum','crypto_order_maximum') or
 (jsonb_typeof(value)='number' and (value #>> '{}')::numeric between 1 and 10000000
 and (value #>> '{}')::numeric=round((value #>> '{}')::numeric,2))
);

create function public.admin_set_payment_maximums(p_actor uuid,p_limits jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text; v numeric; previous jsonb;
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) then
  raise exception 'Administrator access required' using errcode='42501';end if;
 if jsonb_typeof(p_limits) is distinct from 'object' or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then
  raise exception 'Enter all three payment maximums and a change reason.' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_limits))<>3 or not p_limits ?& array['card_order_maximum','wire_order_maximum','crypto_order_maximum'] then
  raise exception 'Invalid payment maximum fields.' using errcode='22023';end if;
 foreach k in array array['card_order_maximum','wire_order_maximum','crypto_order_maximum'] loop
  if jsonb_typeof(p_limits->k) is distinct from 'number' then raise exception 'Payment maximums must be dollar amounts.' using errcode='22023';end if;
  v:=(p_limits->>k)::numeric;
  if v not between 1 and 10000000 or v<>round(v,2) then
   raise exception 'Payment maximums must be $1 to $10,000,000 with at most two decimal places.' using errcode='22023';end if;
 end loop;
 -- Serialize settings edits so the audit before/after values are accurate.
 perform key from public.app_settings where key in ('card_order_maximum','wire_order_maximum','crypto_order_maximum') order by key for update;
 select jsonb_object_agg(key,value) into previous from public.app_settings
 where key in ('card_order_maximum','wire_order_maximum','crypto_order_maximum');
 insert into public.app_settings(key,value,is_public)
 select key,value,true from jsonb_each(p_limits)
 on conflict(key) do update set value=excluded.value,is_public=true;
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
 values(p_actor,'payment.maximums_updated','store','payment_maximums',trim(p_reason),
 jsonb_build_object('previous',previous,'limits',p_limits,'result','success'));
 return jsonb_build_object('success',true,'limits',p_limits);
end $$;
revoke all on function public.admin_set_payment_maximums(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.admin_set_payment_maximums(uuid,jsonb,text) to service_role;

create function private.enforce_order_payment_maximum() returns trigger
language plpgsql security definer set search_path='' as $$
declare maximum numeric; label text;
begin
 if tg_op='UPDATE' and new.payment_method is not distinct from old.payment_method and new.total is not distinct from old.total then return new;end if;
 select (value #>> '{}')::numeric into maximum from public.app_settings where key=new.payment_method||'_order_maximum';
 if maximum is null then raise exception 'Payment maximum is unavailable. Please contact support.' using errcode='P2005';end if;
 label:=case new.payment_method when 'card' then 'Card' when 'wire' then 'Bank wire' when 'crypto' then 'Crypto' end;
 if new.total is null or new.total<0 or new.total='NaN'::numeric or new.total>maximum then
  raise exception '% payment maximum is $%. Choose another payment method or reduce your order.',label,to_char(maximum,'FM999,999,990.00') using errcode='P2005';
 end if;
 return new;
end $$;
revoke all on function private.enforce_order_payment_maximum() from public,anon,authenticated;
create trigger enforce_order_payment_maximum before insert or update of payment_method,total
 on public.orders for each row execute function private.enforce_order_payment_maximum();
-- Rollback: drop the order trigger and admin RPC; retain settings/audit history.
