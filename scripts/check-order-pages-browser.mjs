import {createRequire} from 'node:module';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const fixtureAuth={name:'fixture-account',enforce:'pre',
 resolveId(id,from){if(from?.endsWith('/AccountPage.jsx')&&id.startsWith('../state/'))return '\0test-'+id.split('/').at(-1)},
 load(id){if(id==='\0test-AuthContext')return "export const useAuth=()=>({user:{id:'fixture-user',email:'fixture@example.test'},profile:null})";if(id==='\0test-CartContext')return "export const useCart=()=>({completePurchase(){}})"}};
const server=await createServer({plugins:[fixtureAuth],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const base='http://127.0.0.1:'+server.httpServer.address().port+'/scripts/fixtures/order-pages-browser.html';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const row={id:42,order_number:'TEST-042',first_name:'Test',last_name:'Buyer',total:100,subtotal:100,status:'processing',payment_status:'paid',payment_method:'wire',created_at:'2026-01-01T12:00:00Z',order_items:[{id:1,product_name:'Silver bar',quantity:1,line_total:100,unit_price:100,products:{slug:'test-silver'}}]};
try{
 for(const width of [390,1440]){
 const ctx=await browser.newContext({viewport:{width,height:900}}),p=await ctx.newPage();p.setDefaultTimeout(7000);const errs=[];p.on('pageerror',e=>errs.push(e.message));let mode=503,detailReads=0,adminFails=true;
 await p.route('**/*.supabase.co/**',r=>{const path=new URL(r.request().url()).pathname;
   if(path==='/rest/v1/orders')return r.fulfill({status:adminFails?300:200,json:adminFails?{message:'Fixture failure'}:[row]});
   if(path.endsWith('/admin-operations'))return r.fulfill({json:{order:row}});
   return r.fulfill({json:[]})});
 await p.route('**/api/payments/order-documents',r=>r.fulfill({json:{state:{order:row,items:[],delivery:{}},logs:[],docs:[],revision:'test'}}));
 await p.route('**/api/payments/account-orders*',r=>{const n=new URL(r.request().url()).searchParams.get('order');if(n)detailReads++;
 return r.fulfill({status:mode,json:mode===200?{orders:n&&n!==row.order_number?[]:[row]}:{error:'Fixture failure'}})});
 await p.goto(base);await p.getByRole('alert').filter({hasText:'Your orders'}).waitFor();mode=200;await p.getByRole('button',{name:'Try again'}).click();await p.getByRole('link',{name:'View full order'}).click();
 await p.getByRole('heading',{name:'Your bullion'}).waitFor();assert.equal(await p.getByRole('link',{name:'Silver bar'}).getAttribute('href'),'/product/test-silver');assert.ok(detailReads>0);
 mode=403;await p.goto(base+'?order=TEST-042');await p.getByRole('link',{name:'Verify phone'}).waitFor();mode=401;await p.goto(base);await p.getByRole('link',{name:'Sign in again'}).waitFor();
 await p.goto(base+'?admin=1&tab=orders');await p.getByText('Orders are unavailable.',{exact:false}).waitFor().catch(async e=>{console.error('Admin fixture:',(await p.locator('body').innerText()).slice(0,1200),errs);throw e});assert.equal(await p.getByRole('heading',{name:'No orders yet'}).count(),0);
 adminFails=false;await p.getByRole('button',{name:'Retry loading'}).click();await p.getByRole('button',{name:'Manage order'}).click();
 await p.getByRole('dialog').getByRole('heading',{name:'TEST-042'}).waitFor();assert.deepEqual(errs,[]);
 console.log('PASS '+width+'px: customer history retry, receipt, SMS and sign-in recovery; admin retry and manage order');await ctx.close();
 }
}finally{await browser.close();await server.close()}
