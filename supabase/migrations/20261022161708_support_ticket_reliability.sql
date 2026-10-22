-- All support writes now go through one authenticated server operation. Preserve
-- the existing owner + SMS / administrator + AAL2 read policies.
revoke all on public.support_tickets,public.support_ticket_messages from public,anon,authenticated;
grant select on public.support_tickets,public.support_ticket_messages to authenticated;
grant all on public.support_tickets,public.support_ticket_messages to service_role;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
create table private.support_action_requests(
 actor_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 fingerprint text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table private.support_action_requests enable row level security;
revoke all on private.support_action_requests from public,anon,authenticated;

create function public.support_ticket_action(p_actor uuid,p_admin boolean,p_request_id uuid,p_action text,
 p_ticket_id bigint default null,p_message text default null,p_status text default null,p_expected_updated_at timestamptz default null,
 p_category text default null,p_subject text default null,p_order_number text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.support_tickets; prior private.support_action_requests; fingerprint_value text; result_value jsonb; next_status text;
begin
 if p_actor is null or p_request_id is null or not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null) then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_admin is true and not exists(select 1 from public.admin_users where user_id=p_actor) then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_action not in ('create','reply','status','close','reopen') or p_action is null then raise exception 'Invalid support action' using errcode='22023'; end if;
 fingerprint_value:=md5(jsonb_build_array(p_admin,p_action,p_ticket_id,p_message,p_status,p_expected_updated_at,p_category,p_subject,p_order_number)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request_id::text,2));
 select * into prior from private.support_action_requests where actor_id=p_actor and request_id=p_request_id;
 if found then
  if prior.fingerprint<>fingerprint_value then raise exception 'Request already used' using errcode='P2003'; end if;
  return prior.result;
 end if;
 if p_action='create' then
  if p_category is null or p_category not in ('order','product','payment','shipping','account','other')
   or coalesce(length(trim(p_subject)),0) not between 4 and 120 or coalesce(length(trim(p_message)),0) not between 10 and 3000
   or length(coalesce(p_order_number,''))>40 then raise exception 'Check ticket details' using errcode='22023'; end if;
  if nullif(trim(p_order_number),'') is not null and not exists(select 1 from public.orders where order_number=trim(p_order_number) and user_id=p_actor) then
   raise exception 'Order does not belong to this account' using errcode='P2004'; end if;
  insert into public.support_tickets(user_id,category,order_number,subject,message)
  values(p_actor,p_category,nullif(trim(p_order_number),''),trim(p_subject),trim(p_message)) returning * into t;
 else
  select * into t from public.support_tickets where id=p_ticket_id for update;
  if not found or (not coalesce(p_admin,false) and t.user_id<>p_actor) then raise exception 'Ticket unavailable' using errcode='P2002'; end if;
  if p_admin is true and (p_expected_updated_at is null or t.updated_at is distinct from p_expected_updated_at) then
   raise exception 'Ticket changed; refresh before saving' using errcode='P2003'; end if;
  if not coalesce(p_admin,false) and (p_action='status' or p_status is not null) then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_action='reply' then
   if coalesce(length(trim(p_message)),0) not between 2 and 5000 then raise exception 'Write a reply of 2 to 5000 characters' using errcode='22023'; end if;
   next_status:=case when p_admin is true then coalesce(p_status,'resolved') else 'open' end;
  elsif p_action='status' and p_admin is true then next_status:=p_status;
  elsif p_action='close' then next_status:='closed';
  elsif p_action='reopen' then next_status:='open';
  else raise exception 'Invalid support action' using errcode='22023'; end if;
  if next_status is null or next_status not in ('open','in_progress','resolved','closed') then raise exception 'Invalid ticket status' using errcode='22023'; end if;
  update public.support_tickets set status=next_status,
   admin_response=case when p_admin is true and p_action='reply' then trim(p_message) else admin_response end
   where id=t.id returning * into t;
  if p_action='reply' then
   insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,message)
   values(t.id,p_actor,case when p_admin is true then 'admin' else 'customer' end,trim(p_message));
  end if;
 end if;
 if p_admin is true then
  insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
   values(p_actor,'support.'||p_action,'support_ticket',t.id::text,'Support ticket '||p_action,jsonb_build_object('status',t.status,'ticket_number',t.ticket_number));
 end if;
 result_value:=jsonb_build_object('ok',true,'ticket_id',t.id,'status',t.status,'ticket',to_jsonb(t),
  'email_enabled',exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'::jsonb),
  'email_queued',exists(select 1 from public.order_email_outbox where ticket_id=t.id and created_at=now() and status='pending'));
 insert into private.support_action_requests(actor_id,request_id,fingerprint,result) values(p_actor,p_request_id,fingerprint_value,result_value);
 return result_value;
end $$;
revoke all on function public.support_ticket_action(uuid,boolean,uuid,text,bigint,text,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.support_ticket_action(uuid,boolean,uuid,text,bigint,text,text,timestamptz,text,text,text) to service_role;

-- Reuse the durable email worker and credential controls for support updates.
alter table public.order_email_outbox alter column order_id drop not null;
alter table public.order_email_outbox add column ticket_id bigint references public.support_tickets(id) on delete cascade;
alter table public.order_email_outbox add constraint email_one_resource check ((order_id is not null)::int+(ticket_id is not null)::int=1);
alter table public.order_email_outbox drop constraint order_email_outbox_event_type_check;
alter table public.order_email_outbox add constraint order_email_outbox_event_type_check check(event_type in
 ('placed','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','tracking','support_created','support_reply','support_status'));
create unique index support_email_event_unique on public.order_email_outbox(ticket_id,event_key) where ticket_id is not null;
create function private.queue_support_email() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.support_tickets; kind text; key_value text; recipient_value text;
begin
 if not exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'::jsonb) then return new; end if;
 if TG_TABLE_NAME='support_ticket_messages' then
  if new.author_role<>'admin' then return new; end if;
  select * into t from public.support_tickets where id=new.ticket_id;
  kind:='support_reply';key_value:=kind||':'||new.id;
  update public.order_email_outbox set status='skipped',last_error='included_in_reply'
   where ticket_id=t.id and event_type='support_status' and created_at=now() and attempts=0 and status='pending';
 else
  t:=new;
  if TG_OP='INSERT' then kind:='support_created';key_value:=kind;
  elsif new.status is distinct from old.status then kind:='support_status';key_value:=kind||':'||new.status||':'||new.updated_at::text;
  else return new; end if;
 end if;
 select email into recipient_value from auth.users where id=t.user_id and email_confirmed_at is not null;
 if recipient_value is null then return new; end if;
 -- Email contains a ticket reference and status, never the private conversation.
 insert into public.order_email_outbox(ticket_id,event_key,event_type,recipient,order_snapshot)
 values(t.id,key_value,kind,recipient_value,jsonb_build_object('ticket_number',t.ticket_number,'status',t.status)) on conflict do nothing;
 return new;
end $$;
revoke all on function private.queue_support_email() from public,anon,authenticated;
create trigger support_ticket_queue_email after insert or update of status on public.support_tickets for each row execute function private.queue_support_email();
create trigger support_reply_queue_email after insert on public.support_ticket_messages for each row execute function private.queue_support_email();

create or replace function public.claim_order_emails(p_limit integer default 4)
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
    and not exists(select 1 from public.order_email_outbox earlier where (earlier.order_id=q.order_id or earlier.ticket_id=q.ticket_id)
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
