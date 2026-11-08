import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('proposed grants patch denies client mutations and preserves service operations and reads',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table orders(id integer);create table admin_users(id integer);grant all on orders,admin_users to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../docs/security/client-grants-hardening.sql',import.meta.url),'utf8'));
 for(const table of ['orders','admin_users'])for(const role of ['anon','authenticated','service_role'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','SELECT']){
 const {rows}=await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,table,privilege]);
 assert.equal(rows[0].allowed,role==='service_role'||privilege==='SELECT');
 }
 }finally{await db.close()}
});
