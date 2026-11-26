-- Staged only. Deploy together with the server quote/order changes, after tax verification.
begin;
create table public.pickup_quote_terms (
 quote_id uuid primary key references public.checkout_quotes(id),
 tax_amount numeric(14,2) not null check(tax_amount>=0),
 tax_calculation_reference text not null check(length(trim(tax_calculation_reference))>0),
 verified_at timestamptz not null default now()
);
create table public.pickup_orders (
 order_id bigint primary key references public.orders(id),
 quote_id uuid not null unique references public.pickup_quote_terms(quote_id),
 tax_amount numeric(14,2) not null check(tax_amount>=0),
 office_address text not null,
 phase text not null default 'preparing' check(phase in ('preparing','offered','scheduled','collected')),
 selected_time timestamptz,
 signed_document_reference text,
 collected_at timestamptz,
 check ((phase in ('scheduled','collected'))=(selected_time is not null)),
 check ((phase='collected')=(collected_at is not null)),
 check ((phase='collected')=(signed_document_reference is not null))
);
create table public.pickup_time_offers (
 order_id bigint not null references public.pickup_orders(order_id),
 starts_at timestamptz not null,
 primary key(order_id, starts_at)
);
alter table public.pickup_orders add foreign key(order_id,selected_time) references public.pickup_time_offers(order_id,starts_at);
create unique index pickup_one_appointment_per_time on public.pickup_orders(selected_time) where selected_time is not null;
alter table public.pickup_orders enable row level security;
alter table public.pickup_time_offers enable row level security;
alter table public.pickup_quote_terms enable row level security;
revoke all on public.pickup_orders,public.pickup_time_offers,public.pickup_quote_terms from public,anon,authenticated;
commit;
