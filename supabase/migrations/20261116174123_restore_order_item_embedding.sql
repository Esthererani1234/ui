-- Each order item already has a globally unique id. Use that id and the physical
-- unit number as the natural identity. Keeping both foreign keys in the primary
-- key advertised this table as a second orders/order_items join to PostgREST.
set local lock_timeout = '5s';
alter table public.order_unit_tags
  drop constraint order_unit_tags_pkey,
  add constraint order_unit_tags_pkey primary key (line_id, unit);
create index order_unit_tags_by_order on public.order_unit_tags(order_id, line_id, unit);
notify pgrst, 'reload schema';
