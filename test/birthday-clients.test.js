import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidISODate,ekaterinburgToday,upcomingBirthday,sortBirthdayClients,birthdayHint } from '../public/birthday-utils.js';
import { validateBirthdayRecord,validateBirthdayId,saveBirthdayRecord,deleteBirthdayRecord } from '../birthday-clients.js';

function normalizePhone(input){
 let p=String(input||'').replace(/\D/g,'');
 if(p.length===10)p='7'+p;
 if(p.length===11&&p[0]==='8')p='7'+p.slice(1);
 return /^7\d{10}$/.test(p)?p:null;
}
const id='11111111-1111-4111-8111-111111111111';
const client={name:'Анна Петрова',phone:'+7 (999) 123-45-67',birth_date:'1990-11-14',invitation_consent:false};
function fakeDb({samePhone=false,updateExists=true,deleteExists=true}={}){
 const queries=[];
 return {queries,async query(sql,params){
  queries.push({sql,params});
  if(sql.startsWith('INSERT'))return samePhone?{rowCount:0,rows:[]}:{rowCount:1,rows:[{id:params[0]}]};
  if(sql.startsWith('UPDATE'))return updateExists?{rowCount:1,rows:[{id:params[4]}]}:{rowCount:0,rows:[]};
  if(sql.startsWith('DELETE'))return deleteExists?{rowCount:1,rows:[{id:params[0]}]}:{rowCount:0,rows:[]};
  throw Error('Unrecognized SQL');
 }};
}
test('birth date rejects invalid days and accepts leap day',()=>{
 assert.equal(isValidISODate('2000-02-29'),true);
 for(const value of ['2026-02-29','2026-13-01','2026-11-31','12.05.1990','1990-1-1'])
  assert.equal(isValidISODate(value),false);
});
test('leap day birthday is March 1 in non leap years',()=>{
 assert.deepEqual(upcomingBirthday('2000-02-29','2026-02-27'),{nextDate:'2026-03-01',daysUntil:2});
 assert.deepEqual(upcomingBirthday('2000-02-29','2028-02-28'),{nextDate:'2028-02-29',daysUntil:1});
});
test('next birthday sorted correctly around new year and today',()=>{
 const clients=[
  {name:'Февраль',phone:'79992222222',birth_date:'1995-02-04'},
  {name:'Декабрь',phone:'79993333333',birth_date:'1991-12-31'},
  {name:'Январь',phone:'79991111111',birth_date:'1980-01-01'}
 ];
 assert.deepEqual(sortBirthdayClients(clients,'2026-12-30').map(x=>x.name),['Декабрь','Январь','Февраль']);
 assert.equal(upcomingBirthday('1980-11-05','2026-11-05').daysUntil,0);
 assert.deepEqual(clients[0],{name:'Февраль',phone:'79992222222',birth_date:'1995-02-04'});
});
test('today determined in Ekaterinburg timezone, not UTC or device timezone',()=>{
 assert.equal(ekaterinburgToday(new Date('2026-11-05T19:15:00Z')),'2026-11-06');
 assert.equal(ekaterinburgToday(new Date('2026-11-05T18:59:00Z')),'2026-11-05');
});
test('human-readable birthday countdown',()=>{
 assert.equal(birthdayHint(0),'Сегодня');
 assert.equal(birthdayHint(1),'Завтра');
 assert.equal(birthdayHint(2),'Через 2 дня');
 assert.equal(birthdayHint(5),'Через 5 дней');
 assert.equal(birthdayHint(21),'Через 21 день');
});
test('validate birthday customer safely and require an explicit consent flag',()=>{
 assert.deepEqual(validateBirthdayRecord(client,normalizePhone,'2026-11-05'),{
  name:'Анна Петрова',phone:'79991234567',birth_date:'1990-11-14',invitation_consent:false
 });
 const invalid=[
  {...client,phone:'123'},
  {...client,name:' '},
  {...client,name:'A'.repeat(81)},
  {...client,birth_date:'2040-01-01'},
  {...client,birth_date:'2026-02-29'},
  {...client,invitation_consent:undefined},
  {...client,invitation_consent:'yes'},
  {...client,name:'<script>\n</script>'}
 ];
 for(const candidate of invalid)assert.throws(()=>validateBirthdayRecord(candidate,normalizePhone,'2026-11-05'),error=>error.status===400);
});
test('create is parameterized and does not overwrite an existing phone',async()=>{
 const newOne=fakeDb();
 const result=await saveBirthdayRecord(newOne,client,normalizePhone,()=>id);
 assert.equal(result.id,id);
 assert.match(newOne.queries[0].sql,/ON CONFLICT \(phone\) DO NOTHING/);
 assert.equal(newOne.queries[0].params[2],'79991234567');
 await assert.rejects(saveBirthdayRecord(fakeDb({samePhone:true}),client,normalizePhone,()=>id),error=>error.status===409);
});
test('edit operates on the specific id; delete is explicit',async()=>{
 assert.equal(validateBirthdayId(id),id);
 assert.throws(()=>validateBirthdayId('something-other-than-uuid'),error=>error.status===400);
 const edits=fakeDb();
 await saveBirthdayRecord(edits,{...client,id,invitation_consent:true},normalizePhone,()=>{throw Error('should not generate an id');});
 assert.match(edits.queries[0].sql,/WHERE id=\$5/);
 assert.equal(edits.queries[0].params[3],true);
 const removal=fakeDb();
 await deleteBirthdayRecord(removal,id);
 assert.match(removal.queries[0].sql,/WHERE id=\$1 RETURNING id/);
 await assert.rejects(deleteBirthdayRecord(fakeDb({deleteExists:false}),id),error=>error.status===404);
});
