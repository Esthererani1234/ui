create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null check (
    event_type in (
      'page_view',
      'product_view',
      'listing_click',
      'add_to_cart',
      'checkout_start'
    )
  ),
  visitor_hash text not null check (length(visitor_hash) = 64),
  session_hash text not null check (length(session_hash) = 64),
  product_id bigint references public.products(id) on delete set null,
  path text not null check (length(path) between 1 and 300),
  referrer_host text,
  country_code text,
  region_code text,
  city text,
  timezone text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_type_time_idx
  on public.analytics_events (event_type, occurred_at desc);
create index if not exists analytics_events_product_time_idx
  on public.analytics_events (product_id, occurred_at desc)
  where product_id is not null;
create index if not exists analytics_events_visitor_time_idx
  on public.analytics_events (visitor_hash, occurred_at desc);
create index if not exists analytics_events_session_time_idx
  on public.analytics_events (session_hash, occurred_at desc);

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from public, anon, authenticated;
grant select, insert, update, delete on table public.analytics_events
  to service_role;
grant usage, select on sequence public.analytics_events_id_seq
  to service_role;

create or replace function public.admin_traffic_analytics(
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 365);
  v_since timestamptz;
  v_previous_since timestamptz;
  v_summary jsonb;
  v_previous jsonb;
  v_daily jsonb;
  v_products jsonb;
  v_locations jsonb;
  v_hours jsonb;
  v_pages jsonb;
  v_sources jsonb;
  v_first_event timestamptz;
begin
  v_since := now() - make_interval(days => v_days);
  v_previous_since := v_since - make_interval(days => v_days);

  select min(occurred_at)
  into v_first_event
  from public.analytics_events;

  with event_totals as (
    select
      count(distinct visitor_hash) as visitors,
      count(distinct session_hash) as sessions,
      count(*) filter (where event_type = 'page_view') as page_views,
      count(*) filter (where event_type = 'product_view') as product_views,
      count(*) filter (where event_type = 'listing_click') as listing_clicks,
      count(*) filter (where event_type = 'add_to_cart') as cart_adds,
      count(*) filter (where event_type = 'checkout_start') as checkout_starts
    from public.analytics_events
    where occurred_at >= v_since
  ),
  order_totals as (
    select
      count(*) as orders,
      coalesce(sum(total), 0) as revenue
    from public.orders
    where created_at >= v_since
      and status <> 'cancelled'
  )
  select jsonb_build_object(
    'visitors', e.visitors,
    'sessions', e.sessions,
    'page_views', e.page_views,
    'product_views', e.product_views,
    'listing_clicks', e.listing_clicks,
    'cart_adds', e.cart_adds,
    'checkout_starts', e.checkout_starts,
    'orders', o.orders,
    'revenue', o.revenue,
    'pages_per_session',
      coalesce(round(e.page_views::numeric / nullif(e.sessions, 0), 2), 0),
    'listing_click_rate',
      coalesce(round(100.0 * e.listing_clicks / nullif(e.page_views, 0), 2), 0),
    'product_to_cart_rate',
      coalesce(round(100.0 * e.cart_adds / nullif(e.product_views, 0), 2), 0),
    'visitor_to_order_rate',
      coalesce(round(100.0 * o.orders / nullif(e.visitors, 0), 2), 0)
  )
  into v_summary
  from event_totals e
  cross join order_totals o;

  with event_totals as (
    select
      count(distinct visitor_hash) as visitors,
      count(distinct session_hash) as sessions,
      count(*) filter (where event_type = 'page_view') as page_views,
      count(*) filter (where event_type = 'product_view') as product_views,
      count(*) filter (where event_type = 'listing_click') as listing_clicks,
      count(*) filter (where event_type = 'add_to_cart') as cart_adds,
      count(*) filter (where event_type = 'checkout_start') as checkout_starts
    from public.analytics_events
    where occurred_at >= v_previous_since
      and occurred_at < v_since
  ),
  order_totals as (
    select
      count(*) as orders,
      coalesce(sum(total), 0) as revenue
    from public.orders
    where created_at >= v_previous_since
      and created_at < v_since
      and status <> 'cancelled'
  )
  select jsonb_build_object(
    'visitors', e.visitors,
    'sessions', e.sessions,
    'page_views', e.page_views,
    'product_views', e.product_views,
    'listing_clicks', e.listing_clicks,
    'cart_adds', e.cart_adds,
    'checkout_starts', e.checkout_starts,
    'orders', o.orders,
    'revenue', o.revenue
  )
  into v_previous
  from event_totals e
  cross join order_totals o;

  with date_range as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    ) as day
  ),
  event_daily as (
    select
      date_trunc('day', occurred_at) as day,
      count(distinct visitor_hash) as visitors,
      count(distinct session_hash) as sessions,
      count(*) filter (where event_type = 'page_view') as page_views,
      count(*) filter (where event_type = 'product_view') as product_views,
      count(*) filter (where event_type = 'listing_click') as listing_clicks,
      count(*) filter (where event_type = 'add_to_cart') as cart_adds,
      count(*) filter (where event_type = 'checkout_start') as checkout_starts
    from public.analytics_events
    where occurred_at >= v_since
    group by 1
  ),
  order_daily as (
    select
      date_trunc('day', created_at) as day,
      count(*) as orders,
      coalesce(sum(total), 0) as revenue
    from public.orders
    where created_at >= v_since
      and status <> 'cancelled'
    group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'visitors', coalesce(e.visitors, 0),
        'sessions', coalesce(e.sessions, 0),
        'page_views', coalesce(e.page_views, 0),
        'product_views', coalesce(e.product_views, 0),
        'listing_clicks', coalesce(e.listing_clicks, 0),
        'cart_adds', coalesce(e.cart_adds, 0),
        'checkout_starts', coalesce(e.checkout_starts, 0),
        'orders', coalesce(o.orders, 0),
        'revenue', coalesce(o.revenue, 0)
      )
      order by d.day
    ),
    '[]'::jsonb
  )
  into v_daily
  from date_range d
  left join event_daily e on e.day = d.day
  left join order_daily o on o.day = d.day;

  with event_counts as (
    select
      product_id,
      count(*) filter (where event_type = 'product_view') as views,
      count(*) filter (where event_type = 'listing_click') as clicks,
      count(*) filter (where event_type = 'add_to_cart') as cart_adds
    from public.analytics_events
    where occurred_at >= v_since
      and product_id is not null
    group by product_id
  ),
  sales as (
    select
      oi.product_id,
      count(distinct o.id) as orders,
      coalesce(sum(oi.quantity), 0) as units,
      coalesce(sum(oi.line_total), 0) as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.created_at >= v_since
      and o.status <> 'cancelled'
    group by oi.product_id
  ),
  ranked as (
    select
      p.id,
      p.name,
      p.slug,
      coalesce(e.views, 0) as views,
      coalesce(e.clicks, 0) as clicks,
      coalesce(e.cart_adds, 0) as cart_adds,
      coalesce(s.orders, 0) as orders,
      coalesce(s.units, 0) as units,
      coalesce(s.revenue, 0) as revenue,
      coalesce(
        round(100.0 * e.cart_adds / nullif(e.views, 0), 2),
        0
      ) as cart_rate
    from public.products p
    left join event_counts e on e.product_id = p.id
    left join sales s on s.product_id = p.id
    where coalesce(e.views, 0) > 0
       or coalesce(e.clicks, 0) > 0
       or coalesce(e.cart_adds, 0) > 0
       or coalesce(s.units, 0) > 0
    order by coalesce(e.views, 0) desc, coalesce(e.clicks, 0) desc
    limit 100
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  into v_products
  from ranked r;

  with ranked as (
    select
      coalesce(country_code, '—') as country,
      coalesce(region_code, '—') as region,
      coalesce(city, 'Unknown') as city,
      count(distinct visitor_hash) as visitors,
      count(*) filter (where event_type = 'page_view') as page_views
    from public.analytics_events
    where occurred_at >= v_since
    group by 1, 2, 3
    order by visitors desc, page_views desc
    limit 20
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  into v_locations
  from ranked r;

  with hours as (
    select generate_series(0, 23) as hour
  ),
  counts as (
    select
      extract(
        hour from occurred_at at time zone 'America/New_York'
      )::integer as hour,
      count(distinct visitor_hash) as visitors,
      count(*) filter (where event_type = 'page_view') as page_views
    from public.analytics_events
    where occurred_at >= v_since
    group by 1
  )
  select jsonb_agg(
    jsonb_build_object(
      'hour', h.hour,
      'visitors', coalesce(c.visitors, 0),
      'page_views', coalesce(c.page_views, 0)
    )
    order by h.hour
  )
  into v_hours
  from hours h
  left join counts c on c.hour = h.hour;

  with ranked as (
    select
      path,
      count(*) as page_views,
      count(distinct visitor_hash) as visitors
    from public.analytics_events
    where occurred_at >= v_since
      and event_type = 'page_view'
    group by path
    order by page_views desc
    limit 20
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  into v_pages
  from ranked r;

  with ranked as (
    select
      coalesce(referrer_host, 'Direct / unknown') as source,
      count(distinct visitor_hash) as visitors,
      count(*) filter (where event_type = 'page_view') as page_views
    from public.analytics_events
    where occurred_at >= v_since
    group by 1
    order by visitors desc, page_views desc
    limit 20
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  into v_sources
  from ranked r;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'days', v_days,
      'start', v_since,
      'end', now(),
      'tracking_started_at', v_first_event,
      'timezone', 'America/New_York'
    ),
    'summary', v_summary,
    'previous', v_previous,
    'daily', v_daily,
    'products', v_products,
    'locations', v_locations,
    'hours', v_hours,
    'pages', v_pages,
    'sources', v_sources
  );
end;
$$;

revoke all on function public.admin_traffic_analytics(integer)
from public, anon, authenticated;
grant execute on function public.admin_traffic_analytics(integer)
to service_role;
