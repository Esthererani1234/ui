const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const {spawn}=require('node:child_process');
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5196','--strictPort'],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{if(chunk.toString().includes('Local:'))resolve()});server.on('error',reject);server.on('exit',code=>reject(new Error('Dev server exited '+code)));});
 const b=await chromium.launch({headless:true,executablePath:process.cwd()+'/.verification/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try {
 const p=await b.newPage({viewport:{width:1440,height:1000}}); const errors=[];p.setDefaultTimeout(10000);
 p.on('pageerror',e=>errors.push(e.message));
 const uid='10000000-0000-4000-8000-000000000001';
 const user={id:uid,email:'admin@example.test',aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-01-01',factors:[{id:'fixture-factor',factor_type:'totp',status:'verified'}]};
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:uid,role:'authenticated',aal:'aal2',exp:Math.floor(Date.now()/1000)+3600,session_id:'20000000-0000-4000-8000-000000000001'},Buffer.from('fixture-signature').toString('base64url')].map((x,i)=>i<2?Buffer.from(JSON.stringify(x)).toString('base64url'):x).join('.');
 await p.addInitScript(({jwt,user})=>localStorage.setItem('sb-jwquqphzsnnijopabuhn-auth-token',JSON.stringify({access_token:jwt,refresh_token:'fixture-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})),{jwt,user});
 let rejectSave=true;const requests=[];
 const order={id:1,order_number:'TEST-001',user_id:uid,first_name:'Test',last_name:'Customer',email:'customer@example.test',phone:'+12025550123',total:100,subtotal:100,shipping_amount:0,payment_surcharge:0,status:'awaiting_payment',payment_status:'unpaid',payment_method:'wire',created_at:'2026-10-15T10:00:00Z',order_items:[],shipping_address:{}};
 await p.route('**/*',async route=>{
  const url=new URL(route.request().url());
  let body;
  if(url.hostname.endsWith('.supabase.co')){
   if(url.pathname.startsWith('/auth/')) body=user;
   else if(url.pathname.endsWith('/admin_users')) body={user_id:uid};
   else if(url.pathname.endsWith('/profiles')) body={id:uid,first_name:'Admin'};
   else if(url.pathname.endsWith('/app_settings')) body=[{key:'customer_sms_mfa_required',value:true},{key:'sms_provider_ready',value:true}];
   else if(url.pathname.endsWith('/orders')) body=[order];
   else if(url.pathname.includes('/functions/v1/admin-operations')) {const req=route.request().postDataJSON();if(req.action==='update_order'){requests.push(req);if(rejectSave){rejectSave=false;return route.fulfill({status:409,json:{error:'A card payment is still unresolved. Check Stripe before cancelling or changing this order.'},headers:{'access-control-allow-origin':'*'}})}for(const key of ['status','payment_status','tracking_number','internal_notes'])if(key in req)order[key]=req[key];body={success:true};}else body=req.action==='get_order_details'?{order}:{customers:[],report:null};}
   else if(url.pathname.includes('/functions/v1/customer-sms')) body={required:true,configured:true,verified:true};
   else body=[];
  } else if(url.pathname.startsWith('/api/')) body=url.pathname.includes('metals')?{metals:{gold:4000,silver:50,platinum:1500,palladium:1000}}:{report:null,configured:false};
  else if(!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
  if(body!==undefined) return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
  return route.continue();
 });
 await p.goto('http://127.0.0.1:5196/admin');await p.getByRole('heading',{name:'Dashboard',exact:true}).waitFor({timeout:15000}).catch(async e=>{console.log(JSON.stringify({url:p.url(),body:(await p.locator('body').innerText()).slice(0,6000),errors}));throw e});
 await p.locator('.admin-sidebar').getByRole('button',{name:'Orders',exact:true}).click();
 const open=async()=>{await p.getByRole('button',{name:'Manage order',exact:true}).first().click();await p.getByRole('dialog').waitFor()};
 await open();let modal=p.getByRole('dialog');
 console.log(await modal.getByRole('combobox').first().evaluate(el=>el.outerHTML));assert.equal(await modal.getByRole('combobox').first().locator('option[value="shipped"]').getAttribute('disabled'),'');
 await modal.getByLabel('Tracking number',{exact:true}).fill('TRACK-123');await modal.getByLabel('Required audit reason').fill('Tracking received');
 await modal.getByRole('button',{name:'Save audited changes'}).click();await modal.getByRole('alert').waitFor();
 assert.match(await modal.getByRole('alert').innerText(),/unresolved/);
 assert.equal('status' in requests[0],false);assert.equal('payment_status' in requests[0],false);
 await modal.getByRole('button',{name:'Save audited changes'}).click();await modal.waitFor({state:'hidden'});
 await open();assert.equal(await modal.getByLabel('Tracking number',{exact:true}).inputValue(),'TRACK-123');
 await modal.getByRole('combobox').first().selectOption('cancelled');await modal.getByLabel('Required audit reason').fill('Customer cancelled');await modal.getByRole('button',{name:'Save audited changes'}).click();await modal.waitFor({state:'hidden'});assert.equal(order.status,'cancelled');
 order.status='pending_review';order.payment_status='paid';order.payment_method='card';order.risk_decision='approved';
 await open();await modal.getByRole('combobox').first().selectOption('shipped');await modal.getByLabel('Required audit reason').fill('Parcel handed to carrier');await p.setViewportSize({width:390,height:844});await modal.getByRole('button',{name:'Save audited changes'}).click();await modal.waitFor({state:'hidden'});assert.equal(order.status,'shipped');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({trackingOnlyPayload:true,errorVisibleInsideModal:true,retrySaved:true,cancellation:true,paidApprovedShipping:true,mobileSave:true,uncaughtErrors:errors,mode:'synthetic API fixtures; no production orders changed'}));
 } finally {await b.close(); server.kill()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
