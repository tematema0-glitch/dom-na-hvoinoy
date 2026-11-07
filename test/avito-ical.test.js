import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAvitoIcal,syncAvitoCalendar,AVITO_POLL_MS} from '../avito-ical.js';

const event=(from,to,extras='')=>[
 'BEGIN:VEVENT','UID:test@example.net',
 'DTSTART;VALUE=DATE:'+from,'DTEND;VALUE=DATE:'+to,
 ...(extras?[extras]:[]),'END:VEVENT'
].join('\r\n');
const calendar=(...events)=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events.join('\r\n')+'\r\nEND:VCALENDAR\r\n';
function response(body,{status=200}={}){
 return {ok:status>=200&&status<300,status,headers:{get:()=>String(Buffer.byteLength(body,'utf8'))},text:async()=>body};
}
function fixture(){
 const state={blocks:[{arrival:'2026-12-05',departure:'2026-12-06'}],
  imported_ranges:1,empty_confirmations:0,error:null,attempts:0,successes:0};
 async function query(sql,params=[]){
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT imported_ranges,empty_confirmations FROM avito_calendar_sync')){
   return {rowCount:1,rows:[{imported_ranges:state.imported_ranges,empty_confirmations:state.empty_confirmations}]};
  }
  if(sql.startsWith('DELETE FROM avito_calendar_blocks')){state.blocks=[];return {rowCount:1,rows:[]};}
  if(sql.startsWith('INSERT INTO avito_calendar_blocks')){
   state.blocks=params[0].map((arrival,index)=>({arrival,departure:params[1][index]}));
   return {rowCount:state.blocks.length,rows:[]};
  }
  if(sql.includes('empty_confirmations=1')){
   state.empty_confirmations=1;state.error='Пустая выгрузка';state.attempts++;return {rowCount:1,rows:[]};
  }
  if(sql.includes('last_success_at=now()')){
   state.successes++;state.attempts++;state.error=null;
   state.imported_ranges=params[0];state.empty_confirmations=0;return {rowCount:1,rows:[]};
  }
  if(sql.includes('last_attempt_at=now(),last_error=$1')){
   state.error=params[0];state.attempts++;return {rowCount:1,rows:[]};
  }
  throw Error('Unexpected SQL '+sql);
 }
 return {state,pool:{connect:async()=>({query,release(){}}),query}};
}

test('Avito iCal imports [arrival, checkout) and keeps checkout open',()=>{
 const blocks=parseAvitoIcal(calendar(event('20261211','20261212'),event('20261213','20261215')));
 assert.deepEqual(blocks,[{arrival:'2026-12-11',departure:'2026-12-12'},{arrival:'2026-12-13',departure:'2026-12-15'}]);
 assert.ok(blocks.every(b=>b.departure>b.arrival));
});
test('touching intervals merge and cancelled/transparent events are ignored',()=>{
 const blocks=parseAvitoIcal(calendar(
  event('20261211','20261212'),event('20261212','20261215'),
  event('20261218','20261219','STATUS:CANCELLED'),
  event('20261220','20261221','TRANSP:TRANSPARENT')
 ));
 assert.deepEqual(blocks,[{arrival:'2026-12-11',departure:'2026-12-15'}]);
});
test('all-day dates roll correctly across New Year',()=>{
 assert.deepEqual(parseAvitoIcal(calendar(event('20261231','20270102'))),[{arrival:'2026-12-31',departure:'2027-01-02'}]);
});
test('UTC timed events are interpreted in Ekaterinburg',()=>{
 const timed='BEGIN:VEVENT\r\nDTSTART:20261211T193000Z\r\nDTEND:20261212T193000Z\r\nEND:VEVENT';
 assert.deepEqual(parseAvitoIcal(calendar(timed)),[{arrival:'2026-12-12',departure:'2026-12-13'}]);
});
test('refuses malformed, recurring, missing and reversed ranges rather than clearing dates',()=>{
 for(const bad of [
  '<html>Avito denied</html>',
  calendar('BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261211\r\nEND:VEVENT'),
  calendar(event('20261311','20261312')),
  calendar(event('20261212','20261211')),
  calendar(event('20261211','20261212','RRULE:FREQ=DAILY')),
  calendar(event('20261211','20261211'))
 ])assert.throws(()=>parseAvitoIcal(bad));
});
test('poll every 15 minutes and persist only dates, not guest details',async()=>{
 assert.equal(AVITO_POLL_MS,900000);
 const {state,pool}=fixture();
 const sample=calendar(event('20261211','20261212'));
 const result=await syncAvitoCalendar(pool,async()=>response(sample));
 assert.equal(result.ok,true);
 assert.equal(result.importedRanges,1);
 assert.deepEqual(state.blocks,[{arrival:'2026-12-11',departure:'2026-12-12'}]);
 assert.equal(state.successes,1);
});
test('first empty response keeps old dates; second valid empty confirms clearing',async()=>{
 const {state,pool}=fixture();
 const empty=calendar();
 const first=await syncAvitoCalendar(pool,async()=>response(empty));
 assert.equal(first.pendingEmpty,true);
 assert.deepEqual(state.blocks,[{arrival:'2026-12-05',departure:'2026-12-06'}]);
 assert.equal(state.empty_confirmations,1);
 const second=await syncAvitoCalendar(pool,async()=>response(empty));
 assert.equal(second.ok,true);
 assert.deepEqual(state.blocks,[]);
 assert.equal(state.imported_ranges,0);
});
test('network failure and invalid calendar never delete last successful snapshot',async()=>{
 const {state,pool}=fixture();
 await assert.rejects(syncAvitoCalendar(pool,async()=>{throw new Error('network down');}));
 assert.deepEqual(state.blocks,[{arrival:'2026-12-05',departure:'2026-12-06'}]);
 await assert.rejects(syncAvitoCalendar(pool,async()=>response('<html>Bad gateway</html>')));
 assert.deepEqual(state.blocks,[{arrival:'2026-12-05',departure:'2026-12-06'}]);
 assert.ok(state.error);
});
