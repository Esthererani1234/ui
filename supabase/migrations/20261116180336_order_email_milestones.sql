-- Forward only: do not requeue old emails or touch orders, payments or inventory.
-- Both the order and delivery screens use the same event key for each milestone.
create function private.enqueue_order_milestone(o public.orders, kind text, tracking text)
returns void language plpgsql security definer set search_path='' as $$
declare recipient_value text; key_value text;
begin
 if not exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'::jsonb) then return; end if;
 select email into recipient_value from auth.users where id=o.user_id and email_confirmed_at is not null;
 if recipient_value is null then return; end if;
 -- Late duplicate status writes must not revive a shipment after delivery.
 if kind='shipped' and exists(select 1 from public.order_email_outbox where order_id=o.id and event_type='delivered') then return; end if;
 key_value:=kind || case when kind='tracking' then ':'||md5(tracking) else '' end;
 -- Suppress obsolete reminders, never the receipt, shipment, delivery or cancellation.
 if kind in ('paid','processing','shipped','delivered','cancelled','refunded') then
   update public.order_email_outbox set status='skipped',last_error='superseded'
   where order_id=o.id and status='pending' and attempts=0 and
     (event_type in ('awaiting_payment','wire_instructions')
      or (event_type='processing' and kind in ('shipped','delivered','cancelled','refunded'))
      or (event_type='tracking' and kind in ('delivered','cancelled','refunded')));
 end if;
 insert into public.order_email_outbox(order_id,event_key,event_type,recipient,order_snapshot,available_at)
 values(o.id,key_value,kind,recipient_value,jsonb_build_object(
   'order_number',o.order_number,'first_name',o.first_name,'created_at',o.created_at,'payment_method',o.payment_method,
   'payment_status',o.payment_status,'status',o.status,'subtotal',o.subtotal,'shipping_amount',o.shipping_amount,
   'insurance_amount',o.insurance_amount,'payment_surcharge',o.payment_surcharge,'total',o.total,
   'shipping_address',o.shipping_address,'tracking_number',tracking),now())
 on conflict(order_id,event_key) do nothing;
end $$;
revoke all on function private.enqueue_order_milestone(public.orders,text,text) from public,anon,authenticated;

create or replace function private.queue_order_email() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if tg_op='INSERT' then
   perform private.enqueue_order_milestone(new,'placed',new.tracking_number);
   if new.payment_status='paid' then perform private.enqueue_order_milestone(new,'paid',new.tracking_number); end if;
   return new;
 end if;
 if old.payment_status is distinct from new.payment_status and new.payment_status='paid' then
   perform private.enqueue_order_milestone(new,'paid',new.tracking_number);
 end if;
 if old.status is distinct from new.status then
   kind:=case new.status when 'completed' then 'delivered' when 'shipped' then 'shipped'
     when 'cancelled' then 'cancelled' when 'processing' then 'processing'
     when 'awaiting_payment' then case when new.payment_status not in ('paid','refunded') then 'awaiting_payment' end end;
   if kind is not null then perform private.enqueue_order_milestone(new,kind,new.tracking_number); end if;
 elsif old.tracking_number is distinct from new.tracking_number and nullif(new.tracking_number,'') is not null and new.status in ('shipped','completed') then
   perform private.enqueue_order_milestone(new,'tracking',new.tracking_number);
 end if;
 if old.payment_status is distinct from new.payment_status and new.payment_status='refunded' then
   perform private.enqueue_order_milestone(new,'refunded',new.tracking_number);
 end if;
 return new;
end $$;

-- Keep all wire agreement, deadline and ownership checks as deployed. Narrow
-- only the pending reminder suppressed by wire acceptance. Fail if the expected
-- source is no longer present, rather than replacing unseen checkout changes.
do $$
declare existing text:=pg_get_functiondef('public.accept_wire_order(bigint,uuid,jsonb,text,text)'::regprocedure);
 target text:=$old$event_type in ('placed','awaiting_payment') and status='pending' and attempts=0$old$;
begin
 if strpos(existing,target)=0 then raise exception 'Unexpected wire email implementation'; end if;
 execute replace(existing,target,$new$event_type='awaiting_payment' and status='pending' and attempts=0$new$);
end $$;

create function private.queue_delivery_milestone() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; o public.orders;
begin
 if tg_op='UPDATE' and new.details->>'status' is not distinct from old.details->>'status' then return new; end if;
 kind:=case when new.details->>'status'='Delivered' then 'delivered'
   when new.details->>'status'='Out for Delivery' and new.details->>'method' in ('Shipping','Insured Courier') then 'shipped' end;
 if kind is null then return new; end if;
 select * into o from public.orders where id=new.order_id;
 if not found or o.payment_status is distinct from 'paid' or o.status in ('cancelled','expired')
    or (kind='shipped' and o.status='completed') then return new; end if;
 perform private.enqueue_order_milestone(o,kind,coalesce(nullif(trim(new.details->>'tracking'),''),o.tracking_number));
 return new;
end $$;
revoke all on function private.queue_delivery_milestone() from public,anon,authenticated;
create trigger order_delivery_customer_milestones after insert or update of details on public.order_delivery_info
 for each row execute function private.queue_delivery_milestone();
