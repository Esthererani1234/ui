import {test} from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFile,readdir} from 'node:fs/promises';
import {cardLimitMessage} from '../shared/cardLimits.js';
import {assertPayable} from '../server/lib/payments.js';
test('card eligibility allows fee headroom and rejects one cent above either limit',()=>{
 for(const [subtotal,total,allowed] of [[9999.99,10399.99,true],[10000,10400,true],[10000,10450,true],[10000.01,10400.01,false],[10000,10450.01,false]]){
 assert.equal(!cardLimitMessage(subtotal,total),allowed);
 const order={subtotal,total,payment_method:'card',payment_status:'unpaid',status:'awaiting_payment',price_locked_until:new Date(Date.now()+600000).toISOString()};
 if(allowed)assert.doesNotThrow(()=>assertPayable(order,'card'));else assert.throws(()=>assertPayable(order,'card'));
 }
 assert.ok(cardLimitMessage(10000,10400,10000));for(const bad of [undefined,NaN,Infinity,-1])assert.ok(cardLimitMessage(bad,100));
});
test('database blocks direct subtotal/total changes and card conversion, preserving wire and status updates',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema private;create role anon;create role authenticated;create table app_settings(key text,value jsonb);insert into app_settings values('card_order_maximum','10000');create table admin_audit_log(action text,target_type text,target_id text,reason text,metadata jsonb);create table orders(id int primary key,payment_method text,subtotal numeric,total numeric,status text);`);
 const dir=new URL('../supabase/migrations/',import.meta.url),file=(await readdir(dir)).find(x=>x.endsWith('_card_cart_limit.sql'));await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.exec("insert into orders values(1,'card',10000,10450,'awaiting_payment'),(2,'wire',20000,20000,'awaiting_payment')");
 for(const sql of ["update orders set subtotal=10000.01 where id=1","update orders set total=10450.01 where id=1","update orders set payment_method='card' where id=2","insert into orders values(3,'card',10000.01,10400.01,'awaiting_payment')"])await assert.rejects(db.exec(sql),/Card payments|card payment limit/);
 await db.exec("update orders set status='cancelled' where id=1");assert.equal((await db.query("select value from app_settings")).rows[0].value,10450);
 }finally{await db.close()}
});
