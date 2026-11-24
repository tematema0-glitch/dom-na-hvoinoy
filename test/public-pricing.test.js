import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isConfiguredPricing } from '../public/pricing-state.js';
import { handlePricingAction } from '../pricing-updates.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('only complete configured tariffs may be displayed',()=>{
 const valid={weekday:20000,friday:25000,saturday:30000,dates:{'2026-12-31':50000}};
 assert.equal(isConfiguredPricing(valid),true);
 assert.equal(isConfiguredPricing({...valid,weekday:27000}),true);
 for(const p of [null,{}, {dates:{}},{...valid,weekday:null},{...valid,friday:'25000'},{...valid,saturday:NaN},{...valid,dates:[]},{...valid,dates:{'2026-12-31':null}}])assert.equal(isConfiguredPricing(p),false);
});
test('initial page and client bundle do not display hardcoded fallback rates',()=>{
 const html=read('public/index.html');
 const club=read('public/_next/static/chunks/club-BLXHq565.js');
 const entry=read('public/_next/static/chunks/index-CzOB0V2F.js');
 assert.match(html,/<strong>Цена уточняется<\/strong>/);
 assert.match(html,/<div class="tariffs"><div>Вс–чт<strong>—<\/strong><\/div><div>Пятница<strong>—<\/strong><\/div><div>Суббота<strong>—<\/strong>/);
 assert.doesNotMatch(club,/weekday:23e3|friday:3e4|saturday:34e3|\?\?23e3|\?\?3e4|\?\?34e3/);
 assert.ok(club.includes('hasLivePricing(prices)'));
 assert.ok(club.includes('cache:`no-store`'));
 assert.ok(html.includes('index-CzOB0V2F.js?v=pricing-20261125'));
 assert.ok(entry.includes('club-BLXHq565.js?v=pricing-20261125'));
});
test('missing configuration is initialized only by explicit ordinary tariffs',async()=>{
 let current;let pending;
 const db={async connect(){return {async query(sql,args=[]){
  if(sql==='BEGIN')pending=current;
  if(sql.startsWith('INSERT INTO settings')&&!current)current=args[0];
  if(sql.includes('FOR UPDATE'))return {rows:[{value:current}]};
  if(sql.startsWith('UPDATE settings'))current=args[0];
  if(sql==='ROLLBACK')current=pending;
  return {rows:[]};
 },release(){}}}};
 await assert.rejects(handlePricingAction(db,{action:'setDatePrice',date:'2026-12-31',price:50000}),e=>e.status===400);
 assert.equal(current,undefined);
 await assert.rejects(handlePricingAction(db,{action:'setPrices',weekday:'',friday:25000,saturday:30000}),e=>e.status===400);
 await handlePricingAction(db,{action:'setPrices',weekday:20000,friday:25000,saturday:30000});
 assert.deepEqual(current,{weekday:20000,friday:25000,saturday:30000,dates:{}});
 await handlePricingAction(db,{action:'setDatePrice',date:'2026-12-31',price:50000});
 assert.equal(current.dates['2026-12-31'],50000);
});
