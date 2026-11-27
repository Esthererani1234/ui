-- Product determinations for the November catalog. Separate policies govern collection,
-- local bases, rates and fees. An older catalog decision is never copied as tax law.
lock table private.tax_versions in share row exclusive mode;
with authorities(state, scope, source) as (values
 ('DC','taxable_bars','https://code.dccouncil.gov/us/dc/council/code/sections/47-2002'),
 ('HI','taxable_bars','https://tax.hawaii.gov/get/'),
 ('ME','taxable_bars','https://www.mainelegislature.org/legis/statutes/36/title36sec1811.html'),
 ('NM','taxable_bars','https://www.tax.newmexico.gov/businesses/gross-receipts-overview/'),
 ('VT','taxable_bars','https://legislature.vermont.gov/statutes/section/32/233/09771'),
 ('IA','catalog','https://www.legis.iowa.gov/DOCS/ACO/IC/LINC/Chapter.423.pdf'),
 ('KS','catalog','https://www.ksrevenue.gov/taxnotices/notice19-02.pdf'),
 ('NE','catalog','https://www.nebraskalegislature.gov/laws/statutes.php?statute=77-2704.66'),
 ('SC','catalog','https://rfa.sc.gov/index.php/sales_exemp_report'),
 ('SD','catalog','https://dor.sd.gov/media/q34fhrne/financial-institutions.pdf'),
 ('IL','coins','https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxinformation/sales/documents/pio-101-illinois-tax-matrix.pdf'),
 ('ND','coins','https://www.tax.nd.gov/sites/www/files/documents/guidelines/business/sales-use/guideline-exemptions.pdf'),
 ('OH','coins','https://codes.ohio.gov/ohio-revised-code/section-5739.02'),
 ('UT','coins','https://le.utah.gov/xcode/Title59/Chapter12/59-12-S104.html?v=C59-12-S104_2026050620260701'),
 ('WY','coins','https://wyoleg.gov/statutes/compress/title09.pdf'),
 ('FL','us_coins','https://floridarevenue.com/rules/pdf/12A-1_rp_finaltext_eff_010124.pdf')
), listings as (
 select p.id, p.sku, p.name, p.metal, p.metal_weight_oz, v.data->>'form' as form
 from public.products p
 join private.tax_versions v on v.state='NY' and v.kind='product' and v.subject=p.id::text
  and v.data->>'origin'='catalog_policy_release_2026_11_26' and v.actor is null and v.valid_from=date '2026-11-26'
  and (p.sku,p.name,p.metal::text,p.metal_weight_oz)=(v.data->>'catalog_sku',v.data->>'catalog_name',v.data->>'metal',(v.data->>'catalog_weight')::numeric)
 where p.is_active and p.sku in ('AGE-1OZ-BU-RY','GOTS-GBP-1OZ-RY-001','MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY',
 'APMEX-1OZ-TEP','GOTS-834790','PAMP-1OZ-FORTUNA-ASSAY','RAND-0033')
), published as (
 insert into private.tax_versions(state,kind,subject,data,source,valid_from,valid_until,verified_on,approval)
 select a.state,'product',p.id::text,jsonb_build_object('origin','catalog_policy_release_2026_11_26','catalog_sku',p.sku,
 'catalog_name',p.name,'metal',p.metal,'catalog_weight',p.metal_weight_oz,'form',p.form,'treatment',case when a.scope='taxable_bars' then 'taxable' else 'eligible' end),
 a.source,date '2026-11-26',date '2026-12-31',date '2026-11-26','approved'
 from listings p cross join authorities a
 where (a.scope='catalog' or (a.scope='taxable_bars' and p.form='bar') or (a.scope='coins' and p.form='coin') or
       (a.scope='us_coins' and p.sku in ('AGE-1OZ-BU-RY','GOTS-GBP-1OZ-RY-001')))
 and not exists (select from private.tax_versions previous where previous.state=a.state and previous.kind='product'
   and previous.subject=p.id::text and previous.valid_until>=date '2026-11-26')
 returning id
)
update private.tax_revision set revision=revision+1 where exists(select from published);
