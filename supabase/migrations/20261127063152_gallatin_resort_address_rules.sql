-- Local rate schedules are evidence for a verified district. They do not
-- classify an online sale or assert that the seller must collect resort tax.
insert into private.tax_versions(report_only,state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
values(true,'MT','policy','gallatin_resort_geography',jsonb_build_object(
 'origin','catalog_sale_conditions_2026_11_27','scope','gallatin_resort_geography','county','30031',
 'town_base_ppm',30000,'town_infrastructure_ppm',10000,'rural_ppm',30000,
 'town_source','https://www.townofwestyellowstone.com/resort-tax-information/',
 'rural_source','https://hebgenbasinresorttax.org/',
 'authority_sources',jsonb_build_array('https://www.townofwestyellowstone.com/resort-tax-information/',
 'https://hebgenbasinresorttax.org/',
 'https://services.arcgis.com/iTQUx5ZpNUh47Geb/arcgis/rest/services/Montana_Resort_Areas_and_Communities/FeatureServer/0',
 'https://gisservice.mt.gov/ArcGIS/rest/services/msdi_administrative_boundaries_map_v1/MapServer/51',
 'https://gisservice.mt.gov/ArcGIS/rest/services/msdi_administrative_boundaries_map_v1/MapServer/45',
 'https://services.arcgis.com/iTQUx5ZpNUh47Geb/arcgis/rest/services/Montana_Resort_Areas_and_Communities/FeatureServer/0/query?f=geojson&objectIds=26&outFields=NAME%2CTYPE%2CResort_Tax%2CTax_Rate&outSR=4326&returnGeometry=true',
 'https://gisservice.mt.gov/ArcGIS/rest/services/msdi_administrative_boundaries_map_v1/MapServer/51/query?f=geojson&objectIds=808&outFields=DistrictName%2CDistrictCode%2CNotes&outSR=4326&returnGeometry=true',
 'https://gisservice.mt.gov/ArcGIS/rest/services/msdi_administrative_boundaries_map_v1/MapServer/45/query?f=geojson&objectIds=18500&outFields=DistrictName%2CDistrictCode&outSR=4326&returnGeometry=true')),
 'https://hebgenbasinresorttax.org/wp-content/uploads/2025/09/Second-Reading-HBRRTD-Ordinance-25-01-Final-13.pdf',
 date '2026-11-27',date '2026-12-31',date '2026-11-27','approved');

create or replace function private.tax_report_calculation_inputs(p_order bigint) returns jsonb
stable security definer language plpgsql set search_path='' as $$
declare inputs jsonb; sale public.orders; evidence jsonb; destination text; day date;
begin
 inputs:=private.tax_report_inputs_before_ak_specie(p_order);
 destination:=coalesce(inputs#>>'{regional_destination,state}',inputs->>'state');
 if destination is null or destination not in ('AK','CO','MT') then return inputs;end if;
 select * into strict sale from public.orders where id=p_order;
 if not exists(select from private.tax_report_start where sale.created_at>=starts_at) then return inputs;end if;
 day:=(inputs->>'day')::date;
 if destination='MT' then
   return inputs||jsonb_build_object('mt_gallatin_rule',private.tax_report_version('MT','policy','gallatin_resort_geography',day));
 end if;
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
