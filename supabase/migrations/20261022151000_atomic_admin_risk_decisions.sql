-- Risk decisions and their audit records must commit together.
create function public.admin_review_order(
  p_actor_user_id uuid, p_order_id bigint, p_decision text, p_reason text,
  p_admin_notes text, p_expected_decision text, p_expected_reviewed_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_review public.order_risk_reviews%rowtype; v_previous text;
begin
  if not exists(select 1 from public.admin_users where user_id=p_actor_user_id) then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('pending','approved','rejected')
    or p_expected_decision is null or p_expected_decision not in ('pending','approved','rejected')
    or length(trim(coalesce(p_reason,'')))<3 or length(p_reason)>1000 or length(coalesce(p_admin_notes,''))>5000 then
    raise exception 'Invalid risk decision' using errcode='22023'; end if;
  -- Same lock order as fulfillment updates: no shipment can race rejection.
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P2002'; end if;
  select * into v_review from public.order_risk_reviews where order_id=p_order_id for update;
  if not found then raise exception 'Risk review not found' using errcode='P2002'; end if;
  if v_review.decision is distinct from p_expected_decision or v_review.reviewed_at is distinct from p_expected_reviewed_at then
    raise exception 'This review has changed. Refresh before deciding.' using errcode='P2003'; end if;
  if v_order.status in ('cancelled','shipped','completed') or (v_order.status='processing' and p_decision<>'approved') then
    raise exception 'This order has already entered fulfillment or closed. Review its order details.' using errcode='P2004'; end if;
  v_previous:=v_review.decision;
  update public.order_risk_reviews set decision=p_decision,admin_notes=nullif(trim(p_admin_notes),''),
    reviewed_by=p_actor_user_id,reviewed_at=clock_timestamp(),updated_at=now()
    where order_id=p_order_id returning * into v_review;
  insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,reason,metadata)
    values(p_actor_user_id,'order.risk_reviewed','order',p_order_id::text,trim(p_reason),
      jsonb_build_object('previous_decision',v_previous,'decision',p_decision,'result','success','order_number',v_order.order_number));
  return jsonb_build_object('success',true,'review',to_jsonb(v_review));
end $$;
revoke all on function public.admin_review_order(uuid,bigint,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_review_order(uuid,bigint,text,text,text,text,timestamptz) to service_role;
revoke all on public.order_risk_reviews from anon,authenticated;
grant select on public.order_risk_reviews to authenticated;
drop policy if exists "admins update order risk" on public.order_risk_reviews;
-- Existing admin-only SELECT policy remains. No order/payment rows are changed.
