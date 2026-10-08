export const TELEGRAM_OUTBOX_MAX_ATTEMPTS=8;
export const TELEGRAM_OUTBOX_RETRY_BASE_SECONDS=60;
export const TELEGRAM_OUTBOX_RETRY_MAX_SECONDS=3600;

export function telegramOutboxRetryDelaySeconds(attempts){
 return Math.min(
  TELEGRAM_OUTBOX_RETRY_MAX_SECONDS,
  TELEGRAM_OUTBOX_RETRY_BASE_SECONDS*2**Math.min(Math.max(attempts-1,0),30)
 );
}

export async function sendTelegramOutbox({pool,telegram,logger=console,forceRetry=false}){
 if(!pool||!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_OWNER_CHAT_ID)return;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query(
   `SELECT * FROM telegram_outbox
    WHERE state='pending' OR (
     state='failed' AND ($1::boolean OR (
      attempts<$2 AND COALESCE(attempted_at,'-infinity'::timestamptz)
       <=now()-make_interval(secs=>LEAST($3::double precision,$4::double precision*power(2::double precision,GREATEST(attempts-1,0))))
     ))
    )
    ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END,
     CASE WHEN state='failed' THEN attempted_at END ASC NULLS FIRST,id
    LIMIT 10 FOR UPDATE SKIP LOCKED`,
   [forceRetry,TELEGRAM_OUTBOX_MAX_ATTEMPTS,TELEGRAM_OUTBOX_RETRY_MAX_SECONDS,TELEGRAM_OUTBOX_RETRY_BASE_SECONDS]
  );
  for(const row of q.rows){
   const p=row.payload;
   const bookingId=p.id||row.booking_id;
   const isStatus=p.type==='booking-status';
   const keyboard=!isStatus&&typeof bookingId==='string'&&Buffer.byteLength(`bc:${bookingId}`,'utf8')<=64
    ?{inline_keyboard:[[{text:'✅ Подтвердить',callback_data:`bc:${bookingId}`},{text:'❌ Отменить',callback_data:`bx:${bookingId}`}]]}
    :undefined;
   const text=isStatus
    ?`${p.status==='confirmed'?'✅ БРОНЬ ПОДТВЕРЖДЕНА':'❌ БРОНЬ ОТМЕНЕНА'}\n\nГость: ${p.name}\nТелефон: ${p.phone}\nЗаезд: ${p.arrival}\nВыезд: ${p.departure}\nГостей: ${p.guests}`
    :`Новая заявка: ${p.name}\n${p.phone}\n${p.arrival} — ${p.departure}\nГостей: ${p.guests}\nСтоимость: ${p.total} ₽`;
   try{
    await telegram('sendMessage',{chat_id:process.env.TELEGRAM_OWNER_CHAT_ID,text,...(keyboard?{reply_markup:keyboard}:{})});
    await client.query("UPDATE telegram_outbox SET state='sent',attempts=attempts+1,attempted_at=now(),last_error=NULL WHERE id=$1",[row.id]);
   }catch(error){
    logger.error('Telegram outbox delivery failed',row.id,error.code||error.name);
    await client.query("UPDATE telegram_outbox SET state='failed',attempts=attempts+1,attempted_at=now(),last_error='Delivery failed' WHERE id=$1",[row.id]);
   }
  }
  await client.query('COMMIT');
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
