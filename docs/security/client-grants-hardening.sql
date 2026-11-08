-- Pending approval. Preserve RLS, reads and service-role writes.
-- Customer/admin UI mutations already use authorized server operations.
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 ON public.orders, public.admin_users FROM PUBLIC, anon, authenticated;
COMMIT;
