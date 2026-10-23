-- Sell enquiries are separate from support and never exposed through the client Data API.
create table public.sell_requests (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 reference text not null unique default ('SELL-' || upper(replace(gen_random_uuid()::text,'-',''))),
 name text not null check (length(name) between 2 and 120),
 email text not null check (length(email) between 3 and 254),
 phone text not null check (length(phone) between 7 and 30),
 message text not null check (length(message) between 10 and 5000),
 status text not null default 'new' check (status in ('new','reviewing','contacted','quoted','closed')),
 internal_notes text not null default '' check (length(internal_notes)<=5000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index sell_requests_created_idx on public.sell_requests(created_at desc,id);
alter table public.sell_requests enable row level security;
revoke all on public.sell_requests from public,anon,authenticated;
grant select,insert,update on public.sell_requests to service_role;

-- Invoker functions are service-only: the edge function authenticates every admin action.
create function public.submit_sell_request(p_request_id uuid,p_name text,p_email text,p_phone text,p_message text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.sell_requests;
begin
 insert into public.sell_requests(request_id,name,email,phone,message)
 values(p_request_id,p_name,p_email,p_phone,p_message)
 on conflict(request_id) do nothing;
 select * into strict r from public.sell_requests where request_id=p_request_id;
 if (r.name,r.email,r.phone,r.message) is distinct from (p_name,p_email,p_phone,p_message) then
  raise exception 'Request reference already used' using errcode='P2003';
 end if;
 return jsonb_build_object('reference',r.reference,'received_at',r.created_at);
end $$;
revoke all on function public.submit_sell_request(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_sell_request(uuid,text,text,text,text) to service_role;

create function public.update_sell_request(p_actor uuid,p_id uuid,p_version integer,p_status text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.sell_requests;
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) then
  raise exception 'Administrator required' using errcode='42501';
 end if;
 select * into r from public.sell_requests where id=p_id for update;
 if not found then raise exception 'Request unavailable' using errcode='P2002'; end if;
 -- A retried successful save is a no-op, not a second audit entry.
 if r.status=p_status and r.internal_notes=p_notes then return to_jsonb(r); end if;
 if r.version is distinct from p_version then raise exception 'Request changed' using errcode='P2003'; end if;
 update public.sell_requests set status=p_status,internal_notes=p_notes,version=version+1,updated_at=now()
 where id=p_id returning * into r;
 insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
 values(p_actor,'sell_request.update','sell_request',r.id::text,'Sell request reviewed',jsonb_build_object('status',r.status,'version',r.version));
 return to_jsonb(r);
end $$;
revoke all on function public.update_sell_request(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.update_sell_request(uuid,uuid,integer,text,text) to service_role;
