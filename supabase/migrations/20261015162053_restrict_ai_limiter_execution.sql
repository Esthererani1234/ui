-- Deploy both assistant servers using service credentials before applying this.
revoke all on function public.check_ai_chat_rate_limit(text) from public,anon,authenticated;
grant execute on function public.check_ai_chat_rate_limit(text) to service_role;
alter function public.check_ai_chat_rate_limit(text) set search_path='';
alter table private.ai_chat_rate_limits enable row level security;
alter table private.checkout_rate_limits enable row level security;
