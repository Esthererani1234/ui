-- The account history and detail queries both include this customer-facing timestamp.
-- Existing order row policies and column write restrictions remain in force.
GRANT SELECT (pickup_ready_at) ON TABLE public.orders TO authenticated;
