import express from 'express';
import pg from 'pg';
import { readFile } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendTelegramOutbox } from './telegram-outbox.js';
import { handleTelegramStart } from './telegram-start.js';
import { reconnectTelegramWebhook } from './telegram-webhook.js';
import { createMailNotificationService, isMailConfigured, scheduleBookingEmail } from './booking-email.js';

const { Pool } = pg;
const app = express();
const databaseUrl = process.env.DATABASE_URL;
const databaseHostname = databaseUrl ? new URL(databaseUrl).hostname : '';
const pool = databaseUrl ? new Pool({
 connectionString: databaseUrl,
 connectionTimeoutMillis: 5000,
 idleTimeoutMillis: 30000,
 max: 10,
 ssl: databaseHostname === 'localhost' || databaseHostname.includes('-cnpg-') ? false : { rejectUnauthorized: false }
}) : null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();
const loginAttempts = new Map();
const bookingPhoneAttempts = new Map();
const mailNotifications = createMailNotificationService();
const bookingPhoneAttemptWindow = 60 * 60 * 1000;
const json = express.json({ limit: '256kb' });
app.use(json);
app.use((req,res,next)=>{
 const hostname=req.hostname.toLowerCase().replace(/\.$/,'');
 if(['www.собери-своих.рф','www.xn----9sbekpc0bfogg5c.xn--p1ai'].includes(hostname)&&['GET','HEAD'].includes(req.method)){
  return res.redirect(301,`https://собери-своих.рф${req.originalUrl}`);
 }
 if(/^\/(?:api|admin-api)(?:\/|$)/.test(req.path)||/^\/(?:admin|healthz|health|healthcheck)(?:\/|$)/.test(req.path)){
  res.setHeader('X-Robots-Tag','noindex, nofollow');
 }
 next();
});
pool?.on('error', e => console.error('Unexpected PostgreSQL pool error', e.code || e.name));

const id = () => crypto.randomUUID();
const phone = v => { let p=String(v||'').replace(/\D/g,''); if(p.length===10)p='7'+p; if(p.length===11&&p[0]==='8')p='7'+p.slice(1); return /^7\d{10}$/.test(p)?p:null; };
function reserveBookingPhoneAttempt(normalizedPhone,now=Date.now()){
 const cutoff=now-bookingPhoneAttemptWindow;
 const attempts=(bookingPhoneAttempts.get(normalizedPhone)||[]).filter(attempt=>attempt.at>cutoff);
 if(attempts.length>=5){
  bookingPhoneAttempts.set(normalizedPhone,attempts);
  return{retryAfter:Math.max(1,Math.ceil((attempts[0].at+bookingPhoneAttemptWindow-now)/1000))};
 }
 const attempt={at:now};
 attempts.push(attempt);
 bookingPhoneAttempts.set(normalizedPhone,attempts);
 return{retryAfter:0,rollback:()=>{
  const current=bookingPhoneAttempts.get(normalizedPhone);
  if(!current)return;
  const index=current.indexOf(attempt);
  if(index!==-1)current.splice(index,1);
  if(!current.length)bookingPhoneAttempts.delete(normalizedPhone);
 }};
}
const bookingAttemptCleanup=setInterval(()=>{
 const cutoff=Date.now()-bookingPhoneAttemptWindow;
 for(const [normalizedPhone,attempts] of bookingPhoneAttempts){
  const recent=attempts.filter(attempt=>attempt.at>cutoff);
  if(recent.length)bookingPhoneAttempts.set(normalizedPhone,recent);
  else bookingPhoneAttempts.delete(normalizedPhone);
 }
},60*1000);
bookingAttemptCleanup.unref();
const cookie = req => Object.fromEntries(String(req.headers.cookie || '').split(';').flatMap(v=>{const i=v.indexOf('=');if(i<0)return[];try{return[[v.slice(0,i).trim(),decodeURIComponent(v.slice(i+1).trim())]]}catch{return[]}}));
function isAdmin(req){ const t=cookie(req).hvoinaya_admin; const s=t&&sessions.get(t); if(!s)return false;if(s<=Date.now()){sessions.delete(t);return false;}return true; }
function requireAdmin(req,res){ if(!isAdmin(req)){res.status(401).json({error:'Требуется вход владельца'});return false} return true; }
function isDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;}
function nights(a,b){ if(!isDate(a)||!isDate(b))return 0;return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000); }
function validRange(a,b){return nights(a,b)>0;}
function isValidPrice(value,max=1000000){const n=Number(value); return Number.isFinite(n) && n >= 0 && n <= max; }
async function transaction(work){const client=await pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
async function lockBookingDates(client){await client.query("SELECT pg_advisory_xact_lock(hashtext('dom-na-hvoinoy-booking-dates'))");}
async function ensureMemberReferralCode(member){
 const validCode=code=>typeof code==='string'&&code.trim()?code:null;
 const existing=validCode(member.code);
 if(existing)return existing;
 for(let attempt=0;attempt<5;attempt++){
  try{
   return await transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dom-na-hvoinoy-member-referral-code'))");
    const current=await client.query('SELECT code FROM members WHERE id=$1 FOR UPDATE',[member.id]);
    if(!current.rowCount)throw new Error('Member no longer exists');
    const currentCode=validCode(current.rows[0].code);
    if(currentCode)return currentCode;
    for(let candidateAttempt=0;candidateAttempt<10;candidateAttempt++){
     const code='DOM'+crypto.randomBytes(4).toString('hex').toUpperCase();
     const used=await client.query('SELECT 1 FROM members WHERE code=$1 LIMIT 1',[code]);
     if(used.rowCount)continue;
     const updated=await client.query("UPDATE members SET code=$2 WHERE id=$1 AND (code IS NULL OR code ~ '^[[:space:]]*$') RETURNING code",[member.id,code]);
     if(updated.rowCount)return updated.rows[0].code;
     const latest=await client.query('SELECT code FROM members WHERE id=$1',[member.id]);
     const latestCode=validCode(latest.rows[0]?.code);
     if(latestCode)return latestCode;
     throw new Error('Unable to assign a referral code to member');
    }
    throw new Error('Unable to generate a unique member referral code');
   });
  }catch(error){
   if(error.code!=='23505'||attempt===4)throw error;
  }
 }
}
function cookieHeader(req,token,maxAge){const secure=process.env.NODE_ENV==='production'||req.secure||req.headers['x-forwarded-proto']==='https';return `hvoinaya_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;}
function deviceCookieHeader(req,token,maxAge){const secure=process.env.NODE_ENV==='production'||req.secure||req.headers['x-forwarded-proto']==='https';return `hvoinaya_device=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;}
async function issueDeviceToken(req,res,memberId){const token=crypto.randomBytes(32).toString('base64url'),tokenHash=crypto.createHash('sha256').update(token).digest('hex');await pool.query("INSERT INTO member_devices(token_hash,member_id,expires_at) VALUES($1,$2,now()+interval '365 days')",[tokenHash,memberId]);res.setHeader('Set-Cookie',deviceCookieHeader(req,token,31536000));}
async function memberAccount(member){
 const [balance,bookings,invited]=await Promise.all([
  pool.query("SELECT COALESCE(SUM(CASE WHEN kind='earned' THEN points WHEN kind IN ('deducted','reserved','spent') THEN -points WHEN kind='release' THEN points ELSE 0 END),0)::int AS balance FROM point_ledger WHERE member_id=$1",[member.id]),
  pool.query("SELECT arrival::text,departure::text,guests,total,status,dates_released FROM bookings WHERE (phone=$1 OR user_id=$2) AND archived=false ORDER BY created_at DESC",[member.phone,member.id]),
  pool.query("SELECT b.name,b.arrival::text,b.departure::text,b.nights,b.status,b.dates_released,COALESCE(points.earned,0)::int AS earned_points FROM bookings b LEFT JOIN LATERAL (SELECT SUM(points)::int AS earned FROM point_ledger WHERE member_id=$1 AND kind='earned' AND (booking_id=b.id OR request_id='booking:'||b.id)) points ON true WHERE b.referrer=$1 AND b.archived=false ORDER BY b.created_at DESC",[member.id])
 ]);
 const today=new Date().toISOString().slice(0,10);
 return {loggedIn:true,member:{id:member.id,name:member.name,phone:member.phone,code:member.code,balance:balance.rows[0].balance},bookings:bookings.rows,invitedGuests:invited.rows.map(guest=>({...guest,statusLabel:guest.status==='request'?'Бронь создана':guest.status==='waitlist'?'Лист ожидания':guest.status==='confirmed'?(guest.arrival>today?'Ожидание заезда':'Бронирование подтверждено'):guest.status==='completed'?(guest.earned_points>0?'Баллы начислены':'Заезд состоялся'):'Бронь отменена'}))};
}
async function pricing(queryable=pool){ const r=await queryable.query("SELECT value FROM settings WHERE key='pricing'"); return r.rows[0]?.value || {weekday:23000,friday:30000,saturday:34000,dates:{}}; }
function stayPrice(a,b,g,p,firstReferral=false){ let total=0; for(let d=new Date(a+'T00:00:00Z'),end=new Date(b+'T00:00:00Z');d<end;d.setUTCDate(d.getUTCDate()+1)){ const ds=d.toISOString().slice(0,10); const dow=d.getUTCDay(); let base=Number(p.dates?.[ds] ?? (dow===5?p.friday:dow===6?p.saturday:p.weekday)); total += base + Math.max(0,Number(g)-12)*1000 - (firstReferral?2000:0); } return Math.max(0,total); }
async function balances(){ const q=await pool.query(`SELECT m.id, COALESCE(SUM(CASE WHEN l.kind='earned' THEN l.points WHEN l.kind IN ('deducted','reserved','spent') THEN -l.points WHEN l.kind='release' THEN l.points ELSE 0 END),0)::int balance FROM members m LEFT JOIN point_ledger l ON l.member_id=m.id GROUP BY m.id`); return Object.fromEntries(q.rows.map(x=>[x.id,x.balance])); }
async function invitedGuests(memberId){const q=await pool.query(`SELECT name,COUNT(*) FILTER(WHERE status<>'cancelled' AND archived=false)::int stays,COUNT(*) FILTER(WHERE status='completed' AND archived=false)::int completed_stays,COALESCE(SUM(nights) FILTER(WHERE status='completed' AND archived=false),0)::int completed_nights FROM bookings WHERE referrer=$1 GROUP BY name ORDER BY name`,[memberId]);return q.rows;}

app.get('/healthz',async(req,res)=>{if(!pool)return res.json({ok:true,database:'not_configured'});try{await pool.query('SELECT 1');res.json({ok:true,database:'available'});}catch{res.status(503).json({ok:false,database:'unavailable'});}});
app.use('/api',(req,res,next)=>{if(['/admin/login','/admin/logout','/telegram/webhook','/me','/mail'].includes(req.path))return next();if(!pool)return res.status(503).json({error:'Database is not configured'});next();});

app.get('/api/me',async(req,res)=>{
 const token=cookie(req).hvoinaya_device;
 if(!pool)return token?res.status(503).json({error:'Database is not configured'}):res.json({loggedIn:false});
 if(!token)return res.json({loggedIn:false});
 const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
 const device=await pool.query('UPDATE member_devices SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() RETURNING member_id',[tokenHash]);
 if(!device.rowCount){res.setHeader('Set-Cookie',deviceCookieHeader(req,'',0));return res.json({loggedIn:false});}
 const member=await pool.query('SELECT id,name,phone,code FROM members WHERE id=$1',[device.rows[0].member_id]);
 if(!member.rowCount){res.setHeader('Set-Cookie',deviceCookieHeader(req,'',0));return res.json({loggedIn:false});}
 member.rows[0].code=await ensureMemberReferralCode(member.rows[0]);
 res.json(await memberAccount(member.rows[0]));
});

app.get('/api/pricing', async(req,res)=>res.json(await pricing()));
app.get('/api/availability', async(req,res)=>{ const q=await pool.query(`SELECT arrival::text,departure::text FROM calendar_blocks UNION SELECT arrival::text,departure::text FROM bookings WHERE archived=false AND status IN ('confirmed','completed') AND dates_released=false ORDER BY arrival`); res.json({ranges:q.rows}); });

app.post('/api/members',async(req,res)=>{
 const action=req.body?.action,ph=phone(req.body?.phone);
 if(!ph)return res.status(400).json({error:'Укажите корректный телефон'});
 if(action==='lookup'){
  const q=await pool.query('SELECT id,name,phone,code FROM members WHERE phone=$1',[ph]);
  if(!q.rowCount)return res.status(404).json({error:'Участник не найден'});
  const member=q.rows[0];
  member.code=await ensureMemberReferralCode(member);
  await issueDeviceToken(req,res,member.id);
  const [account,guests]=await Promise.all([memberAccount(member),invitedGuests(member.id)]);
  return res.json({...account.member,bookings:account.bookings,invitedGuests:guests,referralBookings:account.invitedGuests});
 }
 if(action==='join'){
  const name=String(req.body?.name||'').trim();
  if(!name||name.length>80)return res.status(400).json({error:'Укажите имя (не более 80 символов)'});
  const mid='phone:'+id(),code='DOM'+crypto.randomBytes(4).toString('hex').toUpperCase();
  const q=await pool.query('INSERT INTO members(id,name,phone,code) VALUES($1,$2,$3,$4) ON CONFLICT(phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING id,name,phone,code',[mid,name,ph,code]);
  const member=q.rows[0];
  member.code=await ensureMemberReferralCode(member);
  await issueDeviceToken(req,res,member.id);
  const account=await memberAccount(member);
  return res.json({...account.member,bookings:account.bookings,invitedGuests:account.invitedGuests,referralBookings:account.invitedGuests});
 }
 res.status(400).json({error:'Неизвестное действие'});
});

app.post('/api/bookings',async(req,res)=>{
 if(req.body?.website)return res.status(400).json({error:'Заявка отклонена'});
 const {arrival,departure,code,requestKey}=req.body||{};
 const name=String(req.body?.name||'').trim(),ph=phone(req.body?.phone),guests=Number(req.body?.guests??12),key=String(requestKey||'').trim();
 if(!name||name.length>80||!ph||!validRange(arrival,departure)||!Number.isInteger(guests)||guests<1||guests>30||!key||key.length>128)return res.status(400).json({error:'Проверьте данные бронирования'});
 let bookingAttempt;
 let booking;
 try{
  booking=await transaction(async client=>{
   await lockBookingDates(client);
   const old=await client.query('SELECT id FROM bookings WHERE request_key=$1',[key]);
   if(old.rowCount) throw Object.assign(new Error('Эта заявка уже отправлена'),{status:409});
   bookingAttempt=reserveBookingPhoneAttempt(ph);
   if(bookingAttempt.retryAfter)throw Object.assign(new Error('Слишком много заявок. Попробуйте немного позже.'),{status:429,retryAfter:bookingAttempt.retryAfter});
   const occupied=await client.query(`SELECT 1 FROM calendar_blocks WHERE arrival<$2 AND departure>$1 UNION ALL SELECT 1 FROM bookings WHERE archived=false AND status IN ('confirmed','completed') AND dates_released=false AND arrival<$2 AND departure>$1 LIMIT 1`,[arrival,departure]);
   const previous=await client.query("SELECT EXISTS(SELECT 1 FROM bookings WHERE phone=$1 AND status IN ('confirmed','completed')) AS has_previous,(SELECT referrer FROM bookings WHERE phone=$1 AND status IN ('confirmed','completed') AND referrer IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS referrer",[ph]);
   let ref=previous.rows[0].referrer,first=false;
   if(!ref&&code){const result=await client.query('SELECT id,phone FROM members WHERE code=$1',[String(code).trim().toUpperCase()]);const member=result.rows[0];if(member&&member.phone!==ph)ref=member.id;}
   first=!previous.rows[0].has_previous&&!!ref;
   const prices=await pricing(client),nn=nights(arrival,departure),total=stayPrice(arrival,departure,guests,prices,first),bid=id(),status=occupied.rowCount?'waitlist':'request';
   await client.query('INSERT INTO bookings(id,name,phone,arrival,departure,guests,nights,total,referrer,status,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[bid,name,ph,arrival,departure,guests,nn,total,ref,status,key]);
   await client.query('INSERT INTO telegram_outbox(booking_id,payload) VALUES($1,$2)',[bid,{type:'booking',id:bid,name,phone:ph,arrival,departure,guests,total,status}]);
   return{id:bid,status,total};
  });
 }catch(error){
  bookingAttempt?.rollback?.();
  throw error;
 }
 sendPending().catch(error=>console.error('Telegram outbox delivery failed',error.code||error.name));
 res.status(201).json({...booking,availability:booking.status==='waitlist'?'waitlist':'request'});
 if(isMailConfigured())scheduleBookingEmail(booking,{sendBooking:mailNotifications.sendBooking});
});

app.post('/api/admin/login',(req,res)=>{
 const configuredPhone=phone(process.env.OWNER_PHONE),submittedPhone=phone(req.body?.phone),password=process.env.OWNER_PASSWORD;
 if(!configuredPhone||!password)return res.status(503).json({error:'Вход владельца не настроен'});
 const key=`${req.ip||'unknown'}:${submittedPhone||'unknown'}`;
 const now=Date.now();
 const current=loginAttempts.get(key)||{count:0,blockedUntil:0};
 if(current.blockedUntil>now){
  return res.status(429).json({error:'Слишком много попыток входа. Попробуйте позже.',retryAfter:Math.ceil((current.blockedUntil-now)/1000)});
 }
 const supplied=Buffer.from(String(req.body?.password||'')),expected=Buffer.from(password);
 const validPhone=submittedPhone===configuredPhone;
 const validPassword=supplied.length===expected.length && crypto.timingSafeEqual(supplied,expected);
 if(!validPhone||!validPassword){
  const next={count:current.count+1,blockedUntil:0};
  if(next.count>=5){next.blockedUntil=now+600000;}
  loginAttempts.set(key,next);
  if(next.blockedUntil){
   return res.status(429).json({error:'Слишком много попыток входа. Попробуйте позже.',retryAfter:600});
  }
  return res.status(401).json({error:'Неверный телефон или пароль'});
 }
 loginAttempts.delete(key);
 for(const [token,expires] of sessions)if(expires<=Date.now())sessions.delete(token);
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+30*86400000);
 res.setHeader('Set-Cookie',cookieHeader(req,token,2592000));res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>{const token=cookie(req).hvoinaya_admin;if(token)sessions.delete(token);res.setHeader('Set-Cookie',cookieHeader(req,'',0));res.json({ok:true});});

app.get('/api/club', async(req,res)=>{ try{ const admin=isAdmin(req);const ph=req.query.phone?phone(req.query.phone):null;if(req.query.phone&&!ph)return res.status(400).json({error:'Укажите корректный телефон'});if(ph&&!admin)return res.status(401).json({error:'Требуется вход владельца'}); let me=null; if(ph){const q=await pool.query('SELECT id,name,phone,code FROM members WHERE phone=$1',[ph]);me=q.rows[0]||null;if(me)me.code=await ensureMemberReferralCode(me);} const b=await balances();const guests=me?await invitedGuests(me.id):[]; if(!admin){return res.json({me,isAdmin:false,balance:me?b[me.id]||0:0,userId:me?.id||null,invitedGuests:guests,members:[],deductions:[],blocks:[],bookings:[],rewards:[]});}
 const [m,d,bl,bk,rw]=await Promise.all([pool.query(`SELECT m.*,COUNT(b.id) FILTER(WHERE b.status IN ('confirmed','completed') AND b.archived=false)::int AS booking_count,COUNT(b.id) FILTER(WHERE b.status='completed' AND b.archived=false)::int AS completed_booking_count,COALESCE(SUM(b.nights) FILTER(WHERE b.status='completed' AND b.archived=false),0)::int AS completed_nights FROM members m LEFT JOIN bookings b ON b.referrer=m.id GROUP BY m.id ORDER BY booking_count DESC,completed_booking_count DESC,completed_nights DESC,m.created_at ASC`),pool.query("SELECT member_id,points,reason,created_at AS created FROM point_ledger WHERE kind='deducted' ORDER BY created_at DESC"),pool.query('SELECT id,arrival::text,departure::text,note,kind,created_at AS created FROM calendar_blocks ORDER BY arrival'),pool.query('SELECT id,user_id,name,phone,arrival::text,departure::text,guests,nights,total,referrer,status,created_at AS created,request_key,early_credited,archived,dates_released,telegram_state,telegram_attempted_at FROM bookings WHERE archived=false ORDER BY created_at DESC'),pool.query('SELECT id,member_id,kind,date::text,called,points,status,created_at AS created FROM rewards ORDER BY created_at DESC')]);
 res.json({me,isAdmin:true,members:m.rows.map(x=>({...x,balance:b[x.id]||0})),deductions:d.rows,blocks:bl.rows,bookings:bk.rows,rewards:rw.rows,balance:me?b[me.id]||0:0,userId:me?.id||null,invitedGuests:guests}); }catch(e){console.error(e);res.status(500).json({error:'Не удалось загрузить кабинет'});} });

async function createReward(x,ownerCreated=false){
 const memberId=String(x.memberId||''),kind=x.kind,date=x.date||null;
 if(!memberId||!['cash','stay'].includes(kind))throw Object.assign(new Error('Проверьте участника и вид награды'),{status:400});
 if((kind==='stay'&&!isDate(date))||(date&&!isDate(date)))throw Object.assign(new Error('Укажите корректную дату награды'),{status:400});
 const dayOfWeek=kind==='stay'?new Date(`${date}T00:00:00Z`).getUTCDay():null;
 const requiredPoints=kind==='stay'?(dayOfWeek===5?14:dayOfWeek===6?16:10):10;
 await transaction(async client=>{
  const member=await client.query('SELECT id FROM members WHERE id=$1 FOR UPDATE',[memberId]);
  if(!member.rowCount)throw Object.assign(new Error('Участник не найден'),{status:400});
  const balance=await client.query("SELECT COALESCE(SUM(CASE WHEN kind IN ('earned','release') THEN points ELSE -points END),0)::int AS points FROM point_ledger WHERE member_id=$1",[memberId]);
  if(balance.rows[0].points<requiredPoints)throw Object.assign(new Error(`Для этой награды необходимо накопить ${requiredPoints} баллов`),{status:400});
  if(kind==='stay'){
   const start=date.slice(0,7)+'-01',endDate=new Date(start+'T00:00:00Z');endDate.setUTCMonth(endDate.getUTCMonth()+1);
   const count=await client.query("SELECT COUNT(*)::int AS count FROM rewards WHERE member_id=$1 AND kind='stay' AND status<>'rejected' AND date >= $2 AND date < $3",[memberId,start,endDate.toISOString().slice(0,10)]);
   if(count.rows[0].count>=2)throw Object.assign(new Error('Доступно не более двух бесплатных ночей в месяц'),{status:409});
  }
  const rewardId=id();
  await client.query('INSERT INTO rewards(id,member_id,kind,date,called,points) VALUES($1,$2,$3,$4,$5,$6)',[rewardId,memberId,kind,date,ownerCreated&&!!x.called,requiredPoints]);
  await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'reserved',$3,$4,$5) ON CONFLICT(request_id) DO NOTHING",[memberId,requiredPoints,ownerCreated?'Запрос награды владельцем':'Запрос награды','reward:'+rewardId,rewardId]);
 });
}

app.post('/api/club', async(req,res)=>{ if(!requireAdmin(req,res))return; const x=req.body||{};let statusNotificationQueued=false; try{ switch(x.action){
 case 'blockDates': {if(!validRange(x.arrival,x.departure)||!['blocked','booked'].includes(x.kind||'blocked'))return res.status(400).json({error:'Проверьте период блокировки'});await transaction(async client=>{await lockBookingDates(client);const overlap=await client.query("SELECT 1 FROM calendar_blocks WHERE arrival<$2 AND departure>$1 UNION ALL SELECT 1 FROM bookings WHERE archived=false AND status IN ('confirmed','completed') AND dates_released=false AND arrival<$2 AND departure>$1 LIMIT 1",[x.arrival,x.departure]);if(overlap.rowCount)throw Object.assign(new Error('Даты уже заняты'),{status:409});await client.query('INSERT INTO calendar_blocks(id,arrival,departure,kind,note) VALUES($1,$2,$3,$4,$5)',[id(),x.arrival,x.departure,x.kind||'blocked',String(x.note||'').slice(0,500)]);});break;}
 case 'removeBlock': await pool.query('DELETE FROM calendar_blocks WHERE id=$1',[x.id]);break;
 case 'setPrices': {
  const p=await pricing();
  const weekday=Number(x.weekday),friday=Number(x.friday),saturday=Number(x.saturday);
  if(!isValidPrice(weekday,1000000)||!isValidPrice(friday,1000000)||!isValidPrice(saturday,1000000))throw Object.assign(new Error('Некорректные цены'),{status:400});
  p.weekday=weekday;p.friday=friday;p.saturday=saturday;
  await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;
 }
 case 'setDatePrice': {
  const p=await pricing();
  if(!isDate(x.date)||!isValidPrice(x.price,1000000))throw Object.assign(new Error('Некорректная цена или дата'),{status:400});
  p.dates={...(p.dates||{}),[x.date]:Number(x.price)};
  await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;
 }
 case 'removeDatePrice': {
  if(!isDate(x.date))throw Object.assign(new Error('Некорректная дата'),{status:400});
  const p=await pricing();
  delete p.dates?.[x.date];
  await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;
 }
 case 'memberNote': await pool.query('UPDATE members SET note=$1 WHERE id=$2',[x.note||'',x.memberId]);break;
 case 'deductPoints': {const points=Number(x.points),requestId=String(x.requestId||'');if(!x.memberId||!Number.isInteger(points)||points<1||points>100000||!requestId||requestId.length>128)return res.status(400).json({error:'Проверьте сумму списания'});await transaction(async client=>{const old=await client.query('SELECT 1 FROM point_ledger WHERE request_id=$1',[requestId]);if(old.rowCount)return;const member=await client.query('SELECT id FROM members WHERE id=$1 FOR UPDATE',[x.memberId]);if(!member.rowCount)throw Object.assign(new Error('Участник не найден'),{status:400});const balance=await client.query("SELECT COALESCE(SUM(CASE WHEN kind IN ('earned','release') THEN points ELSE -points END),0)::int AS points FROM point_ledger WHERE member_id=$1",[x.memberId]);if(balance.rows[0].points<points)throw Object.assign(new Error('Недостаточно баллов'),{status:400});await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id) VALUES($1,$2,'deducted',$3,$4) ON CONFLICT(request_id) DO NOTHING",[x.memberId,points,String(x.reason||'').slice(0,500),requestId]);});break;}
 case 'bookingStatus': {if(!['waitlist','request','confirmed','completed','cancelled'].includes(x.status))return res.status(400).json({error:'Некорректный статус'});await transaction(async client=>{const current=await client.query('SELECT * FROM bookings WHERE id=$1 AND archived=false FOR UPDATE',[x.id]);if(!current.rowCount)throw Object.assign(new Error('Бронь не найдена'),{status:404});const existing=current.rows[0];await lockBookingDates(client);if(x.status==='confirmed'){if(!['request','waitlist','confirmed'].includes(existing.status))throw Object.assign(new Error('Нельзя подтвердить бронь из текущего статуса'),{status:409});const overlap=await client.query("SELECT 1 FROM calendar_blocks WHERE arrival<$2 AND departure>$1 UNION ALL SELECT 1 FROM bookings WHERE id<>$3 AND archived=false AND status IN ('confirmed','completed') AND dates_released=false AND arrival<$2 AND departure>$1 LIMIT 1",[existing.arrival,existing.departure,existing.id]);if(overlap.rowCount)throw Object.assign(new Error('Даты уже заняты'),{status:409});}if(x.status==='completed'){if(existing.status!=='confirmed')throw Object.assign(new Error('Завершить можно только подтверждённую бронь'),{status:409});if(x.paid!==true)throw Object.assign(new Error('Для завершения необходимо подтвердить оплату'),{status:409});if(Date.now()<Date.parse(`${existing.departure}T07:00:00Z`)&&x.acceptEarlyRisk!==true)throw Object.assign(new Error('Время выезда ещё не наступило'),{status:409});}const q=await client.query('UPDATE bookings SET status=$1,early_credited=CASE WHEN $1=\'completed\' AND $3 THEN true ELSE early_credited END WHERE id=$2 RETURNING *',[x.status,x.id,x.acceptEarlyRisk===true]);const bk=q.rows[0];if(existing.status!==x.status&&['confirmed','cancelled'].includes(x.status)){await client.query('INSERT INTO telegram_outbox(booking_id,payload) VALUES($1,$2)',[bk.id,{type:'booking-status',status:x.status,name:bk.name,phone:bk.phone,arrival:bk.arrival,departure:bk.departure,guests:bk.guests}]);statusNotificationQueued=true;}if(x.status==='completed'&&bk.referrer)await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,booking_id) VALUES($1,$2,'earned','Завершённое проживание',$3,$4) ON CONFLICT(request_id) DO NOTHING",[bk.referrer,bk.nights,'booking:'+bk.id,bk.id]);});break;}
 case 'releaseDates': await pool.query('UPDATE bookings SET dates_released=true WHERE id=$1',[x.id]);break;
 case 'deleteBooking': {if(typeof x.id!=='string'||!x.id.trim())throw Object.assign(new Error('Укажите бронь для архивации'),{status:400});await transaction(async client=>{await lockBookingDates(client);const archived=await client.query('UPDATE bookings SET archived=true,dates_released=true WHERE id=$1 RETURNING id',[x.id]);if(!archived.rowCount)throw Object.assign(new Error('Бронь не найдена'),{status:404});});break;}
 case 'reward': await createReward(x);break;
 case 'memberReward': await createReward(x,true);break;
 case 'rewardStatus': {if(!['requested','approved','issued','rejected'].includes(x.status))return res.status(400).json({error:'Некорректный статус награды'});await transaction(async client=>{const found=await client.query('SELECT * FROM rewards WHERE id=$1 FOR UPDATE',[x.id]);const rw=found.rows[0];if(!rw)return;const allowed={requested:['requested','approved','issued','rejected'],approved:['approved','issued','rejected'],issued:['issued'],rejected:['rejected']};if(!allowed[rw.status]?.includes(x.status))throw Object.assign(new Error('Недопустимый переход статуса награды'),{status:400});await client.query('UPDATE rewards SET status=$1,updated_at=now() WHERE id=$2',[x.status,x.id]);if(x.status==='rejected')await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'release','Награда отклонена',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-release:'+rw.id,rw.id]);if(x.status==='issued'){await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'release','Резерв награды использован',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-settle:'+rw.id,rw.id]);await client.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'spent','Награда выдана',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-spent:'+rw.id,rw.id]);}});break;}
 default:return res.status(400).json({error:'Неизвестное действие'}); }
 if(statusNotificationQueued)sendPending().catch(error=>console.error('Telegram outbox retry failed',error.code||error.name));
 res.json({ok:true}); }catch(e){console.error('Club API operation failed',e.code||e.name);res.status(e.status||400).json({error:e.message||'Ошибка'});} });

async function telegram(method,payload={}){const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw Error('Telegram is not configured');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Telegram request failed');const j=await r.json();if(!j.ok)throw Error('Telegram request failed');return j.result;}
function isTelegramOwnerCallback(callback){
 const ownerChatId=process.env.TELEGRAM_OWNER_CHAT_ID;
 const chat=callback?.message?.chat;
 const user=callback?.from;
 if(!ownerChatId||String(chat?.id??'')!==String(ownerChatId)||!user?.id||user.is_bot)return false;
 const ownerUserId=process.env.TELEGRAM_OWNER_USER_ID;
 return ownerUserId?String(user.id)===ownerUserId:chat.type==='private'&&String(user.id)===String(chat.id);
}
async function handleTelegramCallback(callback){
 if(!callback?.id)return;
 if(!isTelegramOwnerCallback(callback)){
  await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Это действие доступно только владельцу.',show_alert:true});
  return;
 }
 const data=String(callback.data||'');
 const match=/^(bc|bx):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(data);
 if(!match||Buffer.byteLength(data,'utf8')>64){
  await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Некорректная команда.',show_alert:true});
  return;
 }
 const [,action,bookingId]=match;
 const result=await transaction(async client=>{
  await lockBookingDates(client);
  const found=await client.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[bookingId]);
  if(!found.rowCount)return {notice:'Бронь не найдена.',showAlert:true};
  const booking=found.rows[0];
  if(booking.archived)return {notice:'Бронь уже убрана из истории.',showAlert:true};
  if(action==='bc'){
   if(booking.status==='confirmed')return {notice:'Бронирование уже подтверждено.',messageStatus:'✅ Бронирование подтверждено'};
   if(!['request','waitlist'].includes(booking.status))return {notice:'Эту бронь нельзя подтвердить из текущего статуса.',showAlert:true};
   const conflict=await client.query("SELECT 1 FROM calendar_blocks WHERE arrival<$2 AND departure>$1 UNION ALL SELECT 1 FROM bookings WHERE id<>$3 AND archived=false AND dates_released=false AND status IN ('confirmed','completed') AND arrival<$2 AND departure>$1 LIMIT 1",[booking.arrival,booking.departure,booking.id]);
   if(conflict.rowCount)return {notice:'Даты уже заняты. Бронь не изменена.',showAlert:true};
   const updated=await client.query("UPDATE bookings SET status='confirmed' WHERE id=$1 AND archived=false AND status IN ('request','waitlist') RETURNING id",[booking.id]);
   if(!updated.rowCount)return {notice:'Статус брони уже изменился. Обновите кабинет владельца.',showAlert:true};
   return {notice:'Бронирование подтверждено.',messageStatus:'✅ Бронирование подтверждено'};
  }
  if(booking.status==='cancelled')return {notice:'Бронирование уже отменено.',messageStatus:'❌ Бронирование отменено'};
  if(!['request','waitlist','confirmed'].includes(booking.status))return {notice:'Эту бронь нельзя отменить из текущего статуса.',showAlert:true};
  const updated=await client.query("UPDATE bookings SET status='cancelled' WHERE id=$1 AND archived=false AND status IN ('request','waitlist','confirmed') RETURNING id",[booking.id]);
  if(!updated.rowCount)return {notice:'Статус брони уже изменился. Обновите кабинет владельца.',showAlert:true};
  return {notice:'Бронирование отменено.',messageStatus:'❌ Бронирование отменено'};
 });
 try{await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:result.notice,show_alert:!!result.showAlert});}catch(error){console.error('Telegram callback acknowledgement failed',error.code||error.name);}
 if(result.messageStatus&&callback.message?.message_id){
  const original=String(callback.message.text||'').replace(/\n\n(?:✅ (?:Бронирование|Бронь) подтвержден[ао]|❌ (?:Бронирование|Заявка) отменен[ао])$/,'');
  const text=`${original}\n\n${result.messageStatus}`;
  if(text!==callback.message.text||callback.message.reply_markup?.inline_keyboard?.length){
   try{await telegram('editMessageText',{chat_id:callback.message.chat.id,message_id:callback.message.message_id,text,reply_markup:{inline_keyboard:[]}});}catch(error){console.error('Telegram booking message update failed',error.code||error.name);}
  }
 }
}
const sendPending=(forceRetry=false)=>sendTelegramOutbox({pool,telegram,forceRetry});
app.get('/api/mail',(req,res)=>{
 if(!requireAdmin(req,res))return;
 res.json({configured:isMailConfigured()});
});
app.post('/api/mail',async(req,res)=>{
 if(!requireAdmin(req,res))return;
 if(req.body?.action!=='test')return res.status(400).json({error:'Неизвестное действие почты'});
 if(!isMailConfigured())return res.status(503).json({error:'Почтовые уведомления не настроены'});
 try{
  await mailNotifications.sendTest();
  return res.json({ok:true});
 }catch(error){
  console.error('Mail test delivery failed',error.code||error.name);
  return res.status(503).json({error:'Не удалось отправить тестовое письмо'});
 }
});
app.get('/api/telegram',async(req,res)=>{const q=await pool.query("SELECT count(*)::int pending FROM telegram_outbox WHERE state IN ('pending','failed')");res.json({configured:!!process.env.TELEGRAM_BOT_TOKEN,connected:!!process.env.TELEGRAM_OWNER_CHAT_ID,pending:q.rows[0].pending});});
app.post('/api/telegram',async(req,res)=>{if(!requireAdmin(req,res))return;try{
 if(req.body?.action==='test'){
  if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_OWNER_CHAT_ID)return res.status(503).json({error:'Telegram не настроен'});
  await telegram('sendMessage',{chat_id:process.env.TELEGRAM_OWNER_CHAT_ID,text:'Коттедж на Хвойной: тестовое сообщение.'});
  return res.json({ok:true});
 }
 if(req.body?.action==='retry'){
  if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_OWNER_CHAT_ID)return res.status(503).json({error:'Telegram не настроен'});
  await sendPending(true);
  return res.json({ok:true});
 }
 if(req.body?.action==='reconnectWebhook'){
  const info=await reconnectTelegramWebhook(telegram,{
   token:process.env.TELEGRAM_BOT_TOKEN,
   secret:process.env.TELEGRAM_WEBHOOK_SECRET
  });
  return res.json({ok:true,info});
 }
 if(req.body?.action==='webhookInfo'){
  const scopes=[null,{type:'all_private_chats'},{type:'all_group_chats'},{type:'all_chat_administrators'}];
  if(process.env.TELEGRAM_OWNER_CHAT_ID)scopes.push({type:'chat',chat_id:process.env.TELEGRAM_OWNER_CHAT_ID});
  const [info,...commands]=await Promise.all([
   telegram('getWebhookInfo'),
   ...scopes.map(scope=>telegram('getMyCommands',scope?{scope}:{}))
  ]);
  const expectedUrl=new URL('https://собери-своих.рф/api/telegram/webhook').href;
  return res.json({urlConfigured:info.url===expectedUrl||info.url===`https://собери-своих.рф/api/telegram/webhook`,expectedUrl,pendingUpdateCount:info.pending_update_count,lastErrorDate:info.last_error_date||null,lastErrorMessage:info.last_error_message||null,commands:commands.map((list,index)=>({scope:scopes[index]?.type||'default',items:list.map(command=>command.command)}))});
 }
 return res.status(400).json({error:'Неизвестное действие Telegram'});
}catch(error){console.error('Telegram admin action failed',error.code||error.name);return res.status(503).json({error:'Не удалось выполнить действие Telegram'});}});
app.post('/api/telegram/webhook',async(req,res,next)=>{
 const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
 if(!secret)return res.status(503).json({error:'Webhook is not configured'});
 const supplied=Buffer.from(String(req.get('x-telegram-bot-api-secret-token')||'')),expected=Buffer.from(secret);
 if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.sendStatus(403);
 try{
  if(req.body?.callback_query){
   console.info('Telegram callback received');
   await handleTelegramCallback(req.body.callback_query);
  }else if(req.body?.message){
   await handleTelegramStart(req.body.message,{
    ownerChatId:process.env.TELEGRAM_OWNER_CHAT_ID,
    ownerUserId:process.env.TELEGRAM_OWNER_USER_ID,
    telegram
   });
  }
  res.sendStatus(200);
 }catch(error){
  console.error('Telegram callback processing failed',error.code||error.name);
  next(error);
 }
});
setInterval(()=>sendPending().catch(error=>console.error('Telegram outbox retry failed',error.code||error.name)),60*1000).unref();

// Protected API prepared for a future ChatGPT/MCP connector.
app.get('/admin-api/health',(req,res)=>{if(!requireAdmin(req,res))return;res.json({ok:true,service:'dom-na-hvoinoy'});});

app.use((error,req,res,next)=>{
 if(res.headersSent)return next(error);
 const connectionError=error.code?.startsWith('08')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','57P01'].includes(error.code);
 const status=error.status||(error.code==='23505'?409:connectionError?503:500);
 console.error('Request failed',req.method,req.path,error.code||error.name);
 const message=status===503?'Database is unavailable':status===409?'Conflict':status<500?(error.message||'Invalid request'):'Internal server error';
 res.status(status).json({error:message,...(error.retryAfter?{retryAfter:error.retryAfter}:{})});
});
app.get('/',async(req,res,next)=>{try{
 let html=await readFile(path.join(__dirname,'public','index.html'),'utf8');
 html=html
  .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi,'')
  .replace(/<meta\b[^>]*\bname=["'](?:description|robots)["'][^>]*>/gi,'')
  .replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi,'')
  .replace(/<meta\b(?=[^>]*\bproperty=["']og:(?:site_name|title|description|url|type)["'])[^>]*>/gi,'')
  .replace(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi,'');
 const structuredData=JSON.stringify({
  '@context':'https://schema.org',
  '@type':'WebSite',
  name:'Собери своих',
  alternateName:['Дом на Хвойной','собери-своих.рф'],
  url:'https://собери-своих.рф/'
 });
 const seoTags=[
  '<title>Собери своих — Дом на Хвойной в Екатеринбурге | аренда коттеджа</title>',
  '<meta name="description" content="Дом на Хвойной в Екатеринбурге — дизайнерский коттедж среди сосен. До 30 гостей, 5 спален, сауна и камин. Цены, свободные даты и бронирование на сайте.">',
  '<meta name="robots" content="index, follow">',
  '<link rel="canonical" href="https://собери-своих.рф/">',
  '<meta property="og:site_name" content="Собери своих">',
  '<meta property="og:title" content="Соберите своих. На Хвойной.">',
  '<meta property="og:description" content="Дизайнерский дом среди сосен в Екатеринбурге. До 30 гостей, 5 спален, камин и сауна без ограничений.">',
  '<meta property="og:url" content="https://собери-своих.рф/">',
  '<meta property="og:type" content="website">',
  `<script type="application/ld+json">${structuredData}</script>`
 ].join('');
 html=html.replace(/<\/head>/i,`${seoTags}</head>`);
 const styles=['<link rel="stylesheet" href="/booking-payment-info.css">'].filter(style=>!html.includes(style)).join('');
 if(styles)html=html.replace(/<\/head>/i,`${styles}</head>`);
 const scripts=['<script type="module" src="/house-gallery.js"></script>','<script type="module" src="/guest-cabinet.js"></script>','<script type="module" src="/admin-enhancements.js"></script>','<script type="module" src="/booking-payment-info.js"></script>'].filter(script=>!html.includes(script)).join('');
 if(scripts)html=html.replace(/<\/body>/i,`${scripts}</body>`);
 res.type('html').send(html);
}catch(error){next(error);}});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.use((req,res)=>{if(/^\/(api|admin-api)(\/|$)/.test(req.path))return res.status(404).json({error:'Not found'});res.sendFile(path.join(__dirname,'public','index.html'));});
async function startServer(){
 if(pool){
  const schema=await readFile(path.join(__dirname,'schema.sql'),'utf8');
  await pool.query(schema);
 }
 app.listen(PORT,'0.0.0.0',()=>console.log(`dom-na-hvoinoy listening on ${PORT}`));
}
startServer().catch(error=>{
 console.error('Database schema initialization failed:', error.code || error.name, error.message);
 process.exit(1);
});
