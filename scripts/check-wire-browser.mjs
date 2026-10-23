import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try{
 const page=await browser.newPage();let requests=0;let fail=false;
 await page.route('**/api/payments/wire-instructions?order_id=42',route=>{
  requests++;
  return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{error:'Please retry shortly.'}:{instructions:{bank_name:'Fixture bank',beneficiary_name:'Fixture LLC',routing_number:'000000000',account_number:'000000000'},reference:'FIXTURE',total:100,due_at:'2099-01-01T00:00:00Z'})});
 });
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:5177/scripts/fixtures/wire-browser.html');
  const hide=page.getByRole('button',{name:'Hide wire instructions'});await hide.waitFor();
  assert.equal(await hide.getAttribute('aria-expanded'),'true');
  assert.equal(await page.getByRole('region',{name:'Bank wire instructions'}).count(),1);
  const previous=requests;await hide.click();assert.equal(requests,previous);
  const show=page.getByRole('button',{name:'View wire instructions'});await show.waitFor();assert.equal(await show.getAttribute('aria-expanded'),'false');
  await show.click();await hide.waitFor();assert.equal(requests,previous+1);
  await hide.click();fail=true;await show.click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/retry/);
  fail=false;await show.click();await hide.waitFor();
  console.log(`PASS ${width}px: automatic open, hide, fresh reopen, visible error, retry`);
 }
}finally{await browser.close();}
