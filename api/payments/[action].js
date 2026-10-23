import {json} from '../../server/lib/payments.js';
import {previewPaymentsAllowed,PRODUCTION_DATABASE_HOST} from '../../shared/deploymentSafety.js';
import {reportRuntimeSecurityOnce} from '../../server/lib/nodeRuntimeSecurity.js';

// One Vercel function, fixed routing table. Preserve raw webhook bytes.
export const config={api:{bodyParser:false}};
const routes={
 'config':()=>import('../../server/payments/config.js'),
 'confirm-card':()=>import('../../server/payments/confirm-card.js'),
 'complete-card':()=>import('../../server/payments/complete-card.js'),
 'create-checkout':()=>import('../../server/payments/create-checkout.js'),
 'change-method':()=>import('../../server/payments/change-method.js'),
 'stripe-webhook':()=>import('../../server/payments/stripe-webhook.js'),
 'nowpayments-webhook':()=>import('../../server/payments/nowpayments-webhook.js'),
 'wire-instructions':()=>import('../../server/payments/wire-instructions.js'),
 'wire-settings':()=>import('../../server/payments/wire-settings.js'),
};
export default async function handler(request,response){
 if(process.env.VERCEL==='1')reportRuntimeSecurityOnce();
 const path=new URL(request.url,'https://goldonthespot.com').pathname;
 const action=/^\/api\/payments\/([a-z-]+)\/?$/.exec(path)?.[1];
 if(!action||!Object.hasOwn(routes,action))return json(response,404,{error:'Not found'});
 if(!previewPaymentsAllowed(process.env.VERCEL_ENV,process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || `https://${PRODUCTION_DATABASE_HOST}`,process.env.STRIPE_SECRET_KEY)){
  if(action==='config'&&request.method==='GET')return json(response,200,{enabled:false,stripe_publishable_key:null,methods:{wire:false,card:false,embedded_card:false,crypto:false}});
  return json(response,503,{error:'Payments are disabled in this preview until isolated test credentials are configured.'});
 }
 return (await routes[action]()).default(request,response);
}
