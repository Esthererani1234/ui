import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketStatus} from '../src/lib/marketStatus.js';
const now=Date.parse('2026-10-23T10:00:00Z');
test('market status distinguishes missing, stale, future and failed quotes',()=>{
 assert.equal(marketStatus(null),'Loading prices');assert.equal(marketStatus(null,{error:true}),'Prices unavailable');
 for(const timestamp of [null,'bad','2026-10-23T09:57:59Z','2026-10-23T10:02:00Z'])assert.equal(marketStatus({timestamp},{now}),'Last quoted prices');
 assert.equal(marketStatus({timestamp:'2026-10-23T09:59:59Z'},{now}),'Live market');
 assert.equal(marketStatus({timestamp:'2026-10-23T09:59:59Z'},{now,error:true}),'Last price shown');
});
import handler from '../api/metals.js';
test('public prices use oldest provider timestamp and never fabricate freshness',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async url=>Response.json({price:100,timestamp:url.includes('XAU')?'2026-10-23T09:00:00Z':'2026-10-23T10:00:00Z'});let r=await handler(new Request('https://fixture.test/api/metals'));assert.equal(r.status,200);let body=await r.json();assert.equal(body.timestamp,'2026-10-23T09:00:00.000Z');assert.equal(body.metals.gold,100.4);assert.ok(!r.headers.get('cache-control').includes('86400'));globalThis.fetch=async()=>Response.json({price:100});assert.equal((await (await handler(new Request('https://fixture.test/api/metals'))).json()).timestamp,null);globalThis.fetch=async()=>{throw new Error('provider secret error')};r=await handler(new Request('https://fixture.test/api/metals'));assert.equal(r.status,502);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!(await r.text()).includes('secret'));assert.equal((await handler(new Request('https://fixture.test/api/metals',{method:'POST'}))).status,405);}finally{globalThis.fetch=original;}});
