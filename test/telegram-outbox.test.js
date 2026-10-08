import test from 'node:test';
import assert from 'node:assert/strict';
import {
 sendTelegramOutbox,
 telegramOutboxRetryDelaySeconds,
 TELEGRAM_OUTBOX_MAX_ATTEMPTS,
 TELEGRAM_OUTBOX_RETRY_MAX_SECONDS
} from '../telegram-outbox.js';

process.env.TELEGRAM_BOT_TOKEN='test-token';
process.env.TELEGRAM_OWNER_CHAT_ID='test-chat';

function makePool(rows,clock){
 const selected=[];
 const client={
  async query(sql,values=[]){
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[]};
   if(sql.includes('FROM telegram_outbox')){
    assert.match(sql,/ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END/);
    assert.match(sql,/LIMIT 10 FOR UPDATE SKIP LOCKED/);
    const [forceRetry,maxAttempts]=values;
    const due=rows.filter(row=>row.state==='pending'||(
     row.state==='failed'&&(forceRetry||(
      row.attempts<maxAttempts&&
      clock.now-row.attemptedAt>=telegramOutboxRetryDelaySeconds(row.attempts)*1000
     ))
    ));
    due.sort((a,b)=>{
     if(a.state!==b.state)return a.state==='pending'?-1:1;
     return (a.attemptedAt??-Infinity)-(b.attemptedAt??-Infinity)||a.id-b.id;
    });
    selected.push(due.slice(0,10).map(row=>row.id));
    return{rows:due.slice(0,10)};
   }
   if(sql.includes("SET state='sent'")||sql.includes("SET state='failed'")){
    const row=rows.find(item=>item.id===values[0]);
    assert.ok(row,'updated outbox row exists');
    row.state=sql.includes("SET state='sent'")?'sent':'failed';
    row.attempts++;
    row.attemptedAt=clock.now;
    return{rows:[]};
   }
   throw new Error(`Unexpected query: ${sql}`);
  },
  release(){}
 };
 return{pool:{connect:async()=>client},selected};
}

function outboxRow(id,{state='pending',attempts=0,attemptedAt=null}={}){
 return{
  id,state,attempts,attemptedAt,booking_id:`booking-${id}`,
  payload:{id:`booking-${id}`,name:`Guest ${id}`,phone:'+79000000000',arrival:'2026-11-01',departure:'2026-11-02',guests:2,total:23000}
 };
}

test('retry delays grow exponentially and stop growing at the cap',()=>{
 assert.equal(telegramOutboxRetryDelaySeconds(1),60);
 assert.equal(telegramOutboxRetryDelaySeconds(2),120);
 assert.equal(telegramOutboxRetryDelaySeconds(3),240);
 assert.equal(telegramOutboxRetryDelaySeconds(TELEGRAM_OUTBOX_MAX_ATTEMPTS),TELEGRAM_OUTBOX_RETRY_MAX_SECONDS);
 assert.equal(telegramOutboxRetryDelaySeconds(30),TELEGRAM_OUTBOX_RETRY_MAX_SECONDS);
});

test('pending messages have priority and failed Telegram sends remain retryable',async()=>{
 const clock={now:Date.parse('2026-10-08T18:00:00Z')};
 const rows=Array.from({length:11},(_,index)=>outboxRow(index+1));
 rows.push(outboxRow(20,{state:'failed',attempts:1,attemptedAt:clock.now-60000}));
 const {pool,selected}=makePool(rows,clock);
 const sent=[];
 await sendTelegramOutbox({
  pool,
  telegram:async(method,payload)=>{sent.push(payload);throw new Error('temporary Telegram failure');},
  logger:{error(){}}
 });
 assert.deepEqual(selected[0],Array.from({length:10},(_,index)=>index+1));
 assert.equal(sent.length,10);
 assert.equal(rows[0].state,'failed');
 assert.equal(rows[0].attempts,1);
 assert.equal(rows.find(row=>row.id===20).attempts,1);
 assert.equal(rows.find(row=>row.id===20).state,'failed');
});

test('automatic retry respects backoff and attempt cap; manual retry can replay retained failures',async()=>{
 const clock={now:Date.parse('2026-10-08T18:00:00Z')};
 const notDue=outboxRow(1,{state:'failed',attempts:1,attemptedAt:clock.now-59000});
 const due=outboxRow(2,{state:'failed',attempts:1,attemptedAt:clock.now-60000});
 const exhausted=outboxRow(3,{state:'failed',attempts:TELEGRAM_OUTBOX_MAX_ATTEMPTS,attemptedAt:clock.now-86400000});
 const rows=[notDue,due,exhausted];
 const {pool,selected}=makePool(rows,clock);
 await sendTelegramOutbox({pool,telegram:async()=>{throw new Error('offline');},logger:{error(){}}});
 assert.deepEqual(selected[0],[2]);
 assert.equal(notDue.attempts,1);
 assert.equal(due.attempts,2);
 assert.equal(exhausted.attempts,TELEGRAM_OUTBOX_MAX_ATTEMPTS);
 assert.equal(exhausted.state,'failed');

 await sendTelegramOutbox({pool,telegram:async()=>{throw new Error('still offline');},logger:{error(){}},forceRetry:true});
 assert.deepEqual(selected[1],[3,1,2]);
 assert.equal(exhausted.attempts,TELEGRAM_OUTBOX_MAX_ATTEMPTS+1);
 assert.ok(rows.every(row=>row.state==='failed'));
});
