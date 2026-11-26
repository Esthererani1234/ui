import {createHash,timingSafeEqual} from 'node:crypto';
import sources from '../../shared/taxSources.json' with {type:'json'};
import {dayNow,rpc} from '../../server/tax/admin.js';
import {json,service} from '../../server/lib/payments.js';
export const maxDuration=60;
export default async function handler(req,res){
  const expected=process.env.CRON_SECRET, token=String(req.headers.authorization||'');
  if(req.method!=='GET' || !expected || !timingSafeEqual(createHash('sha256').update(token).digest(),createHash('sha256').update('Bearer '+expected).digest()))return json(res,401,{error:'Unauthorized'});
  try{
    const db=service(),day=dayNow();await rpc(db,'tax_calendar_refresh',{});await rpc(db,'tax_deadline_scan',{p_day:day});
    const selected=await rpc(db,'tax_monitor_sources',{});
    const links=new Map(sources.map(s=>[s.sources.find(x=>x.purpose==='authority')?.url||s.sources[0]?.url,s.code]).filter(([url])=>url));
    for(const r of selected)links.set(r.source,r.state);
    const tasks=[...links];let unavailable=0;
    for(let i=0;i<tasks.length;i+=14){
      await Promise.all(tasks.slice(i,i+14).map(async([url,state])=>{
        let digest=null;
        try{
          const u=new URL(url);if(u.protocol!=='https:' || !(/\.gov$|\.state\.[a-z]{2}\.us$/.test(u.hostname)))throw Error();
          const response=await fetch(u,{signal:AbortSignal.timeout(4200),redirect:'error'});
          if(!response.ok || Number(response.headers.get('content-length'))>4000000)throw Error();
          const hash=createHash('sha256');let size=0;
          for await(const chunk of response.body){size+=chunk.length;if(size>4000000)throw Error();hash.update(chunk);}
          if(size)digest=hash.digest('hex');
        }catch{unavailable++;}
        await rpc(db,'tax_source_observation',{p_state:state,p_url:url,p_digest:digest,p_day:day});
      }));
    }
    let mailed=0;
    const recipient=process.env.TAX_ADMIN_EMAIL;
    if(recipient && process.env.VERCEL_ENV==='production'){
      const settings=await rpc(db,'get_order_email_secret',{});
      if(settings?.enabled && settings.api_key && settings.from_email){
        const alerts=await rpc(db,'tax_pending_email',{});
        for(const a of alerts){
          const delivery=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(4500),headers:{authorization:'Bearer '+settings.api_key,'content-type':'application/json','Idempotency-Key':'gots-tax-'+createHash('sha256').update(a.event_key).digest('hex')},body:JSON.stringify({from:'Gold On The Spot <'+settings.from_email+'>',to:[recipient],subject:'Tax compliance review'+(a.state?' · '+a.state:''),text:a.message+'\nReview this item in Admin → Sales Tax & Compliance.'})});
          if(!delivery.ok)break;
          await rpc(db,'tax_ack_email',{p_key:a.event_key});mailed++;
        }
      }
    }
    return json(res,200,{checked:tasks.length,unavailable,mailed});
  }catch{return json(res,503,{error:'Tax monitoring did not complete.'});}
}
