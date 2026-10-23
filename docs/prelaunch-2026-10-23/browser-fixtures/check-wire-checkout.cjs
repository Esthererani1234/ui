const {chromium}=require('playwright');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');
(async()=>{const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5184'],{stdio:['ignore','pipe','pipe']});await new Promise(r=>server.stdout.on('data',x=>{if(String(x).includes('Local:'))r()}));const browser=await chromium.launch({headless:true,executablePath:process.cwd()+'/.verification/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],submissions=[],conversions=[];const conversion=process.env.TEST_CARD_TO_WIRE==='1';page.on('pageerror',e=>errors.push(e.message));
 const user={id:'10000000-0000-4000-8000-000000000001',email:'fixture@example.test',email_confirmed_at:'2026-01-01',role:'authenticated',aud:'authenticated'};
 const profile={id:user.id,first_name:'Test',last_name:'Buyer',phone:'+12025550123',address_line_1:'1 Test Street',address_line_2:'',city:'New York',state:'NY',postal_code:'10001'};
 const product={id:1,name:'Test Bullion Coin',slug:'test-bullion-coin',sku:'TEST-1',metal:'gold',metal_weight_oz:1,category:'coin',inventory_count:100,is_active:true,price_mode:'fixed',fixed_price:100,image_url:'/images/buffalo-hero-480-v1.webp'};
 const order={id:1,order_number:'GOTS-TEST-WIRE',user_id:user.id,first_name:'Test',last_name:'Buyer',email:user.email,phone:profile.phone,status:'pending_review',payment_status:'unpaid',payment_method:'wire',subtotal:100,shipping_amount:35,total:135,payment_due_at:new Date(Date.now()+86400000).toISOString(),created_at:new Date().toISOString(),shipping_address:profile,order_items:[{id:1,product_id:1,product_name:product.name,quantity:1,unit_price:100,line_total:100,product_image_url:product.image_url}]};
 const jwt=[{alg:'HS256'},{sub:user.id,role:'authenticated',aal:'aal1',session_id:'20000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 await page.addInitScript(({jwt,user,product})=>{localStorage.setItem('sb-jwquqphzsnnijopabuhn-auth-token',JSON.stringify({access_token:jwt,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));localStorage.setItem('gots-cart-v1',JSON.stringify([{product,quantity:1}]))},{jwt,user,product});
 let fail=true;
 await page.route('**/*',async route=>{const url=new URL(route.request().url());let body;
 if(url.hostname.endsWith('.supabase.co')){
 if(url.pathname.startsWith('/auth/'))body=user;
 else if(url.pathname.endsWith('/profiles')){assert.notEqual(route.request().postDataJSON()?.phone,'+12025550199');body=profile;}
 else if(url.pathname.endsWith('/admin_users'))body=null;
 else if(url.pathname.endsWith('/app_settings'))body=[{key:'customer_sms_mfa_required',value:true},{key:'sms_provider_ready',value:true}];
 else if(url.pathname.endsWith('/products'))body=[product];
 else if(url.pathname.endsWith('/customer-sms'))body={required:true,configured:true,verified:true,phone_enrolled:true};
 else if(url.pathname.endsWith('/orders'))body=url.searchParams.has('order_number')?order:[order];
 else if(url.pathname.endsWith('/create-order')){const payload=route.request().postDataJSON();submissions.push(payload);if(fail){fail=false;return route.fulfill({status:409,json:{error:'Test conflict: review your quote and try again.'},headers:{'access-control-allow-origin':'*'}})}body={order_id:1,order_number:order.order_number,payment_method:conversion?'card':'wire',total:135,payment_due_at:order.payment_due_at,price_locked_until:new Date(Date.now()+600000).toISOString()};}
 else body=[];
 }else if(url.pathname.startsWith('/api/')){
 if(url.pathname.includes('/change-method')){conversions.push(route.request().postDataJSON());body={order_id:1,order_number:order.order_number,payment_method:'wire',total:135,payment_due_at:order.payment_due_at};}
 else if(url.pathname.includes('/config'))body={enabled:true,methods:{wire:true,card:false,embedded_card:false,crypto:false}};
 else if(url.pathname.includes('/quote'))body={quote_id:'30000000-0000-4000-8000-000000000001',expires_at:new Date(Date.now()+600000).toISOString(),subtotal:100,shipping:35,card_surcharge:4,wire_total:135,card_total:139,line_items:[{product_id:1,quantity:1,unit_price:100,line_total:100,product_name:product.name}],spot_snapshot:{gold:100}};
 else if(url.pathname.includes('wire-instructions'))body={order_number:order.order_number,total:135,reference:order.order_number,due_at:order.payment_due_at,instructions:{bank_name:'Fixture Bank',beneficiary_name:'Fixture LLC',routing_number:'021000021',account_number:'12345678',swift_code:'TESTUS33'},agreement:{version:'2026-10-22-wire-v1',accepted_at:order.created_at,text:'Fixture accepted agreement'}};
 else if(url.pathname.includes('/metals'))body={metals:{gold:100,silver:10,platinum:90,palladium:80}};
 else body={};
 }else if(url.hostname!=='127.0.0.1')return route.abort();
 if(body!==undefined)return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});return route.continue();});
 await page.goto('http://127.0.0.1:5184/checkout');await page.getByRole('heading',{name:'Bank-wire purchase agreement'}).waitFor();
 await page.getByLabel('Phone',{exact:true}).fill('+12025550199');
 const submit=page.getByRole('button',{name:'Agree & place secure order'});await submit.click();await page.getByText('Read and accept the bank-wire purchase agreement.',{exact:true}).waitFor();assert.equal(submissions.length,0);
 await page.locator('.wire-agreement input').check();await page.locator('.terms-check input').check();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){console.log(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,els:[...document.querySelectorAll('body *')].filter(e=>e.scrollWidth>e.clientWidth+2).slice(-15).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,scroll:e.scrollWidth,display:getComputedStyle(e).display,text:e.textContent.slice(0,80)}))})));await page.screenshot({path:'.verification/wire-overflow.png',fullPage:true});throw new Error('checkout overflow')}await page.screenshot({path:'.verification/wire-agreement-'+width+'.png',fullPage:true});}
 await submit.click();await page.getByText('Test conflict: review your quote and try again.',{exact:true}).waitFor();assert.equal(submissions.length,1);assert.ok(await page.locator('.wire-agreement input').isChecked());
 await submit.click();await page.waitForURL('**/account?**');await page.getByRole('heading',{name:'Send your bank wire'}).waitFor();assert.equal(submissions.length,2);assert.deepEqual(submissions[1].wire_agreement,{accepted:true,version:'2026-10-22-wire-v1'});
 assert.match(await page.locator('.wire-instructions').innerText(),/12345678/);assert.match(await page.locator('.wire-instructions').innerText(),/international wires only/);assert.match(await page.locator('.wire-instructions').innerText(),/135.00 USD/);
 await page.screenshot({path:'.verification/wire-instructions-mobile.png',fullPage:true});assert.equal(conversions.length,conversion?1:0);if(conversion)assert.deepEqual(conversions[0].wire_agreement,{accepted:true,version:'2026-10-22-wire-v1'});assert.deepEqual(errors,[]);console.log(JSON.stringify({explicitConsent:true,serverErrorVisible:true,retryPreservesForm:true,opensInstructions:true,mobileDesktop:true,doesNotOverwriteVerifiedPhone:true,errors,productionWrites:0}));
 }finally{await browser.close();server.kill()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
