import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {isProductionPreview,previewReadAllowed,previewPaymentsAllowed} from '../shared/deploymentSafety.js';
import paymentRoute from '../api/payments/[action].js';
import {service} from '../server/lib/payments.js';
const production='https://jwquqphzsnnijopabuhn.supabase.co';
test('production stays enabled while previews require a distinct database and Stripe test key',()=>{
 assert.equal(isProductionPreview('production',production),false);
 assert.equal(isProductionPreview('preview',production),true);
 assert.equal(isProductionPreview('preview','bad-url'),true);
 assert.equal(previewPaymentsAllowed('preview',production,'sk_test_fixture'),false);
 assert.equal(previewPaymentsAllowed('preview','https://isolated.supabase.co','sk_live_fixture'),false);
 assert.equal(previewPaymentsAllowed('preview','https://isolated.supabase.co','sk_test_fixture'),true);
 assert.equal(previewPaymentsAllowed('production',production,'sk_live_fixture'),true);
});
test('read-only previews allow public catalog reads but block Auth, RPC, private data and writes',()=>{
 for(const path of ['/rest/v1/products?select=*','/rest/v1/app_settings?select=key,value','/storage/v1/object/public/product-images/coin.webp'])assert.equal(previewReadAllowed(production+path),true);
 for(const path of ['/auth/v1/token','/auth/v1/signup','/functions/v1/customer-sms','/rest/v1/rpc/create_order','/rest/v1/orders','/storage/v1/object/product-images/coin.webp'])assert.equal(previewReadAllowed(production+path),false);
 for(const method of ['POST','PATCH','DELETE','PUT'])assert.equal(previewReadAllowed(production+'/rest/v1/products',{method}),false);
 assert.equal(previewReadAllowed('https://untrusted.example/rest/v1/products'),false);
});
test('preview server refuses production database and payment operations before provider access',async()=>{
 const old=process.env.VERCEL_ENV;process.env.VERCEL_ENV='preview';
 try{
  assert.throws(()=>service(),/disabled in preview/);
  for(const [path,method,expected] of [['config','GET',200],['confirm-card','POST',503],['stripe-webhook','POST',503]]){
   const req=Object.assign(Readable.from([Buffer.from('{}')]),{url:'/api/payments/'+path,method,headers:{}});
   const res={code:200,status(n){this.code=n;return this},setHeader(){return this},end(b){this.body=JSON.parse(b)}};
   await paymentRoute(req,res);assert.equal(res.code,expected);if(path==='config')assert.equal(res.body.methods.card,false);
  }
 }finally{if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}
});
