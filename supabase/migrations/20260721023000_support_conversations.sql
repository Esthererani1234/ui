create table if not exists public.support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('customer', 'admin')),
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at, id);

alter table public.support_ticket_messages enable row level security;

drop policy if exists "ticket participants read messages" on public.support_ticket_messages;
create policy "ticket participants read messages"
on public.support_ticket_messages for select to authenticated
using (
  exists (
    select 1 from public.support_tickets t
    where t.id = support_ticket_messages.ticket_id
      and (t.user_id = (select auth.uid()) or (select private.is_admin()))
  )
);

grant select on public.support_ticket_messages to authenticated;

create or replace function private.create_initial_support_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.support_ticket_messages (ticket_id, author_user_id, author_role, message, created_at)
  values (new.id, new.user_id, 'customer', new.message, new.created_at);
  return new;
end;
$$;

revoke all on function private.create_initial_support_message() from public, anon, authenticated;
drop trigger if exists support_ticket_create_initial_message on public.support_tickets;
create trigger support_ticket_create_initial_message
after insert on public.support_tickets
for each row execute function private.create_initial_support_message();

insert into public.support_ticket_messages (ticket_id, author_user_id, author_role, message, created_at)
select t.id, t.user_id, 'customer', t.message, t.created_at
from public.support_tickets t
where not exists (
  select 1 from public.support_ticket_messages m
  where m.ticket_id = t.id and m.author_role = 'customer'
);

insert into public.support_ticket_messages (ticket_id, author_user_id, author_role, message, created_at)
select t.id, coalesce((select user_id from public.admin_users order by created_at limit 1), t.user_id), 'admin', t.admin_response, t.updated_at
from public.support_tickets t
where t.admin_response is not null
  and not exists (
    select 1 from public.support_ticket_messages m
    where m.ticket_id = t.id and m.author_role = 'admin'
  );
