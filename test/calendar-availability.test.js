import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAvailabilityChange,parseAvailabilityChange } from '../calendar-availability.js';
import { summarizeAvailability } from '../public/admin-availability-calendar.js';

function clientFixture({blocks=[],bookings=[],rewards=[]}={}){
  const state={blocks:structuredClone(blocks),bookings:structuredClone(bookings),rewards:structuredClone(rewards),queries:[]};
  let count=0;
  const identifier=()=> 'new-'+(++count);
  const overlapped=(entry,from,to)=>entry.arrival<to&&entry.departure>from;
  const client={async query(sql,params=[]){
    state.queries.push({sql,params});
    if(sql.includes('FROM bookings WHERE')){
      assert.match(sql,/status IN \('confirmed','completed'\)/);
      return {rowCount:state.bookings.filter(r=>overlapped(r,params[0],params[1])).length,rows:[]};
    }
    if(sql.includes('FROM rewards WHERE')){
      assert.match(sql,/kind='stay'/);
      return {rowCount:state.rewards.filter(r=>r.date>=params[0]&&r.date<params[1]).length,rows:[]};
    }
    if(sql.startsWith('SELECT id FROM calendar_blocks')){
      const matching=state.blocks.filter(r=>overlapped(r,params[0],params[1]));
      return {rowCount:matching.length,rows:matching.map(r=>({id:r.id}))};
    }
    if(sql.startsWith('SELECT id,arrival::text,departure::text')){
      assert.match(sql,/FOR UPDATE/);
      const matching=state.blocks.filter(r=>overlapped(r,params[0],params[1]));
      return {rowCount:matching.length,rows:structuredClone(matching)};
    }
    if(sql.startsWith('DELETE FROM calendar_blocks')){
      state.blocks=state.blocks.filter(r=>r.id!==params[0]);
      return {rowCount:1,rows:[]};
    }
    if(sql.startsWith('INSERT INTO calendar_blocks')){
      const [id,arrival,departure,kind,note,created_at]=params;
      state.blocks.push({id,arrival,departure,kind,note,created_at:created_at||'2026-10-01T00:00:00Z'});
      return {rowCount:1,rows:[]};
    }
    throw Error('Unexpected SQL: '+sql);
  }};
  return {state,client,identifier};
}

test('a single click closes exactly one night and accepts booking-type manual notes',async()=>{
  const input={operation:'close',from:'2026-11-05',to:'2026-11-05',kind:'booked',note:'Бронь Авито'};
  const parsed=parseAvailabilityChange(input);
  assert.equal(parsed.departure,'2026-11-06');
  assert.equal(parsed.nights,1);
  const {client,state,identifier}=clientFixture();
  await applyAvailabilityChange(client,input,identifier);
  assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure,b.kind,b.note]),[['2026-11-05','2026-11-06','booked','Бронь Авито']]);
});

test('closing a date range uses exclusive departure, including new year',async()=>{
  const {client,state,identifier}=clientFixture();
  await applyAvailabilityChange(client,{operation:'close',from:'2026-12-29',to:'2027-01-02'},identifier);
  assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure]),[['2026-12-29','2027-01-03']]);
});

test('opening inside one manual block preserves remaining nights, kind, notes and creation date',async()=>{
  const original={id:'original',arrival:'2026-11-01',departure:'2026-11-11',kind:'booked',note:'Авито',created_at:'2026-10-12T04:00:00Z'};
  const {client,state,identifier}=clientFixture({blocks:[original]});
  const response=await applyAvailabilityChange(client,{operation:'open',from:'2026-11-04',to:'2026-11-06'},identifier);
  assert.equal(response.updatedBlocks,1);
  assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure]).sort(),[['2026-11-01','2026-11-04'],['2026-11-07','2026-11-11']]);
  assert.ok(state.blocks.every(b=>b.kind==='booked'&&b.note==='Авито'&&b.created_at===original.created_at));
  assert.ok(!state.blocks.some(b=>b.id===original.id));
});

test('opening multiple manual blocks only removes selected dates',async()=>{
  const blocks=[
    {id:'one',arrival:'2026-11-01',departure:'2026-11-04',kind:'blocked',note:'cleaning'},
    {id:'two',arrival:'2026-11-06',departure:'2026-11-10',kind:'blocked',note:'paint'}
  ];
  const {client,state,identifier}=clientFixture({blocks});
  await applyAvailabilityChange(client,{operation:'open',from:'2026-11-03',to:'2026-11-07'},identifier);
  assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure]).sort(),[['2026-11-01','2026-11-03'],['2026-11-08','2026-11-10']]);
  assert.equal(state.blocks[0].note,'cleaning');
  assert.equal(state.blocks[1].note,'paint');
});

test('real confirmed bookings are protected: neither opening nor closing touches storage',async()=>{
  for(const operation of ['open','close']){
    const {client,state,identifier}=clientFixture({bookings:[{arrival:'2026-11-05',departure:'2026-11-08'}],blocks:[{id:'x',arrival:'2026-11-01',departure:'2026-11-12',kind:'blocked',note:'note'}]});
    await assert.rejects(applyAvailabilityChange(client,{operation,from:'2026-11-06',to:'2026-11-06'},identifier),e=>e.status===409);
    assert.equal(state.blocks.length,1);
    assert.equal(state.queries.some(q=>q.sql.startsWith('DELETE ')||q.sql.startsWith('INSERT ')),false);
  }
});

test('approved complimentary nights cannot be accidentally opened',async()=>{
  const {client,state,identifier}=clientFixture({rewards:[{date:'2026-11-07'}],blocks:[{id:'x',arrival:'2026-11-06',departure:'2026-11-09',kind:'blocked',note:''}]});
  await assert.rejects(applyAvailabilityChange(client,{operation:'open',from:'2026-11-07',to:'2026-11-07'},identifier),e=>e.status===409);
  assert.equal(state.queries.some(q=>q.sql.startsWith('DELETE ')),false);
});

test('closing an occupied manual night and opening an already free night are rejected',async()=>{
  const original={id:'x',arrival:'2026-11-05',departure:'2026-11-08',kind:'blocked',note:''};
  const {client,state,identifier}=clientFixture({blocks:[original]});
  await assert.rejects(applyAvailabilityChange(client,{operation:'close',from:'2026-11-06',to:'2026-11-09'},identifier),e=>e.status===409);
  await assert.rejects(applyAvailabilityChange(client,{operation:'open',from:'2026-11-15',to:'2026-11-16'},identifier),e=>e.status===409);
  assert.deepEqual(state.blocks,[original]);
});

test('invalid and excessive range is rejected before reading or writing database',async()=>{
  for(const x of [
    {operation:'open',from:'2026-02-30',to:'2026-03-01'},
    {operation:'close',from:'2026-11-08',to:'2026-11-06'},
    {operation:'close',from:'2026-01-01',to:'2027-01-01'},
    {operation:'delete',from:'2026-11-08',to:'2026-11-08'},
    {operation:'close',from:'2026-11-08',to:'2026-11-08',note: 'x'.repeat(201)}
  ]){
    const {client,state,identifier}=clientFixture();
    await assert.rejects(applyAvailabilityChange(client,x,identifier),e=>e.status===400);
    assert.deepEqual(state.queries,[]);
  }
});

test('front-end selection identifies manual marks separately from confirmed bookings',()=>{
  const data={blocks:[{arrival:'2026-11-05',departure:'2026-11-08'}],
    bookings:[{arrival:'2026-11-09',departure:'2026-11-11'}],rewards:[{date:'2026-11-14'}]};
  const manuallyBlocked=summarizeAvailability(data,'2026-11-06','2026-11-07');
  assert.equal(manuallyBlocked.manualNights,2);
  assert.equal(manuallyBlocked.canOpen,true);
  assert.equal(manuallyBlocked.canClose,false);
  assert.equal(summarizeAvailability(data,'2026-11-09','2026-11-09').hasProtectedDates,true);
  assert.equal(summarizeAvailability(data,'2026-11-14','2026-11-14').canOpen,false);
  assert.equal(summarizeAvailability(data,'2026-11-15','2026-11-15').canClose,true);
});
