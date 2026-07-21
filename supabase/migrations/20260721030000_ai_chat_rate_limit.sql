create table if not exists private.ai_chat_rate_limits (
  client_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);

revoke all on table private.ai_chat_rate_limits from public, anon, authenticated;

create or replace function public.check_ai_chat_rate_limit(p_client_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  next_count integer;
begin
  if p_client_hash is null or length(p_client_hash) <> 64 then
    return false;
  end if;

  insert into private.ai_chat_rate_limits as limits (
    client_hash,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_client_hash,
    now(),
    1,
    now()
  )
  on conflict (client_hash) do update
  set
    request_count = case
      when limits.window_started_at <= now() - interval '10 minutes' then 1
      else limits.request_count + 1
    end,
    window_started_at = case
      when limits.window_started_at <= now() - interval '10 minutes' then now()
      else limits.window_started_at
    end,
    updated_at = now()
  returning request_count into next_count;

  return next_count <= 20;
end;
$$;

revoke all on function public.check_ai_chat_rate_limit(text) from public;
grant execute on function public.check_ai_chat_rate_limit(text) to anon, authenticated;

comment on function public.check_ai_chat_rate_limit(text) is
  'Atomically limits AI chat requests to 20 per anonymous client hash per 10-minute window.';
