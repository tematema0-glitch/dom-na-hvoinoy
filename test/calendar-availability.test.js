import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAvailabilityChange,parseAvailabilityChange } from '../calendar-availability.js';
import { summarizeAvailability,singleCalendarNightSelection,calendarCheckoutNights,selectAvailabilityCalendarClick } from '../public/admin-availability-calendar.js';

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


test('a click on 11 December selects only the night of 11 December',()=>{
  assert.deepEqual(singleCalendarNightSelection('2026-12-11'),{from:'2026-12-11',to:'2026-12-11'});
  assert.deepEqual(singleCalendarNightSelection('2026-12-12'),{from:'2026-12-12',to:'2026-12-12'});
  assert.equal(singleCalendarNightSelection('2026-02-30'),null);
});

test('11 December can be closed even when 12 December is manually closed',async()=>{
  const neighbor={id:'next',arrival:'2026-12-12',departure:'2026-12-13',kind:'blocked',note:'12 December unavailable'};
  const {client,state,identifier}=clientFixture({blocks:[neighbor]});
  const before=summarizeAvailability({blocks:state.blocks,bookings:[],rewards:[]},'2026-12-11','2026-12-11');
  assert.equal(before.canClose,true);
  const result=await applyAvailabilityChange(client,{operation:'close',from:'2026-12-11',to:'2026-12-11'},identifier);
  assert.equal(result.affectedNights,1);
  assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure]).sort(),[['2026-12-11','2026-12-12'],['2026-12-12','2026-12-13']]);
  await applyAvailabilityChange(client,{operation:'open',from:'2026-12-11',to:'2026-12-11'},identifier);
  assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure]),[['2026-12-12','2026-12-13']]);
});

test('11 December can be closed before a confirmed stay or reward on 12 December',async()=>{
  for(const fixtures of [{bookings:[{arrival:'2026-12-12',departure:'2026-12-13'}]},{rewards:[{date:'2026-12-12'}]}]){
    const {client,state,identifier}=clientFixture(fixtures);
    const summary=summarizeAvailability({blocks:[],bookings:fixtures.bookings||[],rewards:fixtures.rewards||[]},'2026-12-11','2026-12-11');
    assert.equal(summary.canClose,true);
    await applyAvailabilityChange(client,{operation:'close',from:'2026-12-11',to:'2026-12-11'},identifier);
    assert.deepEqual(state.blocks.map(b=>[b.arrival,b.departure]),[['2026-12-11','2026-12-12']]);
    await assert.rejects(applyAvailabilityChange(client,{operation:'close',from:'2026-12-12',to:'2026-12-12'},identifier),e=>e.status===409);
  }
});

test('two calendar taps 11 -> 12 Dec close only 11 Dec and leave 12 Dec blocked',async()=>{
  const first=selectAvailabilityCalendarClick(null,'2026-12-11');
  assert.deepEqual(first,{arrival:'2026-12-11',checkout:'2026-12-12',complete:false});
  const second=selectAvailabilityCalendarClick(first,'2026-12-12');
  assert.deepEqual(second,{arrival:'2026-12-11',checkout:'2026-12-12',complete:true});
  const selected=calendarCheckoutNights(second.arrival,second.checkout);
  assert.deepEqual(selected,['2026-12-11']);
  const {client,state,identifier}=clientFixture({blocks:[{id:'blocked12',arrival:'2026-12-12',departure:'2026-12-13',kind:'blocked',note:'existing'}]});
  assert.equal(summarizeAvailability({blocks:state.blocks,bookings:[],rewards:[]},selected[0],selected.at(-1)).canClose,true);
  await applyAvailabilityChange(client,{operation:'close',from:selected[0],to:selected.at(-1)},identifier);
  assert.deepEqual(state.blocks.map(x=>[x.arrival,x.departure]).sort(),[['2026-12-11','2026-12-12'],['2026-12-12','2026-12-13']]);
});
test('checkout dates are exclusive, and a third tap starts fresh',()=>{
  assert.deepEqual(calendarCheckoutNights('2026-12-11','2026-12-12'),['2026-12-11']);
  assert.deepEqual(calendarCheckoutNights('2026-12-31','2027-01-02'),['2026-12-31','2027-01-01']);
  assert.equal(calendarCheckoutNights('2026-12-11','2026-12-11'),null);
  assert.equal(calendarCheckoutNights('2026-12-11','2026-02-30'),null);
  const start=selectAvailabilityCalendarClick(null,'2026-12-11');
  const selection=selectAvailabilityCalendarClick(start,'2026-12-13');
  assert.deepEqual(calendarCheckoutNights(selection.arrival,selection.checkout),['2026-12-11','2026-12-12']);
  const blocked={blocks:[{arrival:'2026-12-12',departure:'2026-12-13'}],bookings:[],rewards:[]};
  assert.equal(summarizeAvailability(blocked,'2026-12-11','2026-12-12').canClose,false);
  assert.deepEqual(selectAvailabilityCalendarClick(selection,'2026-12-14'),{arrival:'2026-12-14',checkout:'2026-12-15',complete:false});
});
test('guest checkout day remains available with confirmed next-day arrivals',()=>{
  const confirmed={blocks:[],bookings:[{arrival:'2026-12-12',departure:'2026-12-13'}],rewards:[]};
  const days=calendarCheckoutNights('2026-12-11','2026-12-12');
  assert.equal(summarizeAvailability(confirmed,days[0],days.at(-1)).canClose,true);
  assert.equal(summarizeAvailability(confirmed,'2026-12-12','2026-12-12').hasProtectedDates,true);
});
