-- Old guest enquiries remain available to admins; never claim them by email alone.
alter table public.sell_requests add column user_id uuid references auth.users(id) on delete set null;
create index sell_requests_owner_created_idx on public.sell_requests(user_id,created_at desc,id);

create function public.submit_sell_request(p_user_id uuid,p_request_id uuid,p_name text,p_email text,p_phone text,p_message text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.sell_requests;
begin
 if p_user_id is null then raise exception 'Account required' using errcode='42501'; end if;
 insert into public.sell_requests(user_id,request_id,name,email,phone,message)
 values(p_user_id,p_request_id,p_name,p_email,p_phone,p_message) on conflict(request_id) do nothing;
 select * into strict r from public.sell_requests where request_id=p_request_id;
 if (r.user_id,r.name,r.email,r.phone,r.message) is distinct from (p_user_id,p_name,p_email,p_phone,p_message) then
  raise exception 'Request reference already used' using errcode='P2003';
 end if;
 return jsonb_build_object('reference',r.reference,'received_at',r.created_at);
end $$;
revoke all on function public.submit_sell_request(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_sell_request(uuid,uuid,text,text,text,text) to service_role;
-- Retire the guest entry point; keep its definition for migration history and rollback review.
revoke all on function public.submit_sell_request(uuid,text,text,text,text) from service_role;
