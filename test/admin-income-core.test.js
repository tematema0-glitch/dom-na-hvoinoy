import test from 'node:test';
import assert from 'node:assert/strict';
import {incomeWindow,buildIncomeReport,incomeChartSeries,CLEANING_COST_PER_NIGHT} from '../public/admin-income-core.js';

const prices={weekday:23000,friday:30000,saturday:34000,dates:{}};
const today='2026-12-31';
const empty={blocks:[],avito:[],bookings:[],rewards:[]};
const report=(availability,options={})=>buildIncomeReport({availability,pricing:prices,mode:'month',month:'2026-12',today,...options});

test('deducts 3000 for EACH night, then divides the remainder by two',()=>{
 const data={...empty,avito:[{arrival:'2026-12-11',departure:'2026-12-14'}]};
 const result=report(data);
 // Fri 30k + Sat 34k + Sun 23k: (87k - 3 x 3k) / 2 = 39k.
 assert.equal(result.nights,3);
 assert.equal(result.gross,87000);
 assert.equal(result.expenses,9000);
 assert.equal(result.share,39000);
 assert.deepEqual(result.rows.map(row=>row.share),[13500,15500,10000]);
});

test('nightly special prices override weekday tariffs',()=>{
 const data={...empty,avito:[{arrival:'2026-12-11',departure:'2026-12-14'}]};
 const result=buildIncomeReport({availability:data,pricing:{...prices,dates:{'2026-12-12':40000}},mode:'month',month:'2026-12',today});
 assert.equal(result.gross,93000);
 assert.equal(result.expenses,9000);
 assert.equal(result.share,42000);
});

test('check-out date is open: adjacent Avito, manual and site stays are three distinct nights',()=>{
 const data={...empty,blocks:[{arrival:'2026-12-11',departure:'2026-12-12',kind:'booked'}],
   avito:[{arrival:'2026-12-12',departure:'2026-12-13'}],
   bookings:[{arrival:'2026-12-13',departure:'2026-12-14'}]};
 const result=report(data);
 assert.deepEqual(result.rows.map(item=>item.source),['manualBooked','avito','site']);
 assert.equal(result.nights,3);
 assert.equal(result.share,39000);
});

test('a single occupied date appearing on multiple calendars counts once',()=>{
 const data={...empty,blocks:[{arrival:'2026-12-12',departure:'2026-12-13',kind:'blocked'}],
  avito:[{arrival:'2026-12-12',departure:'2026-12-13'}],
  bookings:[{arrival:'2026-12-12',departure:'2026-12-13'}]};
 const result=report(data);
 assert.equal(result.nights,1);
 assert.equal(result.share,15500);
 assert.equal(result.sources.site,1);
 assert.equal(result.overlapNights,1);
});

test('manual "blocked" nights may be excluded without dropping confirmed manual bookings',()=>{
 const data={...empty,blocks:[
 {arrival:'2026-12-15',departure:'2026-12-16',kind:'blocked'},
 {arrival:'2026-12-16',departure:'2026-12-17',kind:'booked'}
 ]};
 const all=report(data);
 const bookedOnly=report(data,{includeManualBlocked:false});
 assert.equal(all.nights,2);
 assert.equal(bookedOnly.nights,1);
 assert.equal(bookedOnly.excludedManual,1);
 assert.equal(bookedOnly.sources.manualBooked,1);
 assert.equal(bookedOnly.sources.manualBlocked,0);
});

test('confirmed bonus stays are not counted as received money',()=>{
 const data={...empty,avito:[{arrival:'2026-12-15',departure:'2026-12-16'}],rewards:[{date:'2026-12-15'}]};
 const result=report(data);
 assert.equal(result.nights,0);
 assert.equal(result.gross,0);
 assert.equal(result.share,0);
 assert.equal(result.excludedRewards,1);
});

test('future closed dates are excluded unless explicitly requested',()=>{
 const data={...empty,avito:[{arrival:'2026-12-11',departure:'2026-12-14'}]};
 const past=report(data,{today:'2026-12-11'});
 const withFuture=report(data,{today:'2026-12-11',includeFuture:true});
 assert.equal(past.nights,1);
 assert.equal(past.excludedFuture,2);
 assert.equal(past.share,13500);
 assert.equal(withFuture.nights,3);
 assert.equal(withFuture.share,39000);
});

test('week window and chart cross calendar year correctly',()=>{
 const window=incomeWindow('week','2027-01','2027-01-03');
 assert.deepEqual(window,{from:'2026-12-28',toExclusive:'2027-01-04'});
 const result=buildIncomeReport({availability:empty,pricing:prices,mode:'week',month:'2027-01',today:'2027-01-03'});
 assert.deepEqual(result.months.map(x=>x.month),['2026-12','2027-01']);
 assert.equal(incomeChartSeries(result).length,7);
});

test('3, 6 and 12 months have the correct number of monthly chart bars',()=>{
 for(const [mode,n] of [['quarter',3],['half',6],['year',12]]){
  const result=buildIncomeReport({availability:empty,pricing:prices,mode,month:'2026-12',today});
  assert.equal(result.months.length,n);
  assert.equal(incomeChartSeries(result).length,n);
  assert.equal(result.nights,0);
 }
});

test('zero or low rates preserve the EXACT formula instead of silently clamping to zero',()=>{
 const data={...empty,avito:[{arrival:'2026-12-11',departure:'2026-12-12'}]};
 const result=buildIncomeReport({availability:data,pricing:{...prices,dates:{'2026-12-11':2000}},mode:'month',month:'2026-12',today});
 assert.equal(CLEANING_COST_PER_NIGHT,3000);
 assert.equal(result.gross,2000);
 assert.equal(result.expenses,3000);
 assert.equal(result.share,-500);
});

test('invalid windows are rejected, not converted into misleading earnings',()=>{
 assert.throws(()=>incomeWindow('year','2026-13',today),RangeError);
 assert.throws(()=>incomeWindow('fortnight','2026-12',today),RangeError);
 assert.throws(()=>report(empty,{today:'2026-02-30'}),RangeError);
});
