-- Additive: old orders receive no new agreement or payment obligation.
alter table public.orders add column wire_agreement_version text, add column wire_agreement_text text,
 add column wire_accepted_at timestamptz, add column wire_agreed_total numeric(14,2);
grant select(wire_agreement_version,wire_agreement_text,wire_accepted_at,wire_agreed_total) on public.orders to authenticated;
create table private.checkout_order_receipts(quote_id uuid primary key references public.checkout_quotes(id),
 order_id bigint not null unique references public.orders(id), user_id uuid not null references auth.users(id));
alter table private.checkout_order_receipts enable row level security;
revoke all on private.checkout_order_receipts from public,anon,authenticated;

alter table public.order_email_outbox drop constraint order_email_outbox_event_type_check;
alter table public.order_email_outbox add constraint order_email_outbox_event_type_check check(event_type in
 ('placed','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','tracking','support_created','support_reply','support_status','wire_instructions'));

create function private.wire_agreement_text() returns text language sql immutable set search_path='' as $text$
 select 'By placing this bank-wire order, I agree to purchase the listed metals at the displayed locked total, subject to Gold On The Spot accepting the order. Cleared USD funds must arrive by the payment deadline in my order confirmation (at least 24 hours after placement, extended past weekends). I will contact support before ordering if bank cutoffs or holidays may delay payment. If I cancel or fail to pay on time and Gold On The Spot cancels an accepted order, I agree to pay its documented actual market loss, to the extent permitted by law: the positive difference between the locked merchandise price and proceeds of a commercially reasonable resale of the same metals, less expenses saved, capped at the locked merchandise price. Gold On The Spot must take reasonable steps to limit the loss and provide an itemized written explanation. No market-loss charge applies when there is no actual loss or Gold On The Spot cannot fulfill the order. This agreement does not authorize an automatic debit or card charge. I may contact support to question a calculation; applicable consumer rights remain unchanged.';
$text$;
create function private.wire_deadline(p_now timestamptz) returns timestamptz language plpgsql immutable set search_path='' as $$
declare due_local timestamp := (p_now at time zone 'America/New_York') + interval '1 day';
begin
 while extract(isodow from due_local) in (6,7) loop due_local:=due_local+interval '1 day'; end loop;
 return greatest(due_local at time zone 'America/New_York',p_now+interval '24 hours');
end $$;

create function public.accept_wire_order(p_order_id bigint,p_user_id uuid,p_agreement jsonb,p_user_agent text default null,p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; settings jsonb; recipient_value text; snapshot jsonb;
begin
 if p_agreement is null or jsonb_typeof(p_agreement)<>'object' or p_agreement->'accepted' is distinct from 'true'::jsonb
 or p_agreement->>'version' is distinct from '2026-10-22-wire-v1'
 or (select count(*) from jsonb_object_keys(p_agreement))<>2 then
 raise exception 'Accept the bank-wire purchase agreement before continuing.' using errcode='P2006'; end if;
 select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if o.payment_method not in ('card','wire') or o.status not in ('pending_review','awaiting_payment')
 or o.payment_status not in ('unpaid','pending','failed') then
 raise exception 'This order cannot accept a bank wire. Contact support.' using errcode='P2006'; end if;
 if o.wire_accepted_at is null then
   if o.price_locked_until is null or o.price_locked_until<=clock_timestamp() then
     raise exception 'The price lock expired. Review a new quote before agreeing.' using errcode='P2006'; end if;
   settings:=public.get_wire_instructions_secret();
   if coalesce(settings->>'bank_name','')='' or coalesce(settings->>'beneficiary_name','')=''
      or coalesce(settings->>'routing_number','') !~ '^[0-9]{9}$' or coalesce(settings->>'account_number','') !~ '^[0-9]{4,34}$' then
      raise exception 'Bank-wire instructions are temporarily unavailable. Please contact support.' using errcode='P2006'; end if;
   if o.payment_method='card' then perform public.convert_unpaid_card_order_to_wire(o.id,p_user_id); end if;
   update public.orders set wire_agreement_version='2026-10-22-wire-v1',wire_agreement_text=private.wire_agreement_text(),
     wire_accepted_at=clock_timestamp(),wire_agreed_total=total,payment_due_at=private.wire_deadline(clock_timestamp()),
     payment_provider='manual_wire',payment_reference=coalesce(payment_reference,'GOTS-'||order_number),
     terms_version='2026-10-22',terms_accepted_at=clock_timestamp(),terms_user_agent=left(p_user_agent,500),
     terms_ip_hash=case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash else null end
   where id=o.id returning * into o;
 end if;
 if o.payment_due_at is null or o.payment_due_at<=clock_timestamp() then
   raise exception 'The wire payment deadline has passed. Contact support before sending funds.' using errcode='P2006'; end if;
 -- Queue exactly once; repeat requests neither extend the deadline nor send duplicates.
 select email into recipient_value from auth.users where id=p_user_id and email_confirmed_at is not null;
 if recipient_value is not null and exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true') then
   snapshot:=jsonb_build_object('order_number',o.order_number,'first_name',o.first_name,'created_at',o.created_at,
    'payment_method','wire','payment_status',o.payment_status,'status',o.status,'subtotal',o.subtotal,
    'shipping_amount',o.shipping_amount,'insurance_amount',o.insurance_amount,'payment_surcharge',o.payment_surcharge,
    'total',o.total,'shipping_address',o.shipping_address,'payment_reference',o.payment_reference,'payment_due_at',o.payment_due_at,
    'wire_agreement_version',o.wire_agreement_version,'wire_agreement_text',o.wire_agreement_text,'wire_accepted_at',o.wire_accepted_at);
   update public.order_email_outbox set status='skipped',last_error='wire_instructions_replace_receipt'
     where order_id=o.id and event_type in ('placed','awaiting_payment') and status='pending' and attempts=0;
   insert into public.order_email_outbox(order_id,event_key,event_type,recipient,order_snapshot)
     values(o.id,'wire_instructions','wire_instructions',recipient_value,snapshot) on conflict(order_id,event_key) do nothing;
 end if;
 return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'payment_method','wire','total',o.total,
  'subtotal',o.subtotal,'shipping',o.shipping_amount,'surcharge',o.payment_surcharge,'price_locked_until',o.price_locked_until,
  'payment_due_at',o.payment_due_at,'reference',o.payment_reference,'wire_agreement_version',o.wire_agreement_version,'wire_accepted_at',o.wire_accepted_at);
end $$;

-- Quote consumption, inventory, acceptance, metadata and email queue commit together.
create function public.place_checkout_order(p_user_id uuid,p_quote_id uuid,p_contact jsonb,p_shipping jsonb,p_payment_method text,
 p_notes text,p_terms jsonb,p_wire_agreement jsonb,p_user_agent text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; existing_id bigint; o public.orders%rowtype;
begin
 if p_terms->'accepted' is distinct from 'true'::jsonb or p_terms->>'version' is distinct from '2026-10-22' then
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
 update public.orders set terms_version='2026-10-22',terms_accepted_at=clock_timestamp(),
   terms_user_agent=left(p_user_agent,500),terms_ip_hash=case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash else null end,
   payment_provider=case p_payment_method when 'wire' then 'manual_wire' when 'card' then 'stripe' else 'nowpayments' end,
   payment_reference='GOTS-'||order_number,payment_due_at=price_locked_until
 where id=(result->>'order_id')::bigint;
 if p_payment_method='wire' then result:=public.accept_wire_order((result->>'order_id')::bigint,p_user_id,p_wire_agreement,p_user_agent,p_ip_hash); end if;
 insert into private.checkout_order_receipts values(p_quote_id,(result->>'order_id')::bigint,p_user_id);
 return result;
end $$;

create function private.protect_wire_agreement() returns trigger language plpgsql set search_path='' as $$
begin
 if old.wire_accepted_at is not null and
 (new.wire_agreement_version is distinct from old.wire_agreement_version or new.wire_agreement_text is distinct from old.wire_agreement_text
 or new.wire_accepted_at is distinct from old.wire_accepted_at or new.wire_agreed_total is distinct from old.wire_agreed_total
 or new.payment_due_at is distinct from old.payment_due_at or new.total is distinct from old.total or new.payment_method is distinct from old.payment_method) then
 raise exception 'Accepted wire terms and totals cannot be changed. Contact support.' using errcode='P2006'; end if;
 return new;
end $$;
create trigger orders_protect_wire_agreement before update on public.orders for each row execute function private.protect_wire_agreement();
revoke all on function private.wire_agreement_text(),private.wire_deadline(timestamptz),private.protect_wire_agreement() from public,anon,authenticated;
revoke all on function public.accept_wire_order(bigint,uuid,jsonb,text,text),public.place_checkout_order(uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.accept_wire_order(bigint,uuid,jsonb,text,text),public.place_checkout_order(uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,text,text) to service_role;
-- Rollback application first; keep acceptance evidence and outbox. Never backfill consent.

-- Bank destination update and its security audit must commit or roll back together.
create function public.save_wire_settings_audited(p_actor uuid,p_settings jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) then raise exception 'Administrator required' using errcode='42501'; end if;
 if coalesce(length(trim(p_reason)),0)<3 or length(p_reason)>1000
  or coalesce(p_settings->>'bank_name','')='' or coalesce(p_settings->>'beneficiary_name','')=''
  or coalesce(p_settings->>'routing_number','') !~ '^[0-9]{9}$' or coalesce(p_settings->>'account_number','') !~ '^[0-9]{4,34}$'
  or (coalesce(p_settings->>'swift_code','')<>'' and p_settings->>'swift_code' !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$') then
  raise exception 'Enter valid wire instructions and a change reason.' using errcode='P2006'; end if;
 perform public.set_wire_instructions_secret(p_settings);
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
 values(p_actor,'payments.wire_settings_updated','payment_settings','wire_instructions',trim(p_reason),jsonb_build_object('account_last4',right(p_settings->>'account_number',4)));
end $$;
revoke all on function public.save_wire_settings_audited(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_wire_settings_audited(uuid,jsonb,text) to service_role;
