import crypto from 'node:crypto';
import { json, readJson, requireAdmin, service } from '../../server/lib/payments.js';
import { rateLimit, strictObject, securityLog } from '../../server/lib/security.js';
import { SUPPORT_EMAIL_EVENTS, renderSupportEmail } from '../../supabase/functions/_shared/supportEmail.js';
import { EMAIL_EVENTS, renderOrderEmail, sampleOrder } from '../../supabase/functions/_shared/orderEmail.js';
import { sendOrderEmail } from '../../supabase/functions/_shared/orderEmailDelivery.js';
export const config={api:{bodyParser:false}};
const invalid=message=>Object.assign(new Error(message),{status:400});
export default async function handler(request,response) {
 if(!['GET','POST'].includes(request.method)) return json(response,405,{error:'Method not allowed'});
 try {
  const actor=await requireAdmin(request);
  const db=service();
  await rateLimit(db,request.method==='GET'?'order_email_admin_read':'order_email_admin_send',actor.id,request.method==='GET'?60:5,600);
  const {data:saved,error}=await db.rpc('get_order_email_secret');
  if(error) throw error;
  if(request.method==='GET') {
   const {data:recent,error:queueError}=await db.from('order_email_outbox').select('id,event_type,status,attempts,last_error,created_at,sent_at,order_snapshot').order('created_at',{ascending:false}).limit(20);
   if(queueError) throw queueError;
   return json(response,200,{configured:Boolean(saved?.api_key),enabled:saved?.enabled===true,from_email:saved?.from_email || 'orders@goldonthespot.com',reply_to:saved?.reply_to || 'support@goldonthespot.com',key_last4:saved?.api_key?.slice(-4) || '',tested_at:saved?.tested_at || null,
    recent:(recent || []).map(({order_snapshot,...row})=>({...row,order_number:order_snapshot?.order_number || order_snapshot?.ticket_number})),events:Object.entries({...EMAIL_EVENTS,...SUPPORT_EMAIL_EVENTS}).map(([value,[label]])=>({value,label}))});
  }
  const body=strictObject(await readJson(request),['action','api_key','from_email','reply_to','reason','event']);
  if(!['connect','pause','test'].includes(body.action)) throw invalid('Choose a valid email action.');
  const reason=String(body.reason || '').trim();
  if(body.action!=='test' && (reason.length<3 || reason.length>1000)) throw invalid('Enter a short reason for this change.');
  if(body.action==='pause') {
   if(!saved?.api_key) throw invalid('Connect an email sender first.');
   const {error:saveError}=await db.rpc('configure_order_email',{p_actor:actor.id,p_settings:{...saved,enabled:false},p_reason:reason});
   if(saveError) throw saveError;
   return json(response,200,{success:true,message:'Order and support emails paused. Account verification emails are unchanged.'});
  }
  const settings=body.action==='test'?saved:{api_key:String(body.api_key || saved?.api_key || '').trim(),from_email:String(body.from_email || '').trim().toLowerCase(),reply_to:String(body.reply_to || '').trim().toLowerCase(),enabled:true,tested_at:new Date().toISOString()};
  if(!settings || !/^re_[A-Za-z0-9_-]{10,200}$/.test(settings.api_key || '')) throw invalid('Enter a Resend API key with permission to send from your verified domain.');
  if(!/^[a-z0-9._%+-]+@goldonthespot\.com$/.test(settings.from_email || '') || !/^[a-z0-9._%+-]+@goldonthespot\.com$/.test(settings.reply_to || '')) throw invalid('Use verified goldonthespot.com sender and reply-to addresses.');
  const event=body.event || 'paid';
  if(!Object.hasOwn(EMAIL_EVENTS,event) && !Object.hasOwn(SUPPORT_EMAIL_EVENTS,event)) throw invalid('Choose a valid sample email.');
  if(!actor.email || !actor.email_confirmed_at) throw invalid('Your admin email must be verified before sending a sample.');
  const sample=Object.hasOwn(SUPPORT_EMAIL_EVENTS,event)?renderSupportEmail({event,ticket:{ticket_number:'SUP-PREVIEW',status:'resolved'}}):renderOrderEmail({event,...sampleOrder()});
  // Only an explicit admin button can send a sample, only to that admin's verified email.
  try {
   await sendOrderEmail(settings,{from:`Gold On The Spot <${settings.from_email}>`,reply_to:settings.reply_to,to:[actor.email],...sample,subject:`[PREVIEW] ${sample.subject}`},`gots-admin-preview-${crypto.randomUUID()}`);
  } catch {throw Object.assign(new Error('The email provider did not accept the sample. Check the API key, sending permission, and verified sender domain.'),{status:502});}
  if(body.action==='connect') {
   const {error:saveError}=await db.rpc('configure_order_email',{p_actor:actor.id,p_settings:settings,p_reason:reason});
   if(saveError) throw saveError;
  } else {
   const {error:auditError}=await db.from('admin_audit_log').insert({actor_user_id:actor.id,action:'order_emails.sample_sent',target_type:'email_settings',target_id:'order_email_provider',reason:'Admin requested a sample to their verified email',metadata:{event}});
   if(auditError) throw auditError;
  }
  return json(response,200,{success:true,message:body.action==='connect'?'Sample accepted by the email provider. Automatic order and support emails are now enabled.':'Sample accepted by the email provider. Check your admin inbox.'});
 } catch(error) {
  securityLog('order_email_admin_failed',error);
  return json(response,[400,401,403,429,502,503].includes(error.status)?error.status:500,{error:error.status?error.message:'Order email settings are temporarily unavailable.'});
 }
}
