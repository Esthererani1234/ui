create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Generated inside the database; never embedded in source, browser code, or cron text.
do $$ begin
 if not exists(select 1 from vault.secrets where name='order_email_worker_token') then
  perform vault.create_secret(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'order_email_worker_token','Internal order email scheduler authentication');
 end if;
end $$;
create function public.check_order_email_worker_token(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select sha256(convert_to(p_token,'UTF8'))=sha256(convert_to(decrypted_secret,'UTF8'))
 from vault.decrypted_secrets where name='order_email_worker_token' limit 1),false);
$$;
revoke all on function public.check_order_email_worker_token(text) from public,anon,authenticated;
grant execute on function public.check_order_email_worker_token(text) to service_role;
create function private.dispatch_order_emails() returns void language plpgsql security definer set search_path='' as $$
declare worker_token text;
begin
 if not exists(select 1 from public.app_settings where key='order_emails_enabled' and value='true'::jsonb)
   or not exists(select 1 from public.order_email_outbox where status in ('pending','sending') and available_at<=now()) then return; end if;
 select decrypted_secret into worker_token from vault.decrypted_secrets where name='order_email_worker_token' limit 1;
 if worker_token is null then return; end if;
 perform net.http_post(url:='https://jwquqphzsnnijopabuhn.supabase.co/functions/v1/order-email-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-order-email-token',worker_token),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function private.dispatch_order_emails() from public,anon,authenticated;
select cron.schedule('gold-order-emails','* * * * *','select private.dispatch_order_emails()');
-- Rollback: select cron.unschedule('gold-order-emails'); retain delivery records.
