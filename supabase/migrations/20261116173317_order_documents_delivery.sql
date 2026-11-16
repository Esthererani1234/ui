-- Additive: independent of checkout/fulfillment. No existing orders modified.
create table public.order_unit_tags(
 order_id bigint not null references public.orders(id), line_id bigint not null references public.order_items(id),
 unit integer not null check(unit>0), serial text check(length(serial) between 1 and 100),
 details jsonb not null, primary key(order_id,line_id,unit)
);
create unique index order_unit_tags_unique on public.order_unit_tags(upper(trim(serial)));
create table public.order_delivery_info(order_id bigint primary key references public.orders(id), details jsonb not null);
create table public.order_delivery_log(
 id bigint generated always as identity primary key, order_id bigint not null references public.orders(id),
 actor uuid not null, action text not null, details jsonb not null, created_at timestamptz not null default now()
);
create index order_delivery_log_lookup on public.order_delivery_log(order_id,id desc);
create table public.order_issued_documents(
 id uuid primary key,order_id bigint not null references public.orders(id),kind text not null check(kind in ('invoice','packing','ack','signed')),
 snapshot jsonb not null, pdf text not null, actor uuid not null, created_at timestamptz not null default now()
);
create index order_issued_documents_lookup on public.order_issued_documents(order_id,created_at desc);
alter table public.order_unit_tags enable row level security;
alter table public.order_delivery_info enable row level security;
alter table public.order_delivery_log enable row level security;
alter table public.order_issued_documents enable row level security;
revoke all on public.order_unit_tags,public.order_delivery_info,public.order_delivery_log,public.order_issued_documents from public,anon,authenticated,service_role;
grant select on public.order_unit_tags,public.order_delivery_info,public.order_delivery_log,public.order_issued_documents to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('delivery-evidence','delivery-evidence',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']);

create function public.order_document_state(p_order bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('order',jsonb_build_object('id',o.id,'order_number',o.order_number,'created_at',o.created_at,'first_name',o.first_name,'last_name',o.last_name,'shipping_address',o.shipping_address,'billing_address',to_jsonb(o)->'billing_address','email',o.email,'payment_method',o.payment_method,'payment_status',o.payment_status,'status',o.status,'subtotal',o.subtotal,'payment_surcharge',o.payment_surcharge,'insurance_amount',o.insurance_amount,'shipping_amount',o.shipping_amount,'tax_amount',to_jsonb(o)->'tax_amount','discount_amount',to_jsonb(o)->'discount_amount','total',o.total,'tracking_number',o.tracking_number),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_name',i.product_name,'sku',i.sku,'description',i.pricing_snapshot->>'description','metal',i.metal,'metal_weight_oz',i.metal_weight_oz,'purity',i.pricing_snapshot->>'purity','quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,'units',coalesce((select jsonb_agg(t.details||jsonb_build_object('unit',t.unit,'serial',t.serial) order by t.unit) from public.order_unit_tags t where t.order_id=o.id and t.line_id=i.id),'[]'::jsonb)) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
 'delivery',coalesce((select details from public.order_delivery_info where order_id=o.id),'{}'::jsonb))
 from public.orders o where o.id=p_order
$$;
create function public.order_document_action(p_order bigint,p_actor uuid,p_action text,p_data jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line bigint; slot integer; previous jsonb; oldtag public.order_unit_tags; risk text; st text;
begin
 if p_action='owner_invoice' then
 if p_data->>'kind' is distinct from 'invoice' or not exists(select 1 from public.orders where id=p_order and user_id=p_actor) then raise insufficient_privilege; end if;
 p_action:='issue';
 elsif not exists(select 1 from public.admin_users where user_id=p_actor) then raise insufficient_privilege; end if;
 select * into strict o from public.orders where id=p_order for update;
 if p_expected is distinct from public.order_document_state(p_order) then raise exception 'Order changed' using errcode='40001';end if;
 select decision into risk from public.order_risk_reviews where order_id=p_order for update;
 select details into previous from public.order_delivery_info where order_id=p_order;
 if p_action='serial' then
 if o.status in ('shipped','completed','cancelled','expired') or previous->>'status' in ('Out for Delivery','Delivered') or exists(select 1 from public.order_delivery_log where order_id=p_order and action='delivery' and details->'after'->>'status' in ('Out for Delivery','Delivered')) or exists(select 1 from public.order_issued_documents where order_id=p_order and kind='signed') then raise exception 'Serial edits locked' using errcode='P3001';end if;
 line:=(p_data->>'line')::bigint;slot:=(p_data->>'unit')::integer;
 if not exists(select 1 from public.order_items where id=line and order_id=p_order and slot between 1 and quantity) then raise exception 'Invalid unit' using errcode='22023';end if;
 select * into oldtag from public.order_unit_tags where order_id=p_order and line_id=line and unit=slot;
 delete from public.order_unit_tags where order_id=p_order and line_id=line and unit=slot;
 if exists(select 1 from jsonb_each_text(p_data-'line'-'unit') as e where length(trim(e.value))>0) then
 -- Release an assignment from a cancelled order only; its original audit and PDFs remain.
 delete from public.order_unit_tags t using public.orders other where t.order_id=other.id and other.status='cancelled' and upper(trim(t.serial))=upper(trim(p_data->>'serial'));
 insert into public.order_unit_tags values(p_order,line,slot,nullif(trim(p_data->>'serial'),''),p_data-'line'-'unit'-'serial');end if;
 previous:=to_jsonb(oldtag);
 elsif p_action='delivery' or (p_action='issue' and p_data->>'kind'='signed') then
 st:=p_data->>'status';
 if p_action='delivery' and (st is null or st not in ('Pending','Preparing','Out for Delivery','Delivered','Failed Delivery')) then raise exception 'Invalid status' using errcode='22023';end if;
 if (p_action='issue' or st in ('Out for Delivery','Delivered')) and (o.payment_status is distinct from 'paid' or o.status in ('cancelled','expired') or risk is distinct from 'approved') then raise exception 'Payment and approved review required' using errcode='P3002';end if;
 if p_action='delivery' then insert into public.order_delivery_info values(p_order,p_data) on conflict(order_id) do update set details=excluded.details;end if;
 elsif p_action not in ('issue','evidence') then raise exception 'Invalid action' using errcode='22023';end if;
 if p_action='issue' then
 insert into public.order_issued_documents values((p_data->>'id')::uuid,p_order,p_data->>'kind',p_expected||jsonb_build_object('receipt',p_data->'receipt'),p_data->>'pdf',p_actor,now());
 end if;
 insert into public.order_delivery_log(order_id,actor,action,details) values(p_order,p_actor,p_action,case when p_action='issue' then p_data-'pdf'-'receipt' else jsonb_build_object('before',previous,'after',p_data) end);
end $$;
revoke all on function public.order_document_state(bigint),public.order_document_action(bigint,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.order_document_state(bigint),public.order_document_action(bigint,uuid,text,jsonb,jsonb) to service_role;
