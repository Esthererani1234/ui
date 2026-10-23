create or replace function public.accept_wire_order(p_order_id bigint,p_user_id uuid,p_agreement jsonb,p_user_agent text default null,p_ip_hash text default null)
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
     terms_version=o.terms_version,terms_accepted_at=o.terms_accepted_at,
     terms_user_agent=o.terms_user_agent,terms_ip_hash=o.terms_ip_hash
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

-- Add the revised terms without rewriting existing consent or breaking in-flight old clients.
create or replace function public.place_checkout_order(p_user_id uuid,p_quote_id uuid,p_contact jsonb,p_shipping jsonb,p_payment_method text,
 p_notes text,p_terms jsonb,p_wire_agreement jsonb,p_user_agent text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; existing_id bigint; o public.orders%rowtype;
begin
 if p_terms->'accepted' is distinct from 'true'::jsonb or coalesce(p_terms->>'version','') not in ('2026-10-22','2026-10-22-v2') then
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
 update public.orders set terms_version=p_terms->>'version',terms_accepted_at=clock_timestamp(),
   terms_user_agent=left(p_user_agent,500),terms_ip_hash=case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash else null end,
   payment_provider=case p_payment_method when 'wire' then 'manual_wire' when 'card' then 'stripe' else 'nowpayments' end,
   payment_reference='GOTS-'||order_number,payment_due_at=price_locked_until
 where id=(result->>'order_id')::bigint;
 if p_payment_method='wire' then result:=public.accept_wire_order((result->>'order_id')::bigint,p_user_id,p_wire_agreement,p_user_agent,p_ip_hash); end if;
 -- Wire acceptance keeps its own immutable agreement; record the actual general terms separately.
 update public.orders set terms_version=p_terms->>'version' where id=(result->>'order_id')::bigint;
 insert into private.checkout_order_receipts values(p_quote_id,(result->>'order_id')::bigint,p_user_id);
 return result;
end $$;

-- Existing execute grants remain service_role-only. Roll back the frontend before restoring the previous function.
