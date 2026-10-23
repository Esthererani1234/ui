-- Private case correspondence; never mix with support tickets or expose internal notes.
create table public.sell_case_messages (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.sell_requests(id),
 sender_id uuid references auth.users(id) on delete set null,
 sender_role text not null check(sender_role in ('customer','admin')),
 request_id uuid not null,
 body text not null default '' check(char_length(body)<=2000),
 photo_path text,
 photo_hash text,
 created_at timestamptz not null default clock_timestamp(),
 unique(sender_id,request_id),
 check(length(trim(body))>0 or photo_path is not null),
 check((photo_path is null and photo_hash is null) or (photo_path is not null and photo_hash ~ '^[a-f0-9]{64}$'))
);
create index sell_case_messages_case_time on public.sell_case_messages(case_id,created_at,id);
alter table public.sell_case_messages enable row level security;
revoke all on public.sell_case_messages from public,anon,authenticated;
grant select,insert on public.sell_case_messages to service_role;

create function public.append_sell_case_message(p_actor uuid,p_case uuid,p_request uuid,p_body text,p_photo_path text default null,p_photo_hash text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.sell_requests%rowtype; existing public.sell_case_messages%rowtype; result public.sell_case_messages%rowtype; admin boolean;
begin
 select exists(select 1 from public.admin_users where user_id=p_actor) into admin;
 select * into c from public.sell_requests where id=p_case and (user_id=p_actor or admin) for update;
 if not found then raise exception 'Case not found' using errcode='P2002'; end if;
 select * into existing from public.sell_case_messages where sender_id=p_actor and request_id=p_request;
 if found then
  if existing.case_id<>p_case or existing.body is distinct from trim(p_body) or existing.photo_hash is distinct from p_photo_hash then
   raise exception 'Request reference already used' using errcode='P2003'; end if;
  return to_jsonb(existing);
 end if;
 if (select count(*) from public.sell_case_messages where case_id=p_case)>=200 then raise exception 'Conversation limit reached. Contact support.' using errcode='P2006'; end if;
 if p_photo_path is not null and (select count(*) from public.sell_case_messages where case_id=p_case and photo_path is not null)>=6 then raise exception 'This case already has six photos.' using errcode='P2006'; end if;
 insert into public.sell_case_messages(case_id,sender_id,sender_role,request_id,body,photo_path,photo_hash)
 values(p_case,p_actor,case when admin then 'admin' else 'customer' end,p_request,trim(p_body),p_photo_path,p_photo_hash) returning * into result;
 update public.sell_requests set updated_at=clock_timestamp(),version=version+1 where id=p_case;
 if admin then insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'sell_case_reply','sell_request',p_case::text,jsonb_build_object('message_id',result.id,'has_photo',p_photo_path is not null)); end if;
 return to_jsonb(result);
end $$;
revoke all on function public.append_sell_case_message(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.append_sell_case_message(uuid,uuid,uuid,text,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('selling-case-photos','selling-case-photos',false,1048576,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- No customer storage policies: uploads and 5-minute signed reads require the case API.
-- Rollback the UI/Edge function first. Preserve conversation records and photos; do not drop customer data.
