create index if not exists secure_payment_settings_updated_by_idx
  on public.secure_payment_settings(updated_by)
  where updated_by is not null;
