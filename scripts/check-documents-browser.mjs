import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderDeliveryPdf} from '../server/lib/deliveryPdf.js';
import {receiptInput} from '../server/lib/documentInputs.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const {createServer}=await import('vite');
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const base='http://127.0.0.1:'+server.httpServer.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:860},acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  const state={order:{id:42,order_number:'DEMO-42',total:480,status:'processing',payment_status:'paid',payment_method:'wire'},delivery:{},items:[{id:10,quantity:2,product_name:'Fixture silver bar',unit_price:240,line_total:480,units:[]}]};
  const docs=[],logs=[],errors=[];let received;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/payments/order-documents',async route=>{
   const {action,data}=route.request().postDataJSON();
   if(action==='load')return route.fulfill({json:{state,revision:'local',docs,logs}});
   if(action==='serial'){state.items[0].units=[data];return route.fulfill({json:{saved:true}})}
   if(action==='delivery'){state.delivery=data;return route.fulfill({json:{saved:true}})}
   if(action==='issue'){
    received=receiptInput(data.receipt);const id=randomUUID(),now=new Date().toISOString();
    docs.push({id,kind:'signed',created_at:now});
    return route.fulfill({contentType:'application/pdf',body:await renderDeliveryPdf(state,'signed',id,now,received)});
   }throw Error('Unexpected request: '+action);
  });
  await page.goto(base+'/scripts/fixtures/documents-browser.html');
  await page.getByText('Product Serial Numbers',{exact:true}).click();
  await page.getByLabel('Unit',{exact:true}).selectOption('2');
  await page.getByLabel('Serial number',{exact:true}).fill('TEST-002');
  await page.getByRole('button',{name:'Save unit'}).click();
  await page.getByText('Saved to this order.').waitFor();
  await page.getByText('Delivery management',{exact:true}).click();
  await page.getByLabel('Method',{exact:true}).selectOption('Customer Pickup');
  await page.getByRole('button',{name:'Save delivery details'}).click();
  await page.getByRole('button',{name:'Capture Customer Signature'}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.match(await dialog.textContent(),/TEST-002/);assert.equal(state.delivery.status,'Pending');assert.equal(received,undefined);
  const sign=dialog.getByRole('button',{name:'Sign and confirm receipt'});assert.equal(await sign.isDisabled(),true);
  await dialog.getByLabel('Recipient printed name').fill('Fixture Recipient');
  await dialog.getByLabel('I confirm the listed').check();
  const pad=dialog.locator('canvas');await pad.scrollIntoViewIfNeeded();const b=await pad.boundingBox();
  await page.mouse.move(b.x+b.width*.1,b.y+b.height*.6);await page.mouse.down();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.2,{steps:12});await page.mouse.up();
  await sign.click();await page.getByRole('link',{name:'Download last PDF'}).waitFor();await dialog.waitFor({state:'detached'});
  assert.equal(received.name,'Fixture Recipient');assert.ok(received.strokes.length);assert.equal(state.delivery.status,'Pending');assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS '+width+'px: per-unit serial, delivery method, conditional consent, signature and PDF link');await context.close();
 }
}finally{await browser.close();await server.close()}
