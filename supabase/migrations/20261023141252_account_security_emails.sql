-- Add account alerts to the existing private, leased, idempotent email outbox.
-- No historical events are backfilled. No passwords, hashes, OTPs or tokens are copied.
alter table public.order_email_outbox add column account_user_id uuid references auth.users(id) on delete cascade;
alter table public.order_email_outbox drop constraint email_one_resource;
alter table public.order_email_outbox add constraint email_one_resource check (
 (order_id is not null)::int+(ticket_id is not null)::int+(account_user_id is not null)::int=1);
alter table public.order_email_outbox drop constraint order_email_outbox_event_type_check;
alter table public.order_email_outbox add constraint order_email_outbox_event_type_check check(event_type in
 ('placed','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','tracking',
 'support_created','support_reply','support_status','wire_instructions','account_signin','account_password_changed','account_email_changed'));
create unique index account_email_event_unique on public.order_email_outbox(account_user_id,event_key) where account_user_id is not null;

create function private.queue_account_security_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient_value text; kind text; event_key_value text;
begin
 if not exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'::jsonb) then return new; end if;
 if TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='customer_sms_sessions' then
   if new.purpose not in ('signin','signup') or new.expires_at<=now() then return new; end if;
   select email into recipient_value from auth.users where id=new.user_id and email_confirmed_at is not null;
   if recipient_value is null then return new; end if;
   insert into public.order_email_outbox(account_user_id,event_key,event_type,recipient,order_snapshot,available_at)
   values(new.user_id,'signin:'||new.session_id,'account_signin',recipient_value,
     jsonb_build_object('occurred_at',new.verified_at),now())
   on conflict(account_user_id,event_key) where account_user_id is not null do nothing;
 elsif TG_TABLE_SCHEMA='auth' and TG_TABLE_NAME='users' then
   if old.email_confirmed_at is null or coalesce(old.email,'')='' then return new; end if;
   if new.encrypted_password is distinct from old.encrypted_password and coalesce(old.encrypted_password,'')<>'' then
     insert into public.order_email_outbox(account_user_id,event_key,event_type,recipient,order_snapshot,available_at)
     values(new.id,'password:'||gen_random_uuid(),'account_password_changed',old.email,jsonb_build_object('occurred_at',now()),now());
   end if;
   if new.email is distinct from old.email then
     event_key_value:='email:'||gen_random_uuid();
     -- Notify the previously verified address even if the new address is controlled by an attacker.
     insert into public.order_email_outbox(account_user_id,event_key,event_type,recipient,order_snapshot,available_at)
     values(new.id,event_key_value||':old','account_email_changed',old.email,jsonb_build_object('occurred_at',now()),now());
     if new.email_confirmed_at is not null and coalesce(new.email,'')<>'' then
       insert into public.order_email_outbox(account_user_id,event_key,event_type,recipient,order_snapshot,available_at)
       values(new.id,event_key_value||':new','account_email_changed',new.email,jsonb_build_object('occurred_at',now()),now());
     end if;
   end if;
 end if;
 return new;
exception when others then
 -- Notification outages must not lock customers out; report a fixed, non-sensitive diagnostic.
 raise warning 'account_security_email_queue_failed';
 return new;
end $$;
revoke all on function private.queue_account_security_email() from public,anon,authenticated;
create trigger customer_verified_signin_email after insert or update on public.customer_sms_sessions
for each row execute function private.queue_account_security_email();
create trigger customer_account_change_email after update of encrypted_password,email on auth.users
for each row execute function private.queue_account_security_email();

-- Rollback: drop the two triggers first; retain queued/sent records for audit.
