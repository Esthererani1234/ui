-- Reserve and read in one statement, including a race with account deletion.
-- The conflict update changes no ownership; it only locks and returns the claim.
create or replace function private.claim_verified_customer_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_users uuid[];
begin
  if new.phone_verified_at is null then return new; end if;
  v_phone := private.normalized_customer_phone(new.phone);
  if v_phone is null then raise exception 'Invalid verified mobile number' using errcode='22023'; end if;
  -- The unique primary key arbitrates simultaneous claims. A prior "available"
  -- response is advisory; it never permits two accounts to win verification.
  insert into private.customer_phone_claims(phone,user_ids)
    values(v_phone,array[new.id])
    on conflict(phone) do update set phone=excluded.phone
    returning user_ids into v_users;
  if not (new.id = any(v_users)) then
    raise exception 'Mobile number already registered' using errcode='P2001';
  end if;
  -- Hold the old number during an unfinished change. Release it only after
  -- another number is successfully verified. Preserve any legacy co-owners.
  delete from private.customer_phone_claims where phone<>v_phone and user_ids=array[new.id];
  update private.customer_phone_claims set user_ids=array_remove(user_ids,new.id)
    where phone<>v_phone and new.id=any(user_ids);
  return new;
end $$;
