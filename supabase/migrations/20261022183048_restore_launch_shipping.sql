-- End the owner's temporary free-shipping test. Existing orders and their
-- locked totals remain unchanged. Only restore the known testing value.
with changed as (
 update public.app_settings set value='35'::jsonb
 where key='shipping_flat' and value='0'::jsonb returning key
)
insert into public.admin_audit_log(action,target_type,target_id,reason,metadata)
select 'launch_shipping_restored','app_settings',key,
 'Owner requested completion of launch checklist, including ending temporary free shipping',
 jsonb_build_object('previous',0,'new',35,'source','deployment_migration') from changed;
