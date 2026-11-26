create or replace function public.manage_store_promos(action text,code_input text default null,kind_input text default null,amount_input numeric default null,limit_input int default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise insufficient_privilege; end if;
 if action='create' then insert into private.store_promos(code,kind,amount,max_uses,created_by) values(upper(trim(code_input)),kind_input,amount_input,limit_input,auth.uid());
 elsif action='add_use' then update private.store_promos set max_uses=max_uses+1 where code=upper(trim(code_input)) and max_uses<1000000;
 if not found then raise exception 'Use limit cannot be increased';end if;
 elsif action='enable' then update private.store_promos set enabled=true where code=upper(trim(code_input));
 elsif action='disable' then update private.store_promos set enabled=false where code=upper(trim(code_input));
 elsif action is distinct from 'list' then raise exception 'Unknown action';end if;
 return coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by created_at desc) from private.store_promos p),'[]');end $$;
