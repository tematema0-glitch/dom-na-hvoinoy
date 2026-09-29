import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const app = express();
const pool = process.env.DATABASE_URL ? new Pool({
 connectionString: process.env.DATABASE_URL,
 connectionTimeoutMillis: 5000,
 idleTimeoutMillis: 30000,
 max: 10,
 ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
}) : null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();
const json = express.json({ limit: '256kb' });
app.use(json);
pool?.on('error', e => console.error('Unexpected PostgreSQL pool error', e.code || e.name));

const id = () => crypto.randomUUID();
const phone = v => { let p=String(v||'').replace(/\D/g,''); if(p.length===10)p='7'+p; if(p.length===11&&p[0]==='8')p='7'+p.slice(1); return /^7\d{10}$/.test(p)?p:null; };
const cookie = req => Object.fromEntries(String(req.headers.cookie || '').split(';').flatMap(v=>{const i=v.indexOf('=');if(i<0)return[];try{return[[v.slice(0,i).trim(),decodeURIComponent(v.slice(i+1).trim())]]}catch{return[]}}));
function isAdmin(req){ const t=cookie(req).hvoinaya_admin; const s=t&&sessions.get(t); if(!s)return false;if(s<=Date.now()){sessions.delete(t);return false;}return true; }
function requireAdmin(req,res){ if(!isAdmin(req)){res.status(401).json({error:'Требуется вход владельца'});return false} return true; }
function isDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;}
function nights(a,b){ if(!isDate(a)||!isDate(b))return 0;return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000); }
function validRange(a,b){return nights(a,b)>0;}
async function transaction(work){const client=await pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
async function lockBookingDates(client){await client.query("SELECT pg_advisory_xact_lock(hashtext('dom-na-hvoinoy-booking-dates'))");}
function cookieHeader(req,token,maxAge){const secure=process.env.NODE_ENV==='production'||req.secure;return `hvoinaya_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;}
async function pricing(queryable=pool){ const r=await queryable.query("SELECT value FROM settings WHERE key='pricing'"); return r.rows[0]?.value || {weekday:23000,friday:30000,saturday:34000,dates:{}}; }
function stayPrice(a,b,g,p,firstReferral=false){ let total=0; for(let d=new Date(a+'T00:00:00Z'),end=new Date(b+'T00:00:00Z');d<end;d.setUTCDate(d.getUTCDate()+1)){ const ds=d.toISOString().slice(0,10); const dow=d.getUTCDay(); let base=Number(p.dates?.[ds] ?? (dow===5?p.friday:dow===6?p.saturday:p.weekday)); total += base + Math.max(0,Number(g)-12)*1000 - (firstReferral?2000:0); } return Math.max(0,total); }
async function balances(){ const q=await pool.query(`SELECT m.id, COALESCE(SUM(CASE WHEN l.kind='earned' THEN l.points WHEN l.kind IN ('deducted','reserved','spent') THEN -l.points WHEN l.kind='release' THEN l.points ELSE 0 END),0)::int balance FROM members m LEFT JOIN point_ledger l ON l.member_id=m.id GROUP BY m.id`); return Object.fromEntries(q.rows.map(x=>[x.id,x.balance])); }
async function invitedGuests(memberId){const q=await pool.query(`SELECT name,COUNT(*) FILTER(WHERE status<>'cancelled' AND archived=false)::int stays,COUNT(*) FILTER(WHERE status='completed' AND archived=false)::int completed_stays,COALESCE(SUM(nights) FILTER(WHERE status='completed' AND archived=false),0)::int completed_nights FROM bookings WHERE referrer=$1 GROUP BY name ORDER BY name`,[memberId]);return q.rows;}

app.get('/healthz',async(req,res)=>{if(!pool)return res.json({ok:true,database:'not_configured'});try{await pool.query('SELECT 1');res.json({ok:true,database:'available'});}catch{res.status(503).json({ok:false,database:'unavailable'});}});
app.use('/api',(req,res,next)=>{if(['/admin/login','/admin/logout','/telegram/webhook'].includes(req.path))return next();if(!pool)return res.status(503).json({error:'Database is not configured'});next();});

app.get('/api/pricing', async(req,res)=>res.json(await pricing()));
app.get('/api/availability', async(req,res)=>{ const q=await pool.query(`SELECT arrival::text,departure::text FROM calendar_blocks UNION SELECT arrival::text,departure::text FROM bookings WHERE status IN ('request','waitlist','confirmed','completed') AND dates_released=false ORDER BY arrival`); res.json({ranges:q.rows}); });

app.post('/api/members',async(req,res)=>{
 const action=req.body?.action,ph=phone(req.body?.phone);
 if(!ph)return res.status(400).json({error:'Укажите корректный телефон'});
 if(action==='lookup'){
  const q=await pool.query('SELECT * FROM members WHERE phone=$1',[ph]);
  if(!q.rowCount)return res.status(404).json({error:'Участник не найден'});
  const b=await balances(),guests=await invitedGuests(q.rows[0].id);
  return res.json({...q.rows[0],balance:b[q.rows[0].id]||0,invitedGuests:guests});
 }
 if(action==='join'){
  const name=String(req.body?.name||'').trim();
  if(!name||name.length>80)return res.status(400).json({error:'Укажите имя (не более 80 символов)'});
  const mid='phone:'+id(),code='DOM'+crypto.randomBytes(4).toString('hex').toUpperCase();
  const q=await pool.query('INSERT INTO members(id,name,phone,code) VALUES($1,$2,$3,$4) ON CONFLICT(phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING *',[mid,name,ph,code]);
  return res.json(q.rows[0]);
 }
 res.status(400).json({error:'Неизвестное действие'});
});

app.post('/api/bookings',async(req,res)=>{
 if(req.body?.website)return res.status(400).json({error:'Заявка отклонена'});
 const {arrival,departure,code,requestKey}=req.body||{};
 const name=String(req.body?.name||'').trim(),ph=phone(req.body?.phone),guests=Number(req.body?.guests??12),key=String(requestKey||'').trim();
 if(!name||name.length>80||!ph||!validRange(arrival,departure)||!Number.isInteger(guests)||guests<1||guests>30||!key||key.length>128)return res.status(400).json({error:'Проверьте данные бронирования'});
 const booking=await transaction(async client=>{
  await lockBookingDates(client);
  const old=await client.query('SELECT id FROM bookings WHERE request_key=$1',[key]);
  if(old.rowCount)return Object.assign(new Error('Эта заявка уже отправлена'),{status:409});
  const occupied=await client.query(`SELECT 1 FROM calendar_blocks WHERE arrival<$2 AND departure>$1 UNION ALL SELECT 1 FROM bookings WHERE status IN ('request','waitlist','confirmed','completed') AND dates_released=false AND arrival<$2 AND departure>$1 LIMIT 1`,[arrival,departure]);
  let ref=null,first=false;
  if(code){const result=await client.query('SELECT id,phone FROM members WHERE code=$1',[String(code).trim().toUpperCase()]);const member=result.rows[0];if(member&&member.phone!==ph){ref=member.id;const previous=await client.query("SELECT 1 FROM bookings WHERE phone=$1 AND status<>'cancelled' LIMIT 1",[ph]);first=!previous.rowCount;}}
  const prices=await pricing(client),nn=nights(arrival,departure),total=stayPrice(arrival,departure,guests,prices,first),bid=id(),status=occupied.rowCount?'waitlist':'request';
  await client.query('INSERT INTO bookings(id,name,phone,arrival,departure,guests,nights,total,referrer,status,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[bid,name,ph,arrival,departure,guests,nn,total,ref,status,key]);
  await client.query('INSERT INTO telegram_outbox(booking_id,payload) VALUES($1,$2)',[bid,{type:'booking',id:bid,name,phone:ph,arrival,departure,guests,total,status}]);
  return{id:bid,status,total};
 });
 sendPending().catch(()=>{});
 res.status(201).json({...booking,availability:booking.status==='waitlist'?'waitlist':'request'});
});

app.post('/api/admin/login',(req,res)=>{
 const configuredPhone=phone(process.env.OWNER_PHONE),submittedPhone=phone(req.body?.phone),password=process.env.OWNER_PASSWORD;
 if(!configuredPhone||!password)return res.status(503).json({error:'Вход владельца не настроен'});
 const supplied=Buffer.from(String(req.body?.password||'')),expected=Buffer.from(password);
 if(submittedPhone!==configuredPhone||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.status(401).json({error:'Неверный телефон или пароль'});
 for(const [token,expires] of sessions)if(expires<=Date.now())sessions.delete(token);
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+30*86400000);
 res.setHeader('Set-Cookie',cookieHeader(req,token,2592000));res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>{const token=cookie(req).hvoinaya_admin;if(token)sessions.delete(token);res.setHeader('Set-Cookie',cookieHeader(req,'',0));res.json({ok:true});});

app.get('/api/club', async(req,res)=>{ try{ const ph=req.query.phone?phone(req.query.phone):null;if(req.query.phone&&!ph)return res.status(400).json({error:'Укажите корректный телефон'}); let me=null; if(ph){const q=await pool.query('SELECT * FROM members WHERE phone=$1',[ph]);me=q.rows[0]||null;} const admin=isAdmin(req); const b=await balances();const guests=me?await invitedGuests(me.id):[]; if(!admin){return res.json({me,isAdmin:false,balance:me?b[me.id]||0:0,userId:me?.id||null,invitedGuests:guests,members:[],deductions:[],blocks:[],bookings:[],rewards:[]});}
 const [m,d,bl,bk,rw]=await Promise.all([pool.query('SELECT * FROM members ORDER BY created_at'),pool.query("SELECT member_id,points,reason,created_at AS created FROM point_ledger WHERE kind='deducted' ORDER BY created_at DESC"),pool.query('SELECT id,arrival::text,departure::text,note,kind,created_at AS created FROM calendar_blocks ORDER BY arrival'),pool.query('SELECT id,user_id,name,phone,arrival::text,departure::text,guests,nights,total,referrer,status,created_at AS created,request_key,early_credited,archived,dates_released,telegram_state,telegram_attempted_at FROM bookings ORDER BY created_at DESC'),pool.query('SELECT id,member_id,kind,date::text,called,points,status,created_at AS created FROM rewards ORDER BY created_at DESC')]);
 res.json({me,isAdmin:true,members:m.rows.map(x=>({...x,balance:b[x.id]||0})),deductions:d.rows,blocks:bl.rows,bookings:bk.rows,rewards:rw.rows,balance:me?b[me.id]||0:0,userId:me?.id||null,invitedGuests:guests}); }catch(e){console.error(e);res.status(500).json({error:'Не удалось загрузить кабинет'});} });

async function createReward(x,ownerCreated=false){
 const memberId=String(x.memberId||''),kind=x.kind,date=x.date||null;
 if(!memberId||!['cash','stay'].includes(kind))throw Object.assign(new Error('Проверьте участника и вид награды'),{status:400});
 if((kind==='stay'&&!isDate(date))||(date&&!isDate(date)))throw Object.assign(new Error('Укажите корректную дату награды'),{status:400});
 await transaction(async client=>{
  const member=await client.query('SELECT id FROM members WHERE id=$1 FOR UPDATE',[memberId]);
  if(!member.rowCount)throw Object.assign(new Error('Участник не найден'),{status:400});
  const balance=await client.query("SELECT COALESCE(SUM(CASE WHEN kind IN ('earned','release') THEN points ELSE -points END),0)::int AS points FROM point_ledger WHERE member_id=$1",[memberId]);
  if(balance.rows[0].points<10)throw Object.assign(new Error('Для награды необходимо накопить 10 баллов'),{status:400});
  if(kind==='stay'){
   const start=date.slice(0,7)+'-01',endDate=new Date(start+'T00:00:00Z');endDate.setUTCMonth(endDate.getUTCMonth()+1);
   const count=await client.query("SELECT COUNT(*)::int AS count FROM rewards WHERE member_id=$1 AND kind='stay' AND status<>'rejected' AND date >= $2 AND date < $3",[memberId,start,endDate.toISOString().slice(0,10)]);
   if(count.rows[0].count>=2)throw Object.assign(new Error('Доступно не более двух бесплатных ночей в месяц'),{status:409});
  }
  const rewardId=id();
  await client.query('INSERT INTO rewards(id,member_id,kind,date,called,points) VALUES($1,$2,$3,$4,$5,10)',[rewardId,memberId,kind,date,ownerCreated&&!!x.called]);
  await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,10,'reserved',$2,$3,$4) ON CONFLICT(request_id) DO NOTHING",[memberId,ownerCreated?'Запрос награды владельцем':'Запрос награды','reward:'+rewardId,rewardId]);
 });
}

app.post('/api/club', async(req,res)=>{ if(!requireAdmin(req,res))return; const x=req.body||{}; try{ switch(x.action){
 case 'blockDates': {if(!validRange(x.arrival,x.departure)||!['blocked','booked'].includes(x.kind||'blocked'))return res.status(400).json({error:'Проверьте период блокировки'});await transaction(async client=>{await lockBookingDates(client);const overlap=await client.query("SELECT 1 FROM calendar_blocks WHERE arrival<$2 AND departure>$1 UNION ALL SELECT 1 FROM bookings WHERE status IN ('request','waitlist','confirmed','completed') AND dates_released=false AND arrival<$2 AND departure>$1 LIMIT 1",[x.arrival,x.departure]);if(overlap.rowCount)throw Object.assign(new Error('Даты уже заняты'),{status:409});await client.query('INSERT INTO calendar_blocks(id,arrival,departure,kind,note) VALUES($1,$2,$3,$4,$5)',[id(),x.arrival,x.departure,x.kind||'blocked',String(x.note||'').slice(0,500)]);});break;}
 case 'removeBlock': await pool.query('DELETE FROM calendar_blocks WHERE id=$1',[x.id]);break;
 case 'setPrices': {const p=await pricing();p.weekday=Number(x.weekday);p.friday=Number(x.friday);p.saturday=Number(x.saturday);await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;}
 case 'setDatePrice': {const p=await pricing();p.dates={...(p.dates||{}),[x.date]:Number(x.price)};await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;}
 case 'removeDatePrice': {const p=await pricing();delete p.dates?.[x.date];await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;}
 case 'memberNote': await pool.query('UPDATE members SET note=$1 WHERE id=$2',[x.note||'',x.memberId]);break;
 case 'deductPoints': {const points=Number(x.points),requestId=String(x.requestId||'');if(!x.memberId||!Number.isInteger(points)||points<1||points>100000||!requestId||requestId.length>128)return res.status(400).json({error:'Проверьте сумму списания'});await transaction(async client=>{const old=await client.query('SELECT 1 FROM point_ledger WHERE request_id=$1',[requestId]);if(old.rowCount)return;const member=await client.query('SELECT id FROM members WHERE id=$1 FOR UPDATE',[x.memberId]);if(!member.rowCount)throw Object.assign(new Error('Участник не найден'),{status:400});const balance=await client.query("SELECT COALESCE(SUM(CASE WHEN kind IN ('earned','release') THEN points ELSE -points END),0)::int AS points FROM point_ledger WHERE member_id=$1",[x.memberId]);if(balance.rows[0].points<points)throw Object.assign(new Error('Недостаточно баллов'),{status:400});await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id) VALUES($1,$2,'deducted',$3,$4) ON CONFLICT(request_id) DO NOTHING",[x.memberId,points,String(x.reason||'').slice(0,500),requestId]);});break;}
 case 'bookingStatus': {if(!['waitlist','request','confirmed','completed','cancelled'].includes(x.status))return res.status(400).json({error:'Некорректный статус'});await transaction(async client=>{const q=await client.query('UPDATE bookings SET status=$1,early_credited=CASE WHEN $1=\'completed\' AND $3 THEN true ELSE early_credited END WHERE id=$2 RETURNING *',[x.status,x.id,!!x.acceptEarlyRisk]);const bk=q.rows[0];if(bk&&x.status==='completed'&&bk.referrer)await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,booking_id) VALUES($1,$2,'earned','Завершённое проживание',$3,$4) ON CONFLICT(request_id) DO NOTHING",[bk.referrer,bk.nights,'booking:'+bk.id,bk.id]);});break;}
 case 'releaseDates': await pool.query('UPDATE bookings SET dates_released=true WHERE id=$1',[x.id]);break;
 case 'deleteBooking': await pool.query('UPDATE bookings SET archived=true WHERE id=$1',[x.id]);break;
 case 'reward': await createReward(x);break;
 case 'memberReward': await createReward(x,true);break;
 case 'rewardStatus': {if(!['requested','approved','issued','rejected'].includes(x.status))return res.status(400).json({error:'Некорректный статус награды'});await transaction(async client=>{const found=await client.query('SELECT * FROM rewards WHERE id=$1 FOR UPDATE',[x.id]);const rw=found.rows[0];if(!rw)return;const allowed={requested:['requested','approved','issued','rejected'],approved:['approved','issued','rejected'],issued:['issued'],rejected:['rejected']};if(!allowed[rw.status]?.includes(x.status))throw Object.assign(new Error('Недопустимый переход статуса награды'),{status:400});await client.query('UPDATE rewards SET status=$1,updated_at=now() WHERE id=$2',[x.status,x.id]);if(x.status==='rejected')await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'release','Награда отклонена',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-release:'+rw.id,rw.id]);if(x.status==='issued'){await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'release','Резерв награды использован',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-settle:'+rw.id,rw.id]);await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'spent','Награда выдана',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-spent:'+rw.id,rw.id]);}});break;}
 default:return res.status(400).json({error:'Неизвестное действие'}); }
 res.json({ok:true}); }catch(e){console.error('Club API operation failed',e.code||e.name);res.status(e.status||400).json({error:e.message||'Ошибка'});} });

async function telegram(method,payload={}){const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw Error('Telegram is not configured');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Telegram request failed');const j=await r.json();if(!j.ok)throw Error('Telegram request failed');return j.result;}
async function sendPending(){if(!pool||!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_OWNER_CHAT_ID)return;const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query("SELECT * FROM telegram_outbox WHERE state IN ('pending','failed') ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED");for(const row of q.rows){try{const p=row.payload;await telegram('sendMessage',{chat_id:process.env.TELEGRAM_OWNER_CHAT_ID,text:`Новая заявка: ${p.name}\n${p.phone}\n${p.arrival} — ${p.departure}\nГостей: ${p.guests}\nСтоимость: ${p.total} ₽`});await client.query("UPDATE telegram_outbox SET state='sent',attempts=attempts+1,attempted_at=now(),last_error=NULL WHERE id=$1",[row.id]);}catch{await client.query("UPDATE telegram_outbox SET state='failed',attempts=attempts+1,attempted_at=now(),last_error='Delivery failed' WHERE id=$1",[row.id]);}}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
app.get('/api/telegram',async(req,res)=>{const q=await pool.query("SELECT count(*)::int pending FROM telegram_outbox WHERE state IN ('pending','failed')");res.json({configured:!!process.env.TELEGRAM_BOT_TOKEN,connected:!!process.env.TELEGRAM_OWNER_CHAT_ID,pending:q.rows[0].pending});});
app.post('/api/telegram',async(req,res)=>{if(!requireAdmin(req,res))return;try{if(req.body?.action==='test'){if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_OWNER_CHAT_ID)return res.status(503).json({error:'Telegram не настроен'});await telegram('sendMessage',{chat_id:process.env.TELEGRAM_OWNER_CHAT_ID,text:'Коттедж на Хвойной: тестовое сообщение.'});return res.json({ok:true});}if(req.body?.action==='retry'){await sendPending();return res.json({ok:true});}return res.status(400).json({error:'Для подключения Telegram настройте бота и webhook'});}catch{return res.status(503).json({error:'Не удалось выполнить запрос Telegram'});}});
app.post('/api/telegram/webhook',(req,res)=>{const secret=process.env.TELEGRAM_WEBHOOK_SECRET;if(!secret)return res.status(503).json({error:'Webhook is not configured'});const supplied=Buffer.from(String(req.get('x-telegram-bot-api-secret-token')||'')),expected=Buffer.from(secret);if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.sendStatus(403);res.json({ok:true});});

// Protected API prepared for a future ChatGPT/MCP connector.
app.get('/admin-api/health',(req,res)=>{if(!requireAdmin(req,res))return;res.json({ok:true,service:'dom-na-hvoinoy'});});

app.use((error,req,res,next)=>{
 if(res.headersSent)return next(error);
 const connectionError=error.code?.startsWith('08')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','57P01'].includes(error.code);
 const status=error.status||(error.code==='23505'?409:connectionError?503:500);
 console.error('Request failed',req.method,req.path,error.code||error.name);
 const message=status===503?'Database is unavailable':status===409?'Conflict':status<500?(error.message||'Invalid request'):'Internal server error';
 res.status(status).json({error:message});
});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.use((req,res)=>{if(/^\/(api|admin-api)(\/|$)/.test(req.path))return res.status(404).json({error:'Not found'});res.sendFile(path.join(__dirname,'public','index.html'));});
app.listen(PORT,'0.0.0.0',()=>console.log(`dom-na-hvoinoy listening on ${PORT}`));
