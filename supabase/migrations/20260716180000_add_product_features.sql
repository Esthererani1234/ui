alter table public.products
  add column if not exists features text[];

update public.products
set features = '{}'::text[]
where features is null;

alter table public.products
  alter column features set default '{}'::text[],
  alter column features set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_features_limit'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_features_limit
      check (cardinality(features) <= 12);
  end if;
end
$$;
