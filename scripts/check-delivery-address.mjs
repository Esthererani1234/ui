import test from 'node:test';
import assert from 'node:assert/strict';
import {correctDeliveryAddress} from '../server/address/correct.js';
import {readPostalMatch} from '../server/address/usps.js';
import {readyToCheck,stateCode,fillAddressFields} from '../shared/deliveryAddress.js';
import states from '../shared/taxSources.json' with {type:'json'};

const original={address_line_1:'149 Church Street',address_line_2:'APT 2B',city:'Burlington',state:'Vermont',postal_code:'05401',country:'US'};
const row=(street='149 CHURCH ST',city='BURLINGTON',state='VT',zip='05401')=>({matchedAddress:[street,city,state,zip].join(', '),addressComponents:{city,state,zip}});
const reply=rows=>async()=>({ok:true,json:async()=>({result:{addressMatches:rows}})});
const check=(address,rows)=>correctDeliveryAddress(address,{postal:false,useCache:false,fetcher:reply(rows)});

test('all states and DC support a normalized state name and an address lookup',async()=>{
  for(const s of states){
    assert.equal(stateCode(s.name.toLowerCase()),s.code);
    const r=await check({...original,state:s.name},[row('149 CHURCH ST','BURLINGTON',s.code)]);
    assert.equal(r.status,'matched');assert.equal(r.address.state,s.code);
  }
});
test('standardizes formatting and keeps inline and separate unit identifiers',async()=>{
  const result=await check({...original,address_line_1:'  149   Church Street, Apt 2B ',address_line_2:''},[row()]);
  assert.equal(result.status,'matched');assert.equal(result.address.address_line_2,'APT 2B');
  assert.equal((await check({...original,address_line_1:'149 Church Street # 5'},[row()])).status,'needs_input');
});
test('fills missing locality from a street match, never a ZIP by itself',async()=>{
  const r=await check({...original,city:'',state:''},[row()]);
  assert.deepEqual(r.fill,['city','state']);assert.equal(r.status,'matched');
  assert.equal(fillAddressFields({state:'NY'},r.address,r.fill).state,'NY');
  assert.equal(readyToCheck({...original,address_line_1:''}),false);
});
test('a corrected street, city, or ZIP needs the customer to select it',async()=>{
  for(const changed of [{city:'Burligton'},{address_line_1:'149 Chruch St'},{postal_code:'05402-1234'}]){
    const r=await check({...original,...changed},[row()]);assert.equal(r.status,'suggestion');
    assert.equal(r.address.postal_code,'05401');assert.equal(r.address.address_line_2,'APT 2B');
  }
});
test('unrelated street or city, changed house or ambiguous match cannot be assigned',async()=>{
  for(const rows of [[row('199 CHURCH ST')],[row('149 OCEAN DR')],[row('149 CHURCH ST','SOMEWHERE','CA','90210')],[row(),row('149 CHURCH ST','SOUTH BURLINGTON')]]){
    assert.equal((await check(original,rows)).status,'needs_input');
  }
  assert.equal((await check(original,[{...row(),tigerLine:{tigerLineId:'100',side:'L'}},{...row(),tigerLine:{tigerLineId:'200',side:'L'}}])).status,'needs_input');
});
test('ZIP+4 survives an unchanged five-digit ZIP, and a hyphenated house number stays intact',async()=>{
  const a={...original,address_line_1:'32-01 30th Avenue',state:'NY',city:'Astoria',postal_code:'111031234'};
  const r=await check(a,[row('32-01 30TH AVE','ASTORIA','NY','11103')]);assert.equal(r.address.postal_code,'11103-1234');
  assert.equal((await check(a,[row('3201 30TH AVE','ASTORIA','NY','11103')])).status,'needs_input');
});
test('ambiguous fallback lookups and service outages leave the original untouched',async()=>{
  let calls=0;
  const result=await correctDeliveryAddress(original,{useCache:false,postal:false,fetcher:async()=>reply(calls++===0?[]:calls===2?[row()]:[row('149 CHURCH ST','WINOOSKI')])()});
  assert.equal(result.status,'needs_input');
  assert.equal((await correctDeliveryAddress(original,{useCache:false,postal:false,fetcher:async()=>{throw Error();}})).status,'unavailable');
});
test('delivery-point checks require confirmation of an apartment when USPS flags it',()=>{
  for(const flag of ['D','S','N',''])assert.equal(readPostalMatch({additionalInfo:{DPVConfirmation:flag}}).status,'needs_input');
  const r=readPostalMatch({additionalInfo:{DPVConfirmation:'Y'},address:{streetAddress:'149 CHURCH ST',secondaryAddress:'APT 2B',city:'BURLINGTON',state:'VT',ZIPCode:'05401',ZIPPlus4:'1234'}});
  assert.equal(r.precision,'delivery_point');assert.equal(r.address.postal_code,'05401-1234');
});

test('a spelled-out Fifth Avenue is recognized at the same New York address',async()=>{
  const a={...original,address_line_1:'350 Fifth Avenue',city:'New York',state:'NY',postal_code:'10118'};
  const r=await check(a,[row('350 5TH AVE','NEW YORK','NY','10118')]);assert.equal(r.status,'matched');
});
