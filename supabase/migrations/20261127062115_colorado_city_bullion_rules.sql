-- Municipal rules describe this layer only. The statewide policy, special
-- districts, actual merchandise and the seller's obligation remain independent.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select true,'CO','policy','municipality_'||g.geoid,
 jsonb_strip_nulls(jsonb_build_object('origin','catalog_sale_conditions_2026_11_27',
   'scope',g.scope,'place_geoid',g.geoid,'place_name',g.city,'counties',g.counties,
   'municipal_ppm',g.ppm,'shipping',g.shipping,'law_effective',g.effective,
   'rate_source',g.rate_source,'authority_sources',to_jsonb(array_remove(array[g.rate_source,g.confirming_source],null)))),
 g.source,date '2026-11-27',date '2026-12-31',date '2026-11-27','approved'
from (values
 ('0803455','Arvada city','{"08001":"Adams County","08059":"Jefferson County"}'::jsonb,
   'municipal_bullion_tax',34600,'included',null,
   'https://www.arvadaco.gov/308/Coins-Currency-Precious-Metals',
   'https://www.arvadaco.gov/243/Sales-Tax-Information',null),
 ('0862000','Pueblo city','{"08101":"Pueblo County"}'::jsonb,
   'municipal_bullion_tax',37000,null,null,
   'https://www.pueblo.us/DocumentCenter/View/22099/Coins-Currency-and-Precious-Metals',
   'https://www.pueblo.us/180/Sales-Tax-Division','https://www.pueblo.us/ArchiveCenter/ViewFile/Item/5351'),
 ('0841835','Lafayette city','{"08013":"Boulder County"}'::jsonb,
   'municipal_bullion_exemption',null,null,'2025-01-01',
   'https://www.lafayetteco.gov/DocumentCenter/View/42640/Ordinance-2024-22-PDF?bidId=',
   null,'https://www.lafayetteco.gov/3861/Sales-Tax-Information-Imposition-and-Exe')
) g(geoid,city,counties,scope,ppm,shipping,effective,source,rate_source,confirming_source);

create function private.tax_co_municipal_rules(d date) returns jsonb stable language sql set search_path='' as $$
 with places as (
   select distinct v.subject from private.tax_versions v where v.state='CO' and v.report_only and v.kind='policy'
   and v.subject ~ '^municipality_[0-9]{7}$' and v.valid_from<=d
 ), rules as (
   select private.tax_report_version('CO','policy',p.subject,d) as rule from places p
 )
 select coalesce(jsonb_object_agg(rule->>'place_geoid',rule),'{}')
 from rules where rule->>'approval'='approved' and (rule->>'verified_on')::date<=d
   and d between (rule->>'valid_from')::date and (rule->>'valid_until')::date
$$;
revoke all on function private.tax_co_municipal_rules(date) from public,anon,authenticated;

create or replace function private.tax_report_calculation_inputs(p_order bigint) returns jsonb
stable security definer language plpgsql set search_path='' as $$
declare inputs jsonb; sale public.orders; evidence jsonb; destination text; day date;
begin
 inputs:=private.tax_report_inputs_before_ak_specie(p_order);
 destination:=coalesce(inputs#>>'{regional_destination,state}',inputs->>'state');
 if destination is null or destination not in ('AK','CO') then return inputs;end if;
 select * into strict sale from public.orders where id=p_order;
 if not exists(select from private.tax_report_start where sale.created_at>=starts_at) then return inputs;end if;
 day:=(inputs->>'day')::date;
 if destination='CO' then
   return inputs||jsonb_build_object('co_city_rules',private.tax_co_municipal_rules(day));
 end if;
 inputs:=inputs||jsonb_build_object('anchorage_policy',private.tax_report_version('AK','policy','anchorage_retail',day));
 evidence:=private.tax_ak_specie_sale(sale,day);
 if evidence is not null then return inputs||jsonb_build_object('ak_specie',evidence);end if;
 return inputs;
end $$;
revoke all on function private.tax_report_calculation_inputs(bigint) from public,anon,authenticated;
update private.tax_revision set revision=revision+1;
