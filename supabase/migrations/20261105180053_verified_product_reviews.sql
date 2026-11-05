-- Purchase and customer identifiers are private; public reads use a curated API.
create table public.product_reviews (
 id uuid primary key default gen_random_uuid(),
 order_item_id bigint not null unique references public.order_items(id),
 product_id bigint not null references public.products(id),
 user_id uuid references auth.users(id) on delete set null,
 request_id uuid not null,
 rating integer not null check(rating between 1 and 5),
 body text not null check(char_length(body) between 20 and 2000),
 photo_paths text[] not null default '{}' check(cardinality(photo_paths)<=3),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 consent_version text not null default 'public-review-v1' check(consent_version='public-review-v1'),
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,request_id)
);
create index product_reviews_product_time on public.product_reviews(product_id,created_at desc,id);
alter table public.product_reviews enable row level security;
revoke all on public.product_reviews from public,anon,authenticated;
grant select,insert on public.product_reviews to service_role;
create function public.submit_product_review(p_actor uuid,p_item bigint,p_request uuid,p_rating integer,p_body text,p_photos text[],p_hash text,p_consent text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.order_items%rowtype; ord public.orders%rowtype; previous public.product_reviews%rowtype; result public.product_reviews%rowtype;
begin
 select * into item from public.order_items where id=p_item;
 if not found then raise exception 'Order item not found' using errcode='P2002';end if;
 select * into ord from public.orders where id=item.order_id and user_id=p_actor for update;
 if not found then raise exception 'Order item not found' using errcode='P2002';end if;
 select * into previous from public.product_reviews where user_id=p_actor and request_id=p_request;
 if found then
  if previous.order_item_id<>p_item or previous.payload_hash<>p_hash then raise exception 'Review request already used' using errcode='P2003';end if;
  return to_jsonb(previous);
 end if;
 if ord.status<>'completed' or ord.payment_status<>'paid' then raise exception 'Reviews open after payment and delivery.' using errcode='P2006';end if;
 if exists(select 1 from public.product_reviews where order_item_id=p_item) then raise exception 'You have already reviewed this purchased item.' using errcode='P2003';end if;
 if p_consent is distinct from 'public-review-v1' or p_rating is null or p_rating not between 1 and 5 or p_body is null or length(trim(p_body)) not between 20 and 2000 or p_photos is null or cardinality(p_photos)>3 then raise exception 'Invalid review details or public sharing consent.' using errcode='P2006';end if;
 insert into public.product_reviews(order_item_id,product_id,user_id,request_id,rating,body,photo_paths,payload_hash,consent_version)
 values(p_item,item.product_id,p_actor,p_request,p_rating,trim(p_body),p_photos,p_hash,p_consent) returning * into result;
 return to_jsonb(result);
end $$;
revoke all on function public.submit_product_review(uuid,bigint,uuid,integer,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.submit_product_review(uuid,bigint,uuid,integer,text,text[],text,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-review-photos','product-review-photos',false,1048576,array['image/jpeg','image/png','image/webp']);
-- No direct storage access. Public API signs only photos attached to published reviews.
-- Rollback UI/endpoint first; preserve review and photo records.
