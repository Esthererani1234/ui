const fail = (message='Pickup tax could not be verified. Please try later.') => Object.assign(new Error(message),{status:409});
export async function pickupTotal(db,uid,id,env=process.env,fetcher=fetch){
 if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw fail();
 const {data:q,error}=await db.from('checkout_quotes').select('subtotal,line_items,status,expires_at').eq('user_id',uid).eq('id',id).maybeSingle();
 if(error||!q||q.status!=='active'||Date.parse(q.expires_at)<=Date.now())throw fail('This price lock is no longer active.');
 const codes=JSON.parse(env.PICKUP_STRIPE_TAX_CODES||'{}');
 if(!env.STRIPE_SECRET_KEY||!q.line_items.length)throw fail();
 const body=new URLSearchParams({currency:'usd','expand[]':'line_items','customer_details[address_source]':'shipping'});
 const office={line1:'149 Madison Avenue',line2:'Floor 6, Room 614',city:'New York',state:'NY',postal_code:'10016',country:'US'};
 for(const [k,v] of Object.entries(office))for(const who of ['customer_details','ship_from_details'])body.set(who+'[address]['+k+']',v);
 let sum=0;
 q.line_items.forEach((l,i)=>{const amount=Math.round(Number(l.line_total)*100),code=codes[l.sku];
 if(!Number.isSafeInteger(amount)||amount<=0||!/^txcd_[0-9]{8}$/.test(code||''))throw fail('Pickup is unavailable for an item in your cart until its tax classification is verified.');
 sum+=amount;for(const [k,v] of Object.entries({amount,quantity:l.quantity,reference:String(i),tax_code:code,tax_behavior:'exclusive'}))body.set('line_items['+i+']['+k+']',String(v))});
 if(sum!==Math.round(Number(q.subtotal)*100))throw fail('Discounted pickup totals require review. Remove the promo or choose delivery.');
 const res=await fetcher('https://api.stripe.com/v1/tax/calculations',{method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Idempotency-Key':'pickup-tax-v1-'+id},body,signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw fail();const c=await res.json();
 if(!Number.isSafeInteger(c.tax_amount_exclusive)||c.tax_amount_exclusive<0||c.amount_total!==sum+c.tax_amount_exclusive||!c.tax_breakdown?.length||c.tax_breakdown.some(t=>!['standard_rated','reduced_rated','product_exempt','zero_rated'].includes(t.taxability_reason)))throw fail();
 const {data,error:e}=await db.rpc('record_pickup_calculation',{qid:id,uid,ref:c.id,tax_cents:c.tax_amount_exclusive,subtotal_cents:sum});if(e)throw fail();return data;
}