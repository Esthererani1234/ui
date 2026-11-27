alter table private.tax_states
  add column ny_dealer_status text,
  add column ny_dealer_confirmed_on date,
  add constraint tax_states_ny_dealer_status check (
    (ny_dealer_status is null and ny_dealer_confirmed_on is null)
    or (state = 'NY' and ny_dealer_status is not null
        and ny_dealer_status in ('registered','registration_not_required','required_unregistered')
        and ny_dealer_confirmed_on is not null)
  );
