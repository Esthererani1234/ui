-- DRAFT ONLY. Intentionally OUTSIDE supabase/migrations. Never applied to production.
-- Isolated schema prototype: no existing table is changed, no production role granted.
begin;
create schema legal_draft;
revoke all on schema legal_draft from public;
create table legal_draft.bundles (
 version text primary key,
 bundle_hash text not null unique check(bundle_hash ~ '^[a-f0-9]{64}$'),
 exact_documents jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table legal_draft.consents (
 order_id bigint primary key,
 account_id uuid not null,
 quote_id uuid not null unique,
 version text not null references legal_draft.bundles(version),
 bundle_hash text not null references legal_draft.bundles(bundle_hash),
 acknowledgment text not null,
 exact_quote jsonb not null,
 total_cents bigint not null check(total_cents>0),
 payment_method text not null check(payment_method in ('card','wire')),
 payment_deadline timestamptz,
 assented_at timestamptz not null default clock_timestamp(),
 offer_expires_at timestamptz not null,
 unique(order_id,account_id),
 check(offer_expires_at>assented_at),
 check(payment_method<>'wire' or (payment_deadline is not null and payment_deadline>assented_at))
);
create table legal_draft.events (
 id bigint generated always as identity primary key,
 order_id bigint not null references legal_draft.consents(order_id),
 event_key text not null unique,
 event_type text not null check(event_type in ('submitted','company_accepted','withdrawn','rejected','expired','payment_verified','cancelled','refund','shipped','delivered')),
 actor_kind text not null check(actor_kind in ('customer','admin','payment_adapter','system')),
 actor_id text not null,
 evidence jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
create unique index one_company_acceptance on legal_draft.events(order_id) where event_type='company_accepted';
create function legal_draft.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Evidence is append-only'; end $$;
create function legal_draft.validate_bundle() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from legal_draft.bundles where version=new.version and bundle_hash=new.bundle_hash) then
  raise exception 'Version/hash mismatch'; end if;
 return new;
end $$;
create trigger matching_bundle before insert on legal_draft.consents for each row execute function legal_draft.validate_bundle();
create trigger bundles_immutable before update or delete on legal_draft.bundles for each row execute function legal_draft.immutable();
create trigger consents_immutable before update or delete on legal_draft.consents for each row execute function legal_draft.immutable();
create trigger events_immutable before update or delete on legal_draft.events for each row execute function legal_draft.immutable();
alter table legal_draft.bundles enable row level security;
alter table legal_draft.bundles force row level security;
alter table legal_draft.consents enable row level security;
alter table legal_draft.consents force row level security;
alter table legal_draft.events enable row level security;
alter table legal_draft.events force row level security;
revoke all on all tables in schema legal_draft from public;
revoke all on all sequences in schema legal_draft from public;
revoke all on all functions in schema legal_draft from public;
-- No frontend policies or role grants. Integration must use tightly scoped server RPCs,
-- verified actors, row locks, same-transaction state+evidence+outbox, and archive retrieval.
-- INSERT privileges alone do not validate legal transitions. This SQL is an evidence
-- store, not a replacement for production authorization or the tested reference core.
-- Rollback before any real evidence: drop schema legal_draft cascade.
-- Once real evidence exists: preserve/export it; disable writes, never destructive drop.
commit;
