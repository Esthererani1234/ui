const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const origin = 'http://127.0.0.1:5188';
const userA = { id: '10000000-0000-4000-8000-000000000001', email: 'customer@example.test', email_confirmed_at: '2026-01-01', role: 'authenticated', aud: 'authenticated', factors: [] };
const userB = { ...userA, id: '10000000-0000-4000-8000-000000000002', email: 'other@example.test' };
const session = user => ({ access_token: [{alg:'HS256'}, {sub:user.id, role:'authenticated', aal:'aal1', session_id:'20000000-0000-4000-8000-000000000001', exp:Math.floor(Date.now()/1000)+3600}, 'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.'), refresh_token:'fixture', expires_at:Math.floor(Date.now()/1000)+3600, expires_in:3600, token_type:'bearer', user });
const profileFor = user => ({id:user.id, first_name:user.id===userA.id?'Alex':'Jordan', last_name:'Morgan', phone:'+12025550123', phone_verified_at:'2026-10-21', address_line_1:'100 Test Street', address_line_2:'Suite 2', city:'New York', state:'NY', postal_code:'10001', marketing_opt_in:false});
const ticket = {id:1,ticket_number:'SUP-TEST-001',user_id:userA.id,category:'order',subject:'Help with delivery',message:'Please check my delivery details.',status:'open',created_at:'2026-10-22T10:00:00Z',updated_at:'2026-10-22T10:00:00Z',admin_response:'STALE ADMIN RESPONSE MUST NOT APPEAR'};
(async()=>{
  const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5188','--strictPort'],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{server.stdout.on('data',x=>{if(String(x).includes('Local:'))resolve()});server.on('exit',code=>reject(new Error('Vite exited '+code)))});
  const browser=await chromium.launch({headless:true,executablePath:process.cwd()+'/.verification/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
  const errors=[], results={};
  try {
    async function fixture(options={}) {
      const state={user:userA,profiles:{[userA.id]:profileFor(userA),[userB.id]:profileFor(userB)},saveMode:'fail',resetMode:'fail',ordersFail:false,ticketsFail:false,patches:[],resets:[],...options};
      const page=await browser.newPage({viewport:{width:1440,height:1000}}); page.setDefaultTimeout(10000);
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(s=>localStorage.setItem('sb-jwquqphzsnnijopabuhn-auth-token',JSON.stringify(s)),session(userA));
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        const respond=(body,status=200)=>route.fulfill({status,json:body,headers:{'access-control-allow-origin':'*'}});
        if(url.hostname==='127.0.0.1' && url.pathname==='/src/state/AuthContext.jsx') {
          const response=await route.fetch();let body=await response.text();
          const anchor='const [profile, setProfile] = useState(null);'; assert.ok(body.includes(anchor),'fixture profile-refresh hook insertion');
          body=body.replace(anchor,anchor+' window.__fixtureRefreshProfile = setProfile;');
          return route.fulfill({response,body});
        }
        if(url.hostname.endsWith('.supabase.co')) {
          if(url.pathname.endsWith('/recover')) {
            state.resets.push({body:req.postDataJSON(),redirect:url.searchParams.get('redirect_to')});
            if(state.resetMode==='hold') await new Promise(resolve=>state.releaseReset=resolve);
            return state.resetMode==='fail'?respond({msg:'Fixture reset failure'},400):respond({});
          }
          if(url.pathname.endsWith('/logout')) return respond({});
          if(url.pathname.startsWith('/auth/')) return respond(state.user);
          if(url.pathname.endsWith('/profiles')) {
            const owner=url.searchParams.get('id')?.slice(3);
            if(req.method()==='PATCH') {
              const payload=req.postDataJSON();state.patches.push({owner,payload});
              if(state.saveMode==='hold') await new Promise(resolve=>state.releaseSave=resolve);
              if(state.saveMode==='fail')return respond({message:'Fixture denied save'},403);
              if(state.saveMode==='zero')return respond(null);
              Object.assign(state.profiles[owner],payload);return respond({id:owner});
            }
            return respond(state.profiles[owner]||null);
          }
          if(url.pathname.endsWith('/orders')) {
            if(state.ordersHold) await new Promise(resolve=>state.releaseOrders=resolve);
            return state.ordersFail?respond({message:'Fixture orders failure'},403):respond([]);
          }
          if(url.pathname.endsWith('/support_tickets'))return state.ticketsFail?respond({message:'Fixture tickets failure'},403):respond([ticket]);
          if(url.pathname.endsWith('/support_ticket_messages'))return respond([{id:1,ticket_id:1,author_role:'customer',message:ticket.message,created_at:ticket.created_at}]);
          if(url.pathname.endsWith('/admin_users'))return respond(null);
          if(url.pathname.endsWith('/app_settings'))return respond([{key:'customer_sms_mfa_required',value:true},{key:'sms_provider_ready',value:true}]);
          if(url.pathname.endsWith('/customer-sms'))return respond({required:true,configured:true,phone_enrolled:true,verified:true,phone:'+1 *** *** 0123'});
          if(req.method()!=='GET')throw new Error('Unexpected fixture mutation: '+url.pathname);
          return respond([]);
        }
        if(url.pathname.startsWith('/api/'))return respond(url.pathname.includes('metals')?{metals:{gold:4000,silver:50,platinum:1500,palladium:1000}}:{});
        if(url.hostname!=='127.0.0.1')return route.abort();
        return route.continue();
      });
      return {page,state};
    }
    const {page:p,state:s}=await fixture();
    await p.goto(origin+'/account?tab=profile');await p.getByLabel('First name',{exact:true}).waitFor();
    assert.equal(await p.getByRole('navigation',{name:'Your account'}).getByRole('link',{name:'Profile',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await p.getByLabel('First name',{exact:true}).inputValue(),'Alex');
    assert.equal(await p.locator('input[type=tel]').count(),0);
    await p.getByLabel('First name',{exact:true}).fill('   ');await p.getByRole('button',{name:'Save changes',exact:true}).click();
    await p.getByRole('alert').getByText('First and last name are required.').waitFor();assert.equal(s.patches.length,0);
    await p.getByLabel('First name',{exact:true}).fill('  New Alex  ');await p.getByLabel('Street address',{exact:true}).fill('200 Updated Street');
    await p.evaluate(value=>window.__fixtureRefreshProfile(value),{...profileFor(userA),first_name:'Background refresh'});
    assert.equal(await p.getByLabel('First name',{exact:true}).inputValue(),'  New Alex  ');
    await p.getByRole('button',{name:'Save changes',exact:true}).click();await p.getByRole('alert').getByText('Your changes are still here.',{exact:false}).waitFor();
    assert.equal(await p.getByLabel('Street address',{exact:true}).inputValue(),'200 Updated Street');
    s.saveMode='zero';await p.getByRole('button',{name:'Save changes',exact:true}).click();await p.getByRole('alert').getByText('Your changes are still here.',{exact:false}).waitFor();
    assert.equal(await p.getByRole('button',{name:'Save changes',exact:true}).isEnabled(),true);
    s.saveMode='hold';await p.getByRole('button',{name:'Save changes',exact:true}).click();await p.waitForFunction(()=>document.querySelector('form[aria-busy=true]'));
    assert.equal(await p.getByLabel('First name',{exact:true}).isDisabled(),true);
    await new Promise(resolve=>{const check=()=>s.releaseSave?resolve():setTimeout(check,10);check()});s.saveMode='success';s.releaseSave();
    await p.getByRole('status').getByText('Your profile and delivery address are saved.').waitFor();
    assert.equal(await p.getByLabel('First name',{exact:true}).inputValue(),'New Alex');assert.equal(s.patches.length,3);
    for(const {owner,payload} of s.patches){assert.equal(owner,userA.id);assert.equal('phone' in payload,false);assert.equal('phone_verified_at' in payload,false);assert.equal(payload.first_name,'New Alex');}
    results.profile={validation:true,dirtyRefreshPreserved:true,failedSaveDraftPreserved:true,zeroRowsNotSuccess:true,retry:true,busyControls:true,phoneExcluded:true};
    await p.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0)}); await p.screenshot({path:'.verification/account-profile-desktop.png',fullPage:true});
    for(const width of [390,320]){await p.setViewportSize({width,height:900});await p.evaluate(()=>window.scrollTo(0,0));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'profile overflow '+width);await p.screenshot({path:'.verification/account-profile-'+width+'.png',fullPage:true});}
    await p.getByRole('link',{name:'Request phone change',exact:true}).click();await p.waitForURL('**/support?new=1&category=account');
    await p.waitForFunction(()=>document.activeElement.id==='support-subject');assert.equal(await p.locator('.support-contact-card select').inputValue(),'account');
    await p.goBack();await p.getByRole('heading',{name:'Your details',exact:true}).waitFor();
    const nav=p.getByRole('navigation',{name:'Your account'});
    await nav.getByRole('link',{name:'Security',exact:true}).click();
    await p.getByRole('button',{name:'Send password-reset link',exact:true}).click();await p.getByRole('alert').getByText('We couldn’t send the reset link.',{exact:false}).waitFor();
    s.resetMode='success';await p.getByRole('button',{name:'Send password-reset link',exact:true}).click();await p.getByRole('status').getByText('A password-reset link was sent',{exact:false}).waitFor();
    assert.equal(s.resets.at(-1).body.email,userA.email);assert.equal(s.resets.at(-1).redirect,origin+'/login?recovery=1');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:'.verification/account-security-320.png',fullPage:true});
    await nav.getByRole('link',{name:'Support tickets',exact:true}).click();await p.waitForURL('**/support');
    await p.goto(origin+'/account?tab=support');await p.locator('.customer-ticket-link').waitFor();assert.equal(await p.getByText(ticket.admin_response,{exact:true}).count(),0);
    await p.screenshot({path:'.verification/account-tickets-320.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.locator('.customer-ticket-link').click();await p.waitForURL('**/support?ticket=SUP-TEST-001');await p.locator('.support-thread.expanded').waitFor();
    await p.goBack();await p.locator('.customer-ticket-link').waitFor();await p.getByRole('link',{name:'New support request',exact:true}).click();await p.waitForURL('**/support?new=1');await p.waitForFunction(()=>document.activeElement.id==='support-subject');
    console.log('Profile, navigation, reset checks passed');results.navigation={sharedNav:true,ticketLink:true,browserBack:true,newRequestFocus:true,phoneChangeCategory:true,staleAdminResponseRemoved:true};results.passwordReset={errorRetry:true,originalApiAndRedirect:true};
    await p.close();
    const independent=await fixture({ordersHold:true});const q=independent.page,t=independent.state;
    await q.goto(origin+'/account?tab=support');await q.locator('.customer-ticket-link').waitFor();
    assert.equal(await q.getByText('Loading your support requests…').count(),0);t.ordersHold=false;t.ordersFail=true;t.releaseOrders();
    await q.getByRole('navigation',{name:'Your account'}).getByRole('link',{name:'Orders',exact:true}).click();await q.getByRole('alert').getByText('Your orders could not be loaded.',{exact:false}).waitFor();
    t.ordersFail=false;await q.getByRole('button',{name:'Try again',exact:true}).click();await q.getByRole('heading',{name:'No orders yet',exact:true}).waitFor();
    t.ticketsFail=true;await q.goto(origin+'/account?tab=support');await q.getByRole('alert').getByText('Your support requests could not be loaded.',{exact:false}).waitFor();assert.equal(await q.getByText('No support requests yet',{exact:true}).count(),0);
    t.ticketsFail=false;await q.getByRole('button',{name:'Try again',exact:true}).click();await q.locator('.customer-ticket-link').waitFor();
    console.log('Independent loading checks passed');results.independentLoads={slowOrdersDoNotBlockTickets:true,ordersErrorRetry:true,ticketsErrorRetry:true,noFalseEmptyState:true};await q.close();
    for(const action of ['save','reset']){
      const {page:r,state:u}=await fixture({saveMode:'hold',resetMode:'hold'});await r.goto(origin+'/account?tab='+(action==='save'?'profile':'security'));
      if(action==='save'){await r.getByLabel('First name',{exact:true}).fill('Old owner draft');await r.getByRole('button',{name:'Save changes',exact:true}).click();}
      else await r.getByRole('button',{name:'Send password-reset link',exact:true}).click();
      const release=action==='save'?'releaseSave':'releaseReset';await new Promise(resolve=>{const check=()=>u[release]?resolve():setTimeout(check,10);check()});
      u.user=userB;await r.evaluate(async s=>{const {supabase}=await import('/src/lib/supabase.js');await supabase.auth.setSession({access_token:s.access_token,refresh_token:s.refresh_token})},session(userB));
      await r.getByRole('heading',{name:'Your account',exact:true}).waitFor();u.saveMode='success';u.resetMode='success';u[release]();
      await r.getByRole('navigation',{name:'Your account'}).getByRole('link',{name:'Profile',exact:true}).click();await r.getByLabel('First name',{exact:true}).waitFor();
      assert.equal(await r.getByLabel('First name',{exact:true}).inputValue(),'Jordan');assert.equal(await r.locator('.customer-account [role=status]').count(),0);
      await r.getByRole('navigation',{name:'Your account'}).getByRole('link',{name:'Security',exact:true}).click();assert.equal(await r.locator('.customer-account [role=status]').count(),0);
      await r.close();
    }
    console.log('Owner-change checks passed');results.ownerChange={pendingSaveIgnored:true,pendingResetIgnored:true,newOwnerDraftClean:true};
    const missing=await fixture({profiles:{[userB.id]:profileFor(userB)}});await missing.page.goto(origin+'/account?tab=profile');await missing.page.getByRole('button',{name:'Reload profile',exact:true}).waitFor();assert.equal(await missing.page.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true);
    await missing.page.getByRole('button',{name:'Reload profile',exact:true}).click();await missing.page.getByRole('button',{name:'Reload profile',exact:true}).waitFor();assert.equal(await missing.page.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true);
    missing.state.profiles[userA.id]=profileFor(userA);await missing.page.getByRole('button',{name:'Reload profile',exact:true}).click();await missing.page.getByLabel('First name',{exact:true}).waitFor();await missing.page.waitForFunction(()=>document.querySelector('input[name=first_name]').value==='Alex');
    await missing.page.getByRole('button',{name:'Sign out',exact:true}).click();await missing.page.waitForURL(url=>url.pathname==='/'||url.pathname==='/login');
    results.signOut={signedOut:true,landing:new URL(missing.page.url()).pathname};results.missingProfile={failedReloadStillDisabled:true,retry:true};await missing.page.close();
    assert.deepEqual(errors,[]);results.pageErrors=errors;results.widths=[1440,390,320];results.productionWrites=false;
    require('node:fs').writeFileSync('.verification/account-browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  } finally {await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
