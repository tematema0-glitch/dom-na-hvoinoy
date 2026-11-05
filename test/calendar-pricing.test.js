import test from 'node:test';
import assert from 'node:assert/strict';
import { dateRangeInclusive, checkedNightlyPrice, changeDatePrices } from '../public/date-price-range.js';
import { handlePricingAction } from '../pricing-updates.js';
function fakePool(initial) {
  let current=initial;
  const queries=[];
  return { queries, read:()=>current, async connect() {
    return {async query(sql,params=[]) {
      queries.push(sql);
      if(sql.startsWith('INSERT INTO settings')&&!current)current=params[0];
      if(sql.includes('FOR UPDATE'))return {rows:[{value:current}]};
      if(sql.startsWith('UPDATE settings'))current=params[0];
      return {rows:[]};
    },release(){queries.push('RELEASE');}};
  }};
}
test('one date and inclusive calendar week',()=>{
  assert.deepEqual(dateRangeInclusive('2026-11-05','2026-11-05'),['2026-11-05']);
  assert.deepEqual(dateRangeInclusive('2026-11-09','2026-11-15'),['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15']);
  assert.deepEqual(dateRangeInclusive('2028-02-28','2028-03-01'),['2028-02-28','2028-02-29','2028-03-01']);
  for(const [a,b] of [['2026-11-15','2026-11-09'],['2026-02-29','2026-03-01'],['2026-01-01','2028-01-01']])assert.throws(()=>dateRangeInclusive(a,b));
});
test('reject non-integer or invalid nightly prices',()=>{
  assert.equal(checkedNightlyPrice('30000'),30000);
  for(const value of ['',0,-1,5.5,'0','1.5','2e4',1000001])assert.throws(()=>checkedNightlyPrice(value));
});
test('bulk price change preserves unrelated price overrides',async()=>{
  const db=fakePool({weekday:23000,friday:30000,saturday:34000,dates:{'2026-12-31':60000}});
  await handlePricingAction(db,{action:'setDatePricesRange',from:'2026-11-09',to:'2026-11-15',price:41000});
  assert.equal(Object.keys(db.read().dates).length,8);
  for(const d of dateRangeInclusive('2026-11-09','2026-11-15'))assert.equal(db.read().dates[d],41000);
  assert.equal(db.read().dates['2026-12-31'],60000);
  assert.equal(db.read().weekday,23000);
  assert.ok(db.queries.some(sql=>sql.includes('FOR UPDATE')));
  assert.ok(db.queries.includes('COMMIT'));
});
test('reset selected nights and preserve ordinary rates',async()=>{
  const db=fakePool({weekday:23000,friday:30000,saturday:34000,dates:{'2026-11-09':41000,'2026-11-10':41000,'2026-12-31':60000}});
  await handlePricingAction(db,{action:'removeDatePricesRange',from:'2026-11-09',to:'2026-11-10'});
  assert.deepEqual(db.read().dates,{'2026-12-31':60000});
  await handlePricingAction(db,{action:'setDatePrice',date:'2026-11-09',price:25000});
  assert.equal(db.read().dates['2026-11-09'],25000);
});
test('reject invalid range before touching database',async()=>{
  const db=fakePool();
  await assert.rejects(handlePricingAction(db,{action:'setDatePricesRange',from:'2026-11-13',to:'2026-11-10',price:23000}),e=>e.status===400);
  assert.equal(db.queries.length,0);
});
test('helpers do not mutate original pricing settings',()=>{
  const original={weekday:23000,dates:{'2026-12-31':40000}};
  const updated=changeDatePrices(original,['2026-11-10','2026-11-11'],27000);
  assert.equal(original.dates['2026-11-10'],undefined);
  assert.equal(updated.dates['2026-12-31'],40000);
});
