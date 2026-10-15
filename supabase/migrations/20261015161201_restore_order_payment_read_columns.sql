-- Restore only payment fields used by customer/admin order lists.
-- Row ownership and SMS/admin policies still apply. Internal notes and
-- terms_ip_hash/terms_user_agent intentionally remain server-only.
grant select (payment_provider, provider_payment_id, provider_checkout_url,
  payment_reference, payment_due_at, paid_at, terms_version, terms_accepted_at)
  on public.orders to authenticated;
