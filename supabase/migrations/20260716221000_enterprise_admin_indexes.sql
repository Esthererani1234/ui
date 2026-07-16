create index if not exists customer_risk_updated_by_idx
  on public.customer_risk_profiles (updated_by)
  where updated_by is not null;

create index if not exists order_risk_reviewed_by_idx
  on public.order_risk_reviews (reviewed_by)
  where reviewed_by is not null;

create index if not exists admin_audit_actor_idx
  on public.admin_audit_log (actor_user_id, created_at desc)
  where actor_user_id is not null;
