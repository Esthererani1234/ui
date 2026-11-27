-- The statewide protection applies to the metal component, including in home-rule
-- cities and boroughs. Local treatment of any additional consideration is separate.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
values (true,'AK','policy','specie_value',jsonb_build_object('origin','catalog_sale_conditions_2026_11_27',
 'scope','intrinsic_metal_value','law_effective','2026-08-28',
 'authority_sources',jsonb_build_array('https://www.usmint.gov/coins-precious-metal-coins/bullion-coin-programs/',
   'https://www.mint.ca/globalassets/invest/get-into-bullion/guide-to-buying-gold-silver-platinum-bullion.pdf')),
 'https://www.akleg.gov/PDF/34/Bills/HB0001Z.PDF','2026-11-27','2026-12-31','2026-11-27','approved');

insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
values (true,'AK','policy','anchorage_retail',jsonb_build_object('origin','catalog_sale_conditions_2026_11_27',
 'scope','no_general_retail_tax','county_geoid','02020','authority_sources',jsonb_build_array(
 'https://arsstc.org/business-sellers/member-jurisdictions/',
 'https://www.muni.org/departments/assembly/priorities/budget_and_taxes/tax_reform_proposals.php')),
 'https://www.muni.org/departments/finance/treasury/program_taxes_other_taxes_surcharge/statistics.php',
 '2026-11-27','2026-11-30','2026-11-27','approved');

create function private.tax_ak_specie_sale(o public.orders,d date) returns jsonb
stable language sql set search_path='' as $$
 with policy as (
   select private.tax_report_version('AK','policy','specie_value',d) as law
 ), items as (
   select i.*,e.subject,case when jsonb_typeof(i.pricing_snapshot->'spot')='number' then (i.pricing_snapshot->>'spot')::numeric end as spot,
     case when jsonb_typeof(i.pricing_snapshot->'premium_fixed')='number' then (i.pricing_snapshot->>'premium_fixed')::numeric end as fixed,
     case when jsonb_typeof(i.pricing_snapshot->'premium_percent')='number' then (i.pricing_snapshot->>'premium_percent')::numeric end as pct
   from public.order_items i left join private.tax_bullion_review_examples e
     on (i.product_id::text,i.sku,i.product_name,i.metal::text,i.metal_weight_oz)=(e.subject,e.sku,e.title,e.metal,e.weight)
   where i.order_id=o.id
 ), components as (
   select i.*,case when subject is not null and sku in ('AGE-1OZ-BU-RY','MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY')
       and metal_weight_oz=1 and pricing_snapshot->>'price_mode'='dynamic' and spot>0 and spot=round(spot,2)
       and unit_price>0 and unit_price<2*spot and quantity>0 and line_total=unit_price*quantity
       and unit_price=round(spot*(1+pct/100)+fixed,2)
       then least(spot,unit_price)*quantity*100 end as metal_cents
   from items i
 ), purchase as (
   select count(*) as n,sum(line_total) as priced,
     count(metal_cents)=count(*) as all_verified,sum(metal_cents) as protected,
     sum(line_total*100-metal_cents) as premium,
     jsonb_agg(jsonb_build_object('id',product_id,'quantity',quantity,'locked_spot',spot,'net',line_total*100,
       'specification_source',case when sku='AGE-1OZ-BU-RY' then law#>>'{authority_sources,0}'
         else law#>>'{authority_sources,1}' end,
       'metal_price_cents',metal_cents,'markup_cents',line_total*100-metal_cents) order by product_id) as lines
   from components cross join policy
 )
 select case when n>0 and all_verified and priced=o.subtotal then
   jsonb_build_object('scope','intrinsic_metal_value','law',law->>'source','version',law->'version',
   'metal_price_cents',protected,'markup_cents',premium,'lines',lines,'valuation','original_locked_spot')
 else jsonb_build_object('scope','intrinsic_metal_value','law',law->>'source','version',law->'version') end
 from purchase cross join policy
 where law->>'approval'='approved' and d between (law->>'valid_from')::date and (law->>'valid_until')::date
 and (law->>'verified_on')::date<=d and d=(o.created_at at time zone 'America/New_York')::date
 and exists(select from private.tax_report_start where o.created_at>=starts_at)
 and private.tax_admin_state(coalesce(o.shipping_address#>>'{address,state}',o.shipping_address->>'state'))='AK'
 and coalesce(o.shipping_address->>'fulfillment','delivery')<>'pickup' and coalesce(trim(o.customer_notes),'')=''
$$;
revoke all on function private.tax_ak_specie_sale(public.orders,date) from public,anon,authenticated;

alter function private.tax_report_calculation_inputs(bigint) rename to tax_report_inputs_before_ak_specie;
create function private.tax_report_calculation_inputs(p_order bigint) returns jsonb
stable security definer language plpgsql set search_path='' as $$
declare inputs jsonb; sale public.orders; evidence jsonb;
begin
 inputs:=private.tax_report_inputs_before_ak_specie(p_order);
 if coalesce(inputs#>>'{regional_destination,state}',inputs->>'state') is distinct from 'AK' then return inputs;end if;
 select * into strict sale from public.orders where id=p_order;
 if not exists(select from private.tax_report_start where sale.created_at>=starts_at) then return inputs;end if;
 inputs:=inputs||jsonb_build_object('anchorage_policy',private.tax_report_version('AK','policy','anchorage_retail',(inputs->>'day')::date));
 evidence:=private.tax_ak_specie_sale(sale,(inputs->>'day')::date);
 if evidence is not null then return inputs||jsonb_build_object('ak_specie',evidence);end if;
 return inputs;
end $$;
revoke all on function private.tax_report_calculation_inputs(bigint) from public,anon,authenticated;
update private.tax_revision set revision=revision+1;
