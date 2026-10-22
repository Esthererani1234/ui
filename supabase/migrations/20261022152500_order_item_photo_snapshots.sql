-- Preserve product presentation on new orders, even after catalog edits/deletion.
-- Existing items keep their historical financial snapshots and use live photos
-- as a display fallback; no historical pricing or customer rows are rewritten.
alter table public.order_items add column product_image_url text,
  add column product_slug text, add column product_category text;
create function private.snapshot_order_item_presentation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(p.image_url,''),p.image_urls[1]),p.slug,p.category
    into new.product_image_url,new.product_slug,new.product_category
    from public.products p where p.id=new.product_id;
  return new;
end $$;
revoke all on function private.snapshot_order_item_presentation() from public,anon,authenticated;
create trigger order_items_snapshot_presentation before insert on public.order_items
for each row execute function private.snapshot_order_item_presentation();
-- Rollback: drop the trigger/function and these three presentation columns only.
