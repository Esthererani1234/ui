alter table public.products add column listing_removed_at timestamptz;
alter table public.products add constraint removed_listings_unpublished check(listing_removed_at is null or (is_active=false and is_featured=false));
create function public.remove_store_listing(product_key bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise insufficient_privilege; end if;
 update public.products set listing_removed_at=clock_timestamp(),is_active=false,is_featured=false where id=product_key and listing_removed_at is null;
 if found then insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata) values(auth.uid(),'listing_removed','product',product_key::text,'Removed from store catalog','{}');end if;
end $$;
revoke all on function public.remove_store_listing(bigint) from public,anon;
grant execute on function public.remove_store_listing(bigint) to authenticated;