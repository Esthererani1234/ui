-- Keep the receipts returned by checkout, idempotent retries and queued emails
-- tied to the tax amount on the order. Preserve existing permissions and consent logic.
do $$
declare
  routine record;
  definition text;
  total_field constant text := '''total'',o.total';
  receipt_fields constant text := '''tax_amount'',o.tax_amount,''total'',o.total';
begin
  for routine in select * from (values
    ('public.place_checkout_order(uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,text,text)'::regprocedure, 1),
    ('public.accept_wire_order(bigint,uuid,jsonb,text,text)'::regprocedure, 2),
    ('private.enqueue_order_milestone(public.orders,text,text)'::regprocedure, 1)
  ) as targets(signature, expected_count) loop
    definition := pg_get_functiondef(routine.signature);
    if array_length(string_to_array(definition,total_field),1)-1 <> routine.expected_count then
      raise exception 'Unexpected checkout receipt definition for %', routine.signature;
    end if;
    execute replace(definition,total_field,receipt_fields);
  end loop;
end $$;
