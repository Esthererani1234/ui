const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fixed = process.env.EXPECT_FIXED === '1';
const base = 'http://127.0.0.1:5184';
const product = {id:1,name:'Fixture Gold Coin',slug:'fixture-gold',sku:'TEST',metal:'gold',category:'coin',metal_weight_oz:1,is_active:true,is_featured:true,inventory_count:5,price_mode:'fixed',fixed_price:100,image_url:'/missing-fixture.png',image_urls:['/images/buffalo-hero-480-v1.webp']};
const user = {id:'10000000-0000-4000-8000-000000000001',email:'fixture@example.test',email_confirmed_at:'2026-01-01',role:'authenticated',aud:'authenticated',factors:[{id:'test',factor_type:'totp',status:'verified'}]};
const tickets = [1,2].map(id=>({id,user_id:user.id,ticket_number:`SUP-TEST-00${id}`,category:'order',subject:`Delivery question ${id}`,message:'Please help with delivery.',status:'open',created_at:'2026-10-22T10:00:00Z',updated_at:'2026-10-22T10:00:00Z'}));
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5184','--strictPort'],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{if(String(data).includes('Local:'))resolve()});server.on('exit',code=>reject(new Error('Vite exited: '+code)));});
 const browser=await chromium.launch({executablePath:process.cwd()+'/.verification/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[], results=[];
 async function pageFor(options={}) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>errors.push(e.message));
  if(options.admin){const jwt=[{alg:'HS256'},{sub:user.id,role:'authenticated',aal:'aal2',session_id:'20000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');await page.addInitScript(({jwt,user})=>localStorage.setItem('sb-jwquqphzsnnijopabuhn-auth-token',JSON.stringify({access_token:jwt,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})),{jwt,user});}
  await page.route('**/*',async route=>{
   const req=route.request(), url=new URL(req.url());let body;
   if(url.hostname.endsWith('.supabase.co')){
    if(url.pathname.endsWith('/products')){if(options.catalogFailure)return route.fulfill({status:503,json:{message:'Fixture catalog unavailable'}});body=options.empty?[]:[product];}
    else if(url.pathname.startsWith('/auth/'))body=user;
    else if(url.pathname.endsWith('/profiles'))body={id:user.id,first_name:'Fixture'};
    else if(url.pathname.endsWith('/admin_users'))body=options.admin?{user_id:user.id}:null;
    else if(url.pathname.endsWith('/app_settings'))body=url.searchParams.has('key')&&url.searchParams.get('key').startsWith('eq.')?null:[];
    else if(url.pathname.endsWith('/support_tickets'))body=tickets;
    else if(url.pathname.endsWith('/support_ticket_messages')){if(options.threadFailure)return route.fulfill({status:503,json:{message:'Fixture conversation unavailable'}});body=[{id:1,author_role:'customer',message:'Please help with delivery.',created_at:tickets[0].created_at}];}
    else if(url.pathname.endsWith('/support-operations')){options.calls=(options.calls||0)+1;(options.requestIds ||= []).push(req.postDataJSON().request_id);return route.fulfill({status:503,json:{error:'Fixture save failed. Please retry.'}});}
    else body=[];
   }else if(url.pathname==='/api/payments/wire-settings' && options.bankMode){
    if(req.method()==='POST'){
     (options.bankRequests ||= []).push(req.postDataJSON());
     return route.fulfill(options.saveBank?{json:{success:true,account_last4:'0000'}}:{status:400,json:{error:'Fixture bank validation failed.'}});
    }
    if(options.bankMode==='failure')return route.fulfill({status:503,json:{error:'Fixture bank settings unavailable.'}});
    if(options.bankMode==='network')return route.abort('connectionfailed');
    if(options.bankMode==='malformed')return route.fulfill({json:{}});
    body=options.bankMode==='empty'?{configured:false,settings:null}:{configured:true,settings:{bank_name:'Fixture Bank',beneficiary_name:'Fixture Store',routing_number:'000000000',account_number:'••••0000',swift_code:'',notes:'Fixture instructions',account_last4:'0000'}};
   }else if(url.pathname.startsWith('/api/'))body=url.pathname.includes('metals')?{metals:{gold:4000,silver:50,platinum:1000,palladium:1000}}:{};
   else if(url.hostname!=='127.0.0.1')return route.abort();
   if(body!==undefined)return route.fulfill({json:body});
   // No mutation can leave this fixture browser, even if a new endpoint appears.
   if(req.method()!=='GET')throw new Error('Unexpected unmocked mutation: '+url.pathname);
   return route.continue();
  });return page;
 }
 try {
  const shopOptions={catalogFailure:true};const shop=await pageFor(shopOptions);await shop.goto(base+'/shop');
  await shop.getByText(fixed?'Catalog temporarily unavailable':'No products found',{exact:true}).waitFor();
  if(fixed){shopOptions.catalogFailure=false;await shop.getByRole('button',{name:'Try again',exact:true}).click();await shop.getByRole('heading',{name:product.name,exact:true}).waitFor();}
  results.push({catalogFailureRecovery:fixed?'passed':'BUG: failure displayed as no products'});await shop.close();
  const detailOptions={catalogFailure:true};const detail=await pageFor(detailOptions);await detail.goto(base+'/product/'+product.slug);
  await detail.getByRole('heading',{name:fixed?'Product details temporarily unavailable':'Product not found',exact:true}).waitFor();
  if(fixed){detailOptions.catalogFailure=false;await detail.getByRole('button',{name:'Try again',exact:true}).click();await detail.getByRole('heading',{name:product.name,exact:true}).waitFor();await detail.locator('.product-main-image .product-image-fallback').waitFor();await detail.getByRole('button',{name:'View product picture 2',exact:true}).click();await detail.waitForFunction(()=>document.querySelector('.product-main-image img')?.naturalWidth>0);await detail.getByRole('button',{name:/^Magnify Fixture/}).click();await detail.getByRole('dialog').waitFor();await detail.getByRole('button',{name:'Close image viewer',exact:true}).click();}
  results.push({productFailureRecovery:fixed?'passed':'BUG: failure displayed as missing product',galleryFallbackAndNextImage:fixed?'passed':'pending'});await detail.close();
  const mobile=await pageFor();await mobile.goto(base+'/shop?metal=gold');await mobile.getByRole('heading',{name:product.name,exact:true}).waitFor();
  await mobile.getByRole('button',{name:'Open menu',exact:true}).click();await mobile.locator('.store-nav').getByRole('link',{name:'Silver',exact:true}).click();await mobile.waitForURL('**/shop?metal=silver');
  if(fixed)await mobile.waitForFunction(()=>document.querySelector('.menu-button').getAttribute('aria-expanded')==='false');
  assert.equal(await mobile.getByRole('button',{name:'Open menu',exact:true}).getAttribute('aria-expanded'),fixed?'false':'true');
  results.push({queryNavigationClosesMobileMenu:fixed?'passed':'BUG: menu remains expanded'});await mobile.close();
  const supportOptions={admin:true,threadFailure:true};const admin=await pageFor(supportOptions);await admin.goto(base+'/admin?tab=support');await admin.getByRole('button',{name:/SUP-TEST-001/}).click();await admin.getByRole('alert').getByText(/conversation could not be loaded/).waitFor();await admin.getByLabel('Reply to customer').fill('A draft that must survive navigation.');
  assert.equal(await admin.getByRole('button',{name:'Send reply & save status',exact:true}).isDisabled(),fixed);
  supportOptions.threadFailure=false;await admin.getByRole('button',{name:'Refresh conversation',exact:true}).click();await admin.locator('.support-message').getByText('Please help with delivery.',{exact:true}).waitFor();
  await admin.getByRole('button',{name:/SUP-TEST-002/}).click();await admin.getByRole('button',{name:/SUP-TEST-001/}).click();
  assert.equal(await admin.getByLabel('Reply to customer').inputValue(),fixed?'A draft that must survive navigation.':'');
  if(fixed){await admin.getByLabel('Ticket status to save').selectOption('in_progress');await admin.getByLabel('Search loaded tickets').fill('missing');await admin.getByLabel('Search loaded tickets').fill('');assert.equal(await admin.getByLabel('Reply to customer').inputValue(),'A draft that must survive navigation.');assert.equal(await admin.getByLabel('Ticket status to save').inputValue(),'in_progress');await admin.getByRole('button',{name:'Send reply & save status',exact:true}).click();await admin.getByText('Fixture save failed. Please retry.',{exact:true}).waitFor();assert.equal(await admin.getByLabel('Reply to customer').inputValue(),'A draft that must survive navigation.');await admin.getByRole('button',{name:/SUP-TEST-001/}).click();await admin.getByRole('button',{name:/SUP-TEST-001/}).click();await admin.getByRole('button',{name:'Send reply & save status',exact:true}).click();await admin.getByText('Fixture save failed. Please retry.',{exact:true}).waitFor();assert.equal(supportOptions.requestIds[0],supportOptions.requestIds[1]);}
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:'.verification/storefront-support-reliability.png',fullPage:true});
  results.push({adminDraftSurvivesNavigationAndFilters:fixed?'passed':'BUG: draft discarded on switch',replyBlockedOnThreadFailure:fixed?'passed':'BUG: reply enabled after failed conversation load'});await admin.close();
  if(fixed){const empty=await pageFor({empty:true});await empty.goto(base+'/product/missing');await empty.getByRole('heading',{name:'Product not found',exact:true}).waitFor();await empty.goto(base+'/shop');await empty.getByRole('heading',{name:'No products found',exact:true}).waitFor();await empty.goto(base+'/account?tab=orders');await empty.waitForURL('**/login?return=*');assert.equal(new URL(empty.url()).searchParams.get('return'),'/account?tab=orders');await empty.close();results.push({realEmptyAndMissingStates:true,accountSignInReturnPreserved:true});}
  if(fixed){
   const options={admin:true,bankMode:'failure'},bank=await pageFor(options);
   await bank.goto(base+'/admin?tab=store');
   const panel=bank.locator('form').filter({has:bank.getByRole('heading',{name:'Encrypted bank-wire instructions',exact:true})});
   await panel.getByRole('alert').getByText('Fixture bank settings unavailable.',{exact:true}).waitFor();
   assert.equal(await panel.getByRole('button',{name:'Encrypt and save wire instructions'}).isDisabled(),true);
   assert.equal(await panel.getByLabel('Bank name',{exact:true}).isDisabled(),true);
   assert.equal(options.bankRequests,undefined);
   options.bankMode='network';await panel.getByRole('button',{name:'Retry loading bank instructions'}).click();await panel.getByRole('alert').waitFor();assert.equal(await panel.getByRole('button',{name:'Encrypt and save wire instructions'}).isDisabled(),true);
   options.bankMode='malformed';await panel.getByRole('button',{name:'Retry loading bank instructions'}).click();await panel.getByRole('alert').getByText(/incomplete bank-wire settings/).waitFor();
   options.bankMode='ready';await panel.getByRole('button',{name:'Retry loading bank instructions'}).click();await panel.getByText(/Instructions are configured/).waitFor();
   assert.equal(await panel.getByLabel('Bank name',{exact:true}).inputValue(),'Fixture Bank');
   assert.equal(await panel.getByLabel('Full account number',{exact:true}).inputValue(),'');
   assert.equal(await panel.getByLabel('Domestic wire ABA',{exact:false}).inputValue(),'000000000');
   await panel.getByLabel('SWIFT / BIC (optional, international wires)',{exact:true}).waitFor();
   await panel.getByLabel('Full account number',{exact:true}).fill('00000000');await panel.getByLabel('Required audit reason',{exact:true}).fill('Fixture-only verification');
   await panel.getByRole('button',{name:'Encrypt and save wire instructions'}).click();await panel.getByRole('alert').getByText('Fixture bank validation failed.',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Full account number',{exact:true}).inputValue(),'00000000');
   options.saveBank=true;await panel.getByRole('button',{name:'Encrypt and save wire instructions'}).click();await panel.getByRole('status').getByText('Encrypted wire instructions saved. Account ending 0000.',{exact:true}).waitFor();
   assert.equal(await panel.getByLabel('Full account number',{exact:true}).inputValue(),'');assert.equal(await panel.getByLabel('Required audit reason',{exact:true}).inputValue(),'');assert.equal('account_last4' in options.bankRequests[1],false);
   assert.equal(await bank.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:'.verification/bank-settings-reliability-mobile.png'});await bank.setViewportSize({width:1440,height:1000});await panel.screenshot({path:'.verification/bank-settings-reliability-desktop.png'});await bank.close();
   const unconfigured=await pageFor({admin:true,bankMode:'empty'});await unconfigured.goto(base+'/admin?tab=store');await unconfigured.getByText('Configure the instructions customers receive after placing a wire order.',{exact:true}).waitFor();assert.equal(await unconfigured.getByRole('button',{name:'Encrypt and save wire instructions'}).isEnabled(),true);await unconfigured.close();
   results.push({bankHttpNetworkMalformedErrorsAndRetry:true,bankSaveBlockedUntilLoaded:true,bankMaskedAccountNeverSubmitted:true,bankSaveFailureRetainsDraft:true,bankSaveSuccessClearsSensitiveFields:true,bankUnconfiguredStateAndRoutingLabels:true,bankMobileNoOverflow:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mode:fixed?'regression':'reproduction',results,pageErrors:errors,productionMutations:0},null,2));
 }finally{await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1});
