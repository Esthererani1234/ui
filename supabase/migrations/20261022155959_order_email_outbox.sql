-- New, opt-in transactional notifications. No historic orders are backfilled.
create table public.order_email_outbox (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 order_id bigint not null references public.orders(id) on delete cascade,
 event_key text not null,
 event_type text not null check(event_type in ('placed','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','tracking')),
 recipient text not null,
 order_snapshot jsonb not null,
 items_snapshot jsonb,
 message jsonb,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0,
 available_at timestamptz not null default now()+interval '30 seconds',
 lease_id uuid,
 lease_until timestamptz,
 first_attempt_at timestamptz,
 sent_at timestamptz,
 provider_id text,
 last_error text,
 created_at timestamptz not null default now(),
 unique(order_id,event_key)
);
alter table public.order_email_outbox enable row level security;
revoke all on public.order_email_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.order_email_outbox to service_role;
create index order_email_outbox_due on public.order_email_outbox(available_at,created_at) where status in ('pending','sending');

create function public.get_order_email_secret() returns jsonb language sql stable security definer set search_path='' as $$
 select decrypted_secret::jsonb from vault.decrypted_secrets where name='order_email_provider' limit 1;
$$;
create function public.configure_order_email(p_actor uuid,p_settings jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) then raise exception 'Administrator required' using errcode='42501'; end if;
 if coalesce(length(trim(p_reason)),0)<3 or coalesce(p_settings->>'api_key','') !~ '^re_[A-Za-z0-9_\-]{10,200}$'
    or coalesce(p_settings->>'from_email','') !~ '^[A-Za-z0-9._%+\-]+@goldonthespot\.com$'
    or coalesce(p_settings->>'reply_to','') !~ '^[A-Za-z0-9._%+\-]+@goldonthespot\.com$'
    or coalesce(p_settings->>'enabled','') not in ('true','false') then raise exception 'Invalid email settings'; end if;
 select id into secret_id from vault.secrets where name='order_email_provider' limit 1;
 if secret_id is null then perform vault.create_secret(p_settings::text,'order_email_provider','Order email credentials');
 else perform vault.update_secret(secret_id,p_settings::text); end if;
 insert into public.app_settings(key,value,is_public) values('order_emails_enabled',to_jsonb((p_settings->>'enabled')::boolean),false)
 on conflict(key) do update set value=excluded.value;
 update public.app_settings set value=to_jsonb((p_settings->>'enabled')::boolean) where key='branded_email_ready';
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
 values(p_actor,'order_emails.configured','email_settings','order_email_provider',p_reason,
 jsonb_build_object('enabled',(p_settings->>'enabled')::boolean,'from_email',p_settings->>'from_email','key_last4',right(p_settings->>'api_key',4)));
end $$;

create function private.queue_order_email() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; event_key_value text; recipient_value text; snapshot jsonb;
begin
 if not exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'::jsonb) then return new; end if;
 if TG_OP='INSERT' then
   kind:=case when new.payment_status='paid' then 'paid' else 'placed' end;
 elsif new.payment_status='refunded' and old.payment_status is distinct from new.payment_status then kind:='refunded';
 elsif new.status='cancelled' and old.status is distinct from new.status then kind:='cancelled';
 elsif new.status='completed' and old.status is distinct from new.status then kind:='delivered';
 elsif new.status='shipped' and old.status is distinct from new.status then kind:='shipped';
 elsif new.payment_status='paid' and old.payment_status is distinct from new.payment_status then kind:='paid';
 elsif new.status='processing' and old.status is distinct from new.status then kind:='processing';
 elsif new.status='awaiting_payment' and old.status is distinct from new.status then kind:='awaiting_payment';
 elsif new.tracking_number is distinct from old.tracking_number and coalesce(new.tracking_number,'')<>'' and new.status in ('shipped','completed') then kind:='tracking';
 end if;
 if kind is null then return new; end if;
 -- Never email checkout-supplied arbitrary recipients: use the owner's verified email.
 select email into recipient_value from auth.users where id=new.user_id and email_confirmed_at is not null;
 if recipient_value is null then return new; end if;
 event_key_value:=kind || case when kind='tracking' then ':'||md5(new.tracking_number) else '' end;
 snapshot:=jsonb_build_object('order_number',new.order_number,'first_name',new.first_name,'created_at',new.created_at,
 'payment_method',new.payment_method,'payment_status',new.payment_status,'status',new.status,
 'subtotal',new.subtotal,'shipping_amount',new.shipping_amount,'insurance_amount',new.insurance_amount,
 'payment_surcharge',new.payment_surcharge,'total',new.total,'shipping_address',new.shipping_address,'tracking_number',new.tracking_number);
 -- Supersede only messages never attempted. Ambiguous sends keep their immutable
 -- payload/key, allowing safe provider deduplication instead of a second message.
 if kind in ('paid','processing','shipped','delivered','cancelled','refunded') then
   update public.order_email_outbox set status='skipped',last_error='superseded'
   where order_id=new.id and status='pending' and attempts=0 and (
     kind in ('cancelled','refunded') or
     event_type in ('placed','awaiting_payment') or
     (kind in ('shipped','delivered') and event_type='processing') or
     (kind='delivered' and event_type in ('shipped','tracking')));
 end if;
 insert into public.order_email_outbox(order_id,event_key,event_type,recipient,order_snapshot)
 values(new.id,event_key_value,kind,recipient_value,snapshot) on conflict(order_id,event_key) do nothing;
 return new;
end $$;
create trigger orders_queue_customer_email after insert or update of status,payment_status,tracking_number on public.orders
for each row execute function private.queue_order_email();

create function public.claim_order_emails(p_limit integer default 4)
returns setof public.order_email_outbox language plpgsql security definer set search_path='' as $$
begin
 -- Stop uncertain retries before Resend's 24-hour idempotency retention expires.
 update public.order_email_outbox set status='failed',last_error='retry_window_elapsed'
 where status in ('pending','sending') and (first_attempt_at < now()-interval '22 hours'
  or (attempts>=10 and (status='pending' or lease_until<now())));
 -- Do not send obsolete first notifications following a long outage.
 update public.order_email_outbox set status='skipped',last_error='notification_too_old'
 where status='pending' and attempts=0 and created_at<now()-interval '24 hours';
 return query with candidates as (
  select q.id from public.order_email_outbox q
  where ((q.status='pending' and q.available_at<=now()) or (q.status='sending' and q.lease_until<now()))
    and q.attempts<10
    and not exists(select 1 from public.order_email_outbox earlier where earlier.order_id=q.order_id
      and earlier.status in ('pending','sending') and earlier.sequence<q.sequence)
  order by q.sequence limit greatest(1,least(p_limit,4)) for update skip locked
 ) update public.order_email_outbox q set status='sending',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',
 attempts=q.attempts+1,first_attempt_at=coalesce(q.first_attempt_at,now()),
 items_snapshot=coalesce(q.items_snapshot,(select coalesce(jsonb_agg(jsonb_build_object(
 'product_name',i.product_name,'sku',i.sku,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,
 'product_image_url',coalesce(nullif(i.product_image_url,''),nullif(p.image_url,''),p.image_urls[1])) order by i.id),'[]'::jsonb)
 from public.order_items i left join public.products p on p.id=i.product_id where i.order_id=q.order_id))
 from candidates c where q.id=c.id returning q.*;
end $$;
revoke all on function private.queue_order_email() from public,anon,authenticated;
revoke all on function public.get_order_email_secret() from public,anon,authenticated;
revoke all on function public.configure_order_email(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.claim_order_emails(integer) from public,anon,authenticated;
grant execute on function public.get_order_email_secret(),public.configure_order_email(uuid,jsonb,text),public.claim_order_emails(integer) to service_role;
insert into public.app_settings(key,value,is_public) values('order_emails_enabled','false',false) on conflict(key) do nothing;
-- Rollback: disable order_emails_enabled, unschedule gold-order-emails, and drop
-- orders_queue_customer_email. Keep the outbox/audit rows for reconciliation.
