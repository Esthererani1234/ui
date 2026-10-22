import { renderOrderEmail } from './orderEmail.js';
import { renderSupportEmail } from './supportEmail.js';

export async function sendOrderEmail(settings, message, key, fetcher = fetch) {
  const response = await fetcher('https://api.resend.com/emails', {
    method:'POST', headers:{authorization:`Bearer ${settings.api_key}`,'content-type':'application/json','Idempotency-Key':key},
    body:JSON.stringify(message), signal:AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.id) {
    const retryable = response.status===429 || response.status>=500 || (response.status===409 && data.name==='concurrent_idempotent_requests');
    throw Object.assign(new Error('Email provider did not accept the request'), {code:`provider_${response.status}`,retryable});
  }
  return String(data.id);
}
export async function deliverOrderEmails(db, settings, {send=sendOrderEmail, pause=ms=>new Promise(r=>setTimeout(r,ms))} = {}) {
  if (!settings?.enabled || !settings?.api_key) return {enabled:false,sent:0,failed:0};
  const {data:jobs,error} = await db.rpc('claim_order_emails',{p_limit:4});
  if (error) throw new Error('Email queue unavailable');
  let sent=0,failed=0;
  for (const job of jobs || []) {
    // Credentials and provider response bodies are never logged or persisted here.
    try {
      let message=job.message;
      if (!message) {
        message={from:`Gold On The Spot <${settings.from_email}>`,to:[job.recipient],reply_to:settings.reply_to,
          ...(job.ticket_id ? renderSupportEmail({event:job.event_type,ticket:job.order_snapshot}) : renderOrderEmail({event:job.event_type,order:job.order_snapshot,items:job.items_snapshot || []}))};
        const {data:saved,error:saveError}=await db.from('order_email_outbox').update({message})
          .eq('id',job.id).eq('lease_id',job.lease_id).eq('status','sending').is('message',null).select('id').maybeSingle();
        if (saveError || !saved) throw Object.assign(new Error('Email payload could not be saved'),{code:'payload_save_failed'});
      }
      const providerId=await send(settings,message,`gots-order-${job.id}`);
      const {data:acked,error:ackError}=await db.from('order_email_outbox').update({status:'sent',sent_at:new Date().toISOString(),provider_id:providerId,last_error:null,lease_until:null})
        .eq('id',job.id).eq('lease_id',job.lease_id).eq('status','sending').select('id').maybeSingle();
      if (ackError || !acked) throw Object.assign(new Error('Email acknowledgement failed'),{code:'ack_failed'});
      sent++;
    } catch (error) {
      const retry=error.retryable!==false && job.attempts<10;
      const code=/^[a-z0-9_]{1,60}$/.test(error.code || '') ? error.code : 'delivery_unavailable';
      const {error:saveError}=await db.from('order_email_outbox').update({status:retry?'pending':'failed',last_error:code,lease_until:null,
        available_at:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString()})
        .eq('id',job.id).eq('lease_id',job.lease_id).eq('status','sending');
      if (saveError) console.error('order_email_retry_save_failed');
      failed++;
    }
    // Stay below the provider's default two requests/second limit.
    await pause(600);
  }
  return {enabled:true,sent,failed};
}
