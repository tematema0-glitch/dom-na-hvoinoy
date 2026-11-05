import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarNightPrice, formatCalendarNightPrice } from '../public/admin-price-calendar.js';

const pricing=Object.freeze({
  weekday:23000,friday:30000,saturday:34000,
  dates:{'2026-11-27':15000,'2026-12-31':100000,'2027-01-02':0}
});
test('admin calendar badges use correct base rates for every day of week',()=>{
  assert.deepEqual(calendarNightPrice(pricing,'2026-11-05'),{price:23000,special:false});
  assert.deepEqual(calendarNightPrice(pricing,'2026-11-06'),{price:30000,special:false});
  assert.deepEqual(calendarNightPrice(pricing,'2026-11-07'),{price:34000,special:false});
  assert.deepEqual(calendarNightPrice(pricing,'2026-11-08'),{price:23000,special:false});
});
test('special nightly prices take precedence, including December and the new year',()=>{
  assert.deepEqual(calendarNightPrice(pricing,'2026-11-27'),{price:15000,special:true});
  assert.deepEqual(calendarNightPrice(pricing,'2026-12-31'),{price:100000,special:true});
  assert.deepEqual(calendarNightPrice(pricing,'2027-01-02'),{price:0,special:true});
  assert.equal(pricing.dates['2026-12-31'],100000,'reading prices never mutates stored values');
});
test('invalid dates and missing prices are not displayed as genuine rates',()=>{
  for(const day of ['2026-02-29','2026-00-01','2026-13-01','2026-11-32','05/11/2026',''])assert.equal(calendarNightPrice(pricing,day),null);
  assert.equal(calendarNightPrice({weekday:'NaN',friday:30000,saturday:34000,dates:{}},'2026-11-05'),null);
});
test('Russian prices remain readable and correctly formatted',()=>{
  assert.equal(formatCalendarNightPrice(23000).replace(/\s/g,''),'23000');
  assert.equal(formatCalendarNightPrice(36150).replace(/\s/g,''),'36150');
  assert.equal(formatCalendarNightPrice(100000).replace(/\s/g,''),'100000');
  assert.equal(formatCalendarNightPrice(1000000),'1 млн');
  assert.equal(formatCalendarNightPrice(-100),'');
});
