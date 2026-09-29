import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();
const json = express.json({ limit: '256kb' });
app.use(json);

const id = () => crypto.randomUUID();
const phone = v => String(v || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
const cookie = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),decodeURIComponent(v.slice(i+1))]}));
function isAdmin(req){ const t=cookie(req).hvoinaya_admin; const s=t&&sessions.get(t); return !!(s && s > Date.now()); }
function requireAdmin(req,res){ if(!isAdmin(req)){res.status(401).json({error:'Требуется вход владельца'});return false} return true; }
function nights(a,b){ return Math.max(0, Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)); }
async function pricing(){ const r=await pool.query("SELECT value FROM settings WHERE key='pricing'"); return r.rows[0]?.value || {weekday:23000,friday:30000,saturday:34000,dates:{}}; }
function stayPrice(a,b,g,p,firstReferral=false){ let total=0; for(let d=new Date(a+'T00:00:00Z'),end=new Date(b+'T00:00:00Z');d<end;d.setUTCDate(d.getUTCDate()+1)){ const ds=d.toISOString().slice(0,10); const dow=d.getUTCDay(); let base=Number(p.dates?.[ds] ?? (dow===5?p.friday:dow===6?p.saturday:p.weekday)); total += base + Math.max(0,Number(g)-12)*1000 - (firstReferral?2000:0); } return Math.max(0,total); }
async function balances(){ const q=await pool.query(`SELECT m.id, COALESCE(SUM(CASE WHEN l.kind='earned' THEN l.points WHEN l.kind IN ('deducted','reserved','spent') THEN -l.points WHEN l.kind='release' THEN l.points ELSE 0 END),0)::int balance FROM members m LEFT JOIN point_ledger l ON l.member_id=m.id GROUP BY m.id`); return Object.fromEntries(q.rows.map(x=>[x.id,x.balance])); }

app.get('/api/pricing', async(req,res)=>res.json(await pricing()));
app.get('/api/availability', async(req,res)=>{ const q=await pool.query(`SELECT arrival::text,departure::text FROM calendar_blocks UNION SELECT arrival::text,departure::text FROM bookings WHERE status IN ('request','waitlist','confirmed','completed') AND dates_released=false ORDER BY arrival`); res.json({ranges:q.rows}); });

app.post('/api/members', async(req,res)=>{ try{ const a=req.body?.action; const ph=phone(req.body?.phone); if(!ph) return res.status(400).json({error:'Укажите телефон'}); if(a==='lookup'){ const q=await pool.query('SELECT * FROM members WHERE phone=$1',[ph]); if(!q.rowCount)return res.status(404).json({error:'Участник не найден'}); const b=await balances(); return res.json({...q.rows[0],balance:b[q.rows[0].id]||0}); }
 if(a==='join'){ const name=String(req.body?.name||'').trim(); if(!name)return res.status(400).json({error:'Укажите имя'}); let q=await pool.query('SELECT * FROM members WHERE phone=$1',[ph]); if(!q.rowCount){ const mid='phone:'+id(), code='DOM'+crypto.randomBytes(4).toString('hex').toUpperCase(); q=await pool.query('INSERT INTO members(id,name,phone,code) VALUES($1,$2,$3,$4) RETURNING *',[mid,name,ph,code]); } return res.json(q.rows[0]); }
 res.status(400).json({error:'Неизвестное действие'}); }catch(e){console.error(e);res.status(500).json({error:'Ошибка сервера'});} });

app.post('/api/bookings', async(req,res)=>{ try{ if(req.body?.website) return res.status(400).json({error:'Заявка отклонена'}); const {name,arrival,departure,guests=12,code,requestKey}=req.body||{}; const ph=phone(req.body?.phone); if(!name||!ph||!arrival||!departure||!requestKey||nights(arrival,departure)<1)return res.status(400).json({error:'Проверьте данные бронирования'});
 const old=await pool.query('SELECT id FROM bookings WHERE request_key=$1',[requestKey]); if(old.rowCount)return res.status(409).json({error:'Эта заявка уже отправлена'});
 const occ=await pool.query(`SELECT 1 FROM calendar_blocks WHERE arrival < $2 AND departure > $1 UNION ALL SELECT 1 FROM bookings WHERE status IN ('request','waitlist','confirmed','completed') AND dates_released=false AND arrival < $2 AND departure > $1 LIMIT 1`,[arrival,departure]);
 let ref=null, first=false; if(code){const rq=await pool.query('SELECT id FROM members WHERE code=$1',[String(code).trim().toUpperCase()]); ref=rq.rows[0]?.id||null; if(ref){const prev=await pool.query("SELECT 1 FROM bookings WHERE phone=$1 AND status<>'cancelled' LIMIT 1",[ph]);first=!prev.rowCount;}}
 const p=await pricing(), nn=nights(arrival,departure), total=stayPrice(arrival,departure,guests,p,first), bid=id(), status=occ.rowCount?'waitlist':'request';
 await pool.query(`INSERT INTO bookings(id,name,phone,arrival,departure,guests,nights,total,referrer,status,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[bid,String(name).trim(),ph,arrival,departure,Number(guests),nn,total,ref,status,requestKey]);
 await pool.query('INSERT INTO telegram_outbox(booking_id,payload) VALUES($1,$2)',[bid,JSON.stringify({type:'booking',id:bid,name,phone:ph,arrival,departure,guests,total,status})]); sendPending().catch(console.error);
 res.status(201).json({id:bid,status,total,availability:status==='waitlist'?'waitlist':'request'}); }catch(e){console.error(e);res.status(500).json({error:'Не удалось отправить заявку'});} });

app.post('/api/admin/login', async(req,res)=>{ const ph=phone(req.body?.phone); if(ph!==phone(process.env.OWNER_PHONE)||String(req.body?.password||'')!==String(process.env.OWNER_PASSWORD||''))return res.status(401).json({error:'Неверный телефон или пароль'}); const t=crypto.randomBytes(32).toString('hex');sessions.set(t,Date.now()+30*86400000);res.setHeader('Set-Cookie',`hvoinaya_admin=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);res.json({ok:true}); });
app.post('/api/admin/logout',(req,res)=>{const t=cookie(req).hvoinaya_admin;if(t)sessions.delete(t);res.setHeader('Set-Cookie','hvoinaya_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');res.json({ok:true});});

app.get('/api/club', async(req,res)=>{ try{ const ph=phone(req.query.phone||''); let me=null; if(ph){const q=await pool.query('SELECT * FROM members WHERE phone=$1',[ph]);me=q.rows[0]||null;} const admin=isAdmin(req); const b=await balances(); if(!admin){return res.json({me,isAdmin:false,balance:me?b[me.id]||0:0,userId:me?.id||null,members:[],deductions:[],blocks:[],bookings:[],rewards:[]});}
 const [m,d,bl,bk,rw]=await Promise.all([pool.query('SELECT * FROM members ORDER BY created_at'),pool.query("SELECT member_id,points,reason,created_at AS created FROM point_ledger WHERE kind='deducted' ORDER BY created_at DESC"),pool.query('SELECT id,arrival::text,departure::text,note,kind,created_at AS created FROM calendar_blocks ORDER BY arrival'),pool.query('SELECT id,user_id,name,phone,arrival::text,departure::text,guests,nights,total,referrer,status,created_at AS created,request_key,early_credited,archived,dates_released,telegram_state,telegram_attempted_at FROM bookings ORDER BY created_at DESC'),pool.query('SELECT id,member_id,kind,date::text,called,points,status,created_at AS created FROM rewards ORDER BY created_at DESC')]);
 res.json({me,isAdmin:true,members:m.rows.map(x=>({...x,balance:b[x.id]||0})),deductions:d.rows,blocks:bl.rows,bookings:bk.rows,rewards:rw.rows,balance:me?b[me.id]||0:0,userId:me?.id||null}); }catch(e){console.error(e);res.status(500).json({error:'Не удалось загрузить кабинет'});} });

app.post('/api/club', async(req,res)=>{ if(!requireAdmin(req,res))return; const x=req.body||{}; try{ switch(x.action){
 case 'blockDates': await pool.query('INSERT INTO calendar_blocks(id,arrival,departure,kind,note) VALUES($1,$2,$3,$4,$5)',[id(),x.arrival,x.departure,x.kind||'blocked',x.note||'']);break;
 case 'removeBlock': await pool.query('DELETE FROM calendar_blocks WHERE id=$1',[x.id]);break;
 case 'setPrices': {const p=await pricing();p.weekday=Number(x.weekday);p.friday=Number(x.friday);p.saturday=Number(x.saturday);await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;}
 case 'setDatePrice': {const p=await pricing();p.dates={...(p.dates||{}),[x.date]:Number(x.price)};await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;}
 case 'removeDatePrice': {const p=await pricing();delete p.dates?.[x.date];await pool.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[p]);break;}
 case 'memberNote': await pool.query('UPDATE members SET note=$1 WHERE id=$2',[x.note||'',x.memberId]);break;
 case 'deductPoints': await pool.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id) VALUES($1,$2,'deducted',$3,$4) ON CONFLICT(request_id) DO NOTHING",[x.memberId,Number(x.points),x.reason||'',x.requestId]);break;
 case 'bookingStatus': {const q=await pool.query('UPDATE bookings SET status=$1,early_credited=CASE WHEN $1=\'completed\' AND $3 THEN true ELSE early_credited END WHERE id=$2 RETURNING *',[x.status,x.id,!!x.acceptEarlyRisk]);const bk=q.rows[0]; if(bk&&x.status==='completed'&&bk.referrer){const rid='booking:'+bk.id;await pool.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,booking_id) VALUES($1,$2,'earned','Завершённое проживание',$3,$4) ON CONFLICT(request_id) DO NOTHING",[bk.referrer,bk.nights,rid,bk.id]);}break;}
 case 'releaseDates': await pool.query('UPDATE bookings SET dates_released=true WHERE id=$1',[x.id]);break;
 case 'deleteBooking': await pool.query('UPDATE bookings SET archived=true WHERE id=$1',[x.id]);break;
 case 'reward': {const mid=x.memberId; if(!mid)throw Error('memberId required');const rid=id();await pool.query('INSERT INTO rewards(id,member_id,kind,date,points) VALUES($1,$2,$3,$4,10)',[rid,mid,x.kind,x.date||null]);await pool.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,10,'reserved','Запрос награды',$2,$3)",[mid,'reward:'+rid,rid]);break;}
 case 'memberReward': {const rid=id();await pool.query('INSERT INTO rewards(id,member_id,kind,date,called,points) VALUES($1,$2,$3,$4,$5,10)',[rid,x.memberId,x.kind,x.date||null,!!x.called]);await pool.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,10,'reserved','Запрос награды владельцем',$2,$3)",[x.memberId,'reward:'+rid,rid]);break;}
 case 'rewardStatus': {const q=await pool.query('UPDATE rewards SET status=$1,updated_at=now() WHERE id=$2 RETURNING *',[x.status,x.id]);const rw=q.rows[0];if(rw&&x.status==='rejected')await pool.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'release','Награда отклонена',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-release:'+rw.id,rw.id]);if(rw&&x.status==='issued')await pool.query("INSERT INTO point_ledger(member_id,points,kind,reason,request_id,reward_id) VALUES($1,$2,'spent','Награда выдана',$3,$4) ON CONFLICT(request_id) DO NOTHING",[rw.member_id,rw.points,'reward-spent:'+rw.id,rw.id]);break;}
 default:return res.status(400).json({error:'Неизвестное действие'}); }
 res.json({ok:true}); }catch(e){console.error(e);res.status(400).json({error:e.message||'Ошибка'});} });

async function telegram(method,payload={}){ const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw Error('Telegram не настроен');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();if(!j.ok)throw Error(j.description||'Telegram error');return j.result; }
async function sendPending(){if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_OWNER_CHAT_ID)return;const q=await pool.query("SELECT * FROM telegram_outbox WHERE state IN ('pending','failed') ORDER BY id LIMIT 20");for(const row of q.rows){try{const p=row.payload;await telegram('sendMessage',{chat_id:process.env.TELEGRAM_OWNER_CHAT_ID,text:`Новая заявка: ${p.name}\n${p.phone}\n${p.arrival} — ${p.departure}\nГостей: ${p.guests}\nСтоимость: ${p.total} ₽`});await pool.query("UPDATE telegram_outbox SET state='sent',attempts=attempts+1,attempted_at=now(),last_error=NULL WHERE id=$1",[row.id]);}catch(e){await pool.query("UPDATE telegram_outbox SET state='failed',attempts=attempts+1,attempted_at=now(),last_error=$2 WHERE id=$1",[row.id,String(e.message)]);}}}
app.get('/api/telegram',async(req,res)=>{const q=await pool.query("SELECT count(*)::int pending FROM telegram_outbox WHERE state IN ('pending','failed')");res.json({configured:!!process.env.TELEGRAM_BOT_TOKEN,connected:!!process.env.TELEGRAM_OWNER_CHAT_ID,pending:q.rows[0].pending});});
app.post('/api/telegram',async(req,res)=>{if(!requireAdmin(req,res))return;try{if(req.body?.action==='test'){await telegram('sendMessage',{chat_id:process.env.TELEGRAM_OWNER_CHAT_ID,text:'Коттедж на Хвойной: тестовое сообщение.'});return res.json({ok:true});}if(req.body?.action==='retry'){await sendPending();return res.json({ok:true});}return res.status(400).json({error:'Для begin/connect подключение будет завершено после настройки бота'});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/telegram/webhook',async(req,res)=>{try{if(process.env.TELEGRAM_WEBHOOK_SECRET&&req.headers['x-telegram-bot-api-secret-token']!==process.env.TELEGRAM_WEBHOOK_SECRET)return res.sendStatus(403);const chat=req.body?.message?.chat?.id;if(chat&&!process.env.TELEGRAM_OWNER_CHAT_ID)console.log('TELEGRAM CHAT ID:',chat);res.json({ok:true});}catch{res.json({ok:true});}});

// Protected API prepared for a future ChatGPT/MCP connector.
app.get('/admin-api/health',(req,res)=>{if(!requireAdmin(req,res))return;res.json({ok:true,service:'dom-na-hvoinoy'});});

app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`dom-na-hvoinoy listening on ${PORT}`));
