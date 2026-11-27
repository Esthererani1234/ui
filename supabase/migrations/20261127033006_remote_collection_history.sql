-- A prior-year-only test can clear the first shipment even when the order is large.
-- Do not infer registration from the absence of sales. Merchant settings take precedence.
with authorities(state,source) as (values
 ('AL','https://www.revenue.alabama.gov/faqs/are-all-remote-sellers-required-to-register-in-alabama/'),
 ('FL','https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx'),
 ('MI','https://www.michigan.gov/taxes/business-taxes/sales-use-tax/information/remote-seller-faq'),
 ('NM','https://www.tax.newmexico.gov/businesses/gross-receipts-overview/'),
 ('RI','https://webserver.rilegislature.gov/statutes/title44/44-18.2/44-18.2-3.HTM')
)
insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
select state,'policy','state',jsonb_build_object('origin','catalog_policy_release_2026_11_26',
 'remote_basis','zero_prior_calendar_year','merchant_footprint_as_of','2026-11-26','first_eligible_cent',0,
 'store_minimum',false),source,date '2026-11-26',date '2026-12-31',date '2026-11-26','approved'
from authorities a where not exists(select from private.tax_versions v
 where v.state=a.state and v.kind='policy' and v.subject='state');

alter function private.tax_collection_gate(text,jsonb,date) rename to tax_before_prior_year_gate;
create function private.tax_collection_gate(s text,p jsonb,d date) returns text
stable language plpgsql set search_path='' as $$
declare profile private.tax_states;
begin
 if p->>'remote_basis' is distinct from 'zero_prior_calendar_year' then
   return private.tax_before_prior_year_gate(s,p,d);
 end if;
 select * into strict profile from private.tax_states where state=s;
 if s not in ('AL','FL','MI','NM','RI') or p->>'state' is distinct from s or
   p->>'origin' is distinct from 'catalog_policy_release_2026_11_26' or
   p->>'approval' is distinct from 'approved' or not coalesce(d between (p->>'valid_from')::date and (p->>'valid_until')::date,false)
   or not coalesce(d between date '2026-11-26' and date '2026-12-31',false)
   or profile.physical or profile.disabled or profile.registration not in ('Not Registered','No Current Obligation')
   or profile.effective is not null or profile.collect_from is not null or profile.active_confirmed_on is not null
   or profile.registration_due is not null then return 'review';
 end if;
 -- The store confirmed that all prior shipments were in NYC. Any contrary record
 -- invalidates this narrow determination. Count both placed and paid orders near year
 -- boundaries conservatively across US time zones, including incomplete addresses.
 if exists(select from public.orders o where
   coalesce(o.shipping_address->>'fulfillment','delivery')<>'pickup' and
   (upper(trim(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}','')))=s or
    not exists(select from private.tax_states known where known.state=upper(trim(coalesce(nullif(o.shipping_address->>'state',''),o.shipping_address#>>'{address,state}','')))))
   and (o.created_at is null or o.created_at < timestamptz '2026-01-01 10:00Z'
      or o.paid_at < timestamptz '2026-01-01 10:00Z'))
   or exists(select from private.tax_ledger l where l.state=s and l.kind='sale'
     and (l.booked<date '2026-01-01' or l.order_id is null)) then return 'review';
 end if;
 return 'no_obligation';
end $$;
revoke all on function private.tax_collection_gate(text,jsonb,date),private.tax_before_prior_year_gate(text,jsonb,date)
from public,anon,authenticated;
-- Order placement holds a shared revision lock. Serialize late historical imports
-- against that same lock before using them to change a collection decision.
create function private.tax_import_changes_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.tax_revision set revision=revision+1;
 return new;
end $$;
revoke all on function private.tax_import_changes_revision() from public,anon,authenticated;
create trigger tax_import_changes_revision before insert on private.tax_ledger for each row
 when (new.order_id is null and new.kind='sale') execute function private.tax_import_changes_revision();

create or replace function public.tax_refund_entry(p_actor uuid,p_state text,p_order bigint,p_reference text,p_date date,p_merchandise bigint,p_taxable bigint,p_exempt bigint,p_components jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare sale private.tax_ledger; used_row record; component jsonb; original jsonb; prior bigint; tax_total bigint:=0;begin
 if not exists(select 1 from public.admin_users where user_id=p_actor) or nullif(trim(p_reference),'') is null or length(p_reference)>120 or p_date is null or
 p_merchandise is null or p_taxable is null or p_exempt is null or least(p_merchandise,p_taxable,p_exempt)<0 or p_taxable+p_exempt>p_merchandise or jsonb_typeof(p_components) is distinct from 'array' then raise exception 'Invalid refund evidence';end if;
 select * into strict sale from private.tax_ledger where state=p_state and order_id=p_order and kind='sale' for update;
 if p_date<sale.booked or p_date>current_date then raise exception 'Invalid refund date';end if;
 select -coalesce(sum(merchandise-taxable-exempt),0) unclassified,-coalesce(sum(taxable),0) taxable,-coalesce(sum(exempt),0) exempt into used_row from private.tax_ledger where order_id=p_order and kind='refund';
 if sale.taxable is null or sale.exempt is null or
    p_merchandise-p_taxable-p_exempt+used_row.unclassified>sale.merchandise-sale.taxable-sale.exempt or
    p_taxable+used_row.taxable>sale.taxable or p_exempt+used_row.exempt>sale.exempt then raise exception 'Refund exceeds remaining merchandise';end if;
 if exists(select 1 from jsonb_array_elements(p_components) c group by c->>'code' having count(*)>1) then raise exception 'Duplicate jurisdiction';end if;
 for component in select * from jsonb_array_elements(p_components) loop
 select c into strict original from jsonb_array_elements(sale.breakdown) c where c->>'code'=component->>'code';
 select -coalesce(sum((b->>'cents')::bigint),0) into prior from private.tax_ledger l cross join lateral jsonb_array_elements(l.breakdown) b where l.order_id=p_order and l.kind='refund' and b->>'code'=component->>'code';
 if component->>'cents' is null or (component->>'cents')::bigint<0 or (component->>'cents')::bigint+prior>(original->>'cents')::bigint then raise exception 'Refund exceeds original jurisdiction tax';end if;
 tax_total:=tax_total+(component->>'cents')::bigint;
 end loop;
 insert into private.tax_ledger(event_key,state,order_id,booked,kind,merchandise,taxable,exempt,tax,confirmation,breakdown)
 values('refund:'||p_order||':'||p_reference,p_state,p_order,p_date,'refund',-p_merchandise,-p_taxable,-p_exempt,-tax_total,p_reference,
 coalesce((select jsonb_agg(o||jsonb_build_object('cents',-(c->>'cents')::bigint)) from jsonb_array_elements(p_components)c join jsonb_array_elements(sale.breakdown)o on o->>'code'=c->>'code'),'[]'));
 insert into private.tax_audit(actor,action,state,details) values(p_actor,'confirmed_refund',p_state,jsonb_build_object('order_id',p_order,'reference',p_reference));
end $$;

create or replace function private.tax_threshold_progress(s text,d date) returns jsonb stable language plpgsql set search_path='' as $$
declare rule jsonb:=private.tax_version(s,'nexus','state',d); periods daterange[]; span daterange;
 yr date:=date_trunc('year',d)::date; quarter_start date; amount bigint;n bigint; revenue_target bigint;count_target bigint;
 revenue_pct numeric;count_pct numeric;pct numeric;highest numeric:=0;hit boolean:=false; amounts jsonb:='[]';begin
 if rule is null or rule->>'approval'<>'approved' or (rule->>'valid_until')::date<d then return null;end if;
 revenue_target:=(rule->>'revenue_trigger_cents')::bigint;count_target:=(rule->>'transaction_trigger')::bigint;
 if rule->>'period'='current_or_prior_calendar' then periods:=array[daterange(yr,d+1),daterange((yr-interval '1 year')::date,yr)];
 elsif rule->>'period'='rolling_12_months' then periods:=array[daterange(((d+1)-interval '12 months')::date,d+1)];
 elsif rule->>'period'='ny_four_completed_quarters' then quarter_start:=(date_trunc('quarter',d+interval '1 month')-interval '1 month')::date;periods:=array[daterange((quarter_start-interval '1 year')::date,quarter_start)];
 else return null;end if;
 foreach span in array periods loop
 -- A taxable-sales determination requires all included sales to be classified.
 if rule->>'base'='taxable' and exists(select from private.tax_ledger
   where state=s and booked <@ span and (kind='sale' or (kind='refund' and rule->>'deduct_refunds'='true'))
   and (channel<>'marketplace' or rule->>'include_marketplace'='true')
   and merchandise is distinct from taxable+exempt) then return null; end if;
 select coalesce(sum(case when rule->>'base'='taxable' then taxable else merchandise end),0),count(*) filter(where kind='sale') into amount,n from private.tax_ledger
 where state=s and booked <@ span and (kind='sale' or (kind='refund' and rule->>'deduct_refunds'='true')) and (channel<>'marketplace' or rule->>'include_marketplace'='true');
 revenue_pct:=100.0*amount/nullif(revenue_target,0);count_pct:=100.0*n/nullif(count_target,0);
 pct:=case when rule->>'operator'='and' then least(revenue_pct,count_pct) else greatest(revenue_pct,count_pct) end;
 highest:=greatest(highest,pct);hit:=hit or pct>=100;
 amounts:=amounts||jsonb_build_array(jsonb_build_object('from',lower(span),'to',upper(span)-1,'sales_cents',amount,'transactions',n));
 end loop;
 return jsonb_build_object('version',rule->'version','percentage',round(highest,2),'reached',hit,'periods',amounts,'revenue_trigger_cents',revenue_target,'transaction_trigger',count_target);
end $$;

update private.tax_revision set revision=revision+1;
