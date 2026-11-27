-- Private merchant settings. This migration does not install order or payment functions.
create schema if not exists private;
create table private.tax_states (
 state text primary key check(state ~ '^[A-Z]{2}$'), physical boolean not null default false,
 disabled boolean not null default false, registration text not null default 'Requires Legal Review',
 effective date, active_confirmed_on date, frequency text, registration_due date, collect_from date, note text not null default ''
);
insert into private.tax_states(state,physical) select s,s='NY' from unnest(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' ')) s;
alter table private.tax_states enable row level security;
revoke all on private.tax_states from public, anon, authenticated;
