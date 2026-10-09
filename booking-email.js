import nodemailer from 'nodemailer';

export const BOOKING_EMAIL_SUBJECT = '🌲 Новая заявка — Собери своих';

const statusLabels = {
 waitlist: 'Лист ожидания',
 request: 'Новая заявка',
 confirmed: 'Подтверждена',
 completed: 'Завершена',
 cancelled: 'Отменена'
};

function mailConfiguration(env){
 const user=String(env.MAIL_USER||'').trim();
 const password=String(env.MAIL_APP_PASSWORD||'');
 const recipient=String(env.MAIL_TO||'').trim();
 if(!user||!password.trim()||!recipient)throw new Error('Mail notifications are not configured');
 return{user,password,recipient};
}

export function isMailConfigured(env=process.env){
 try{mailConfiguration(env);return true;}catch{return false;}
}

function escapeHtml(value){
 return String(value).replace(/[&<>"']/g,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[character]);
}

function formatDate(value){
 return new Intl.DateTimeFormat('ru-RU',{
  day:'numeric',month:'long',year:'numeric',timeZone:'UTC'
 }).format(new Date(`${value}T00:00:00Z`));
}

function bookingDetails(booking){
 const status=statusLabels[booking.status]||'Неизвестен';
 return[
  ['Гость',booking.name],
  ['Телефон',booking.phone],
  ['Заезд',formatDate(booking.arrival)],
  ['Выезд',formatDate(booking.departure)],
  ['Количество гостей',`${booking.guests}`],
  ['Стоимость',`${new Intl.NumberFormat('ru-RU').format(booking.total)} ₽`],
  ['Статус заявки',status]
 ];
}

export function createBookingEmail(booking){
 const details=bookingDetails(booking);
 const text=[
  BOOKING_EMAIL_SUBJECT,
  '',
  ...details.map(([label,value])=>`${label}: ${value}`)
 ].join('\n');
 const rows=details.map(([label,value])=>`
  <tr>
   <th align="left" style="padding:12px 16px;color:#647067;font-size:14px;font-weight:500;border-bottom:1px solid #e9eee8">${escapeHtml(label)}</th>
   <td align="right" style="padding:12px 16px;color:#24382b;font-size:14px;font-weight:600;border-bottom:1px solid #e9eee8">${escapeHtml(value)}</td>
  </tr>`).join('');
 const html=`<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 12px;background:#f2f5f0;font-family:Arial,sans-serif;color:#24382b">
 <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e9e1;border-radius:18px;overflow:hidden">
  <div style="padding:28px 30px;background:#234c36;color:#fff">
   <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#d0dfd1">Собери своих</div>
   <h1 style="margin:10px 0 0;font-size:25px;line-height:1.3">🌲 Новая заявка</h1>
  </div>
  <div style="padding:24px 18px">
   <p style="margin:0 12px 18px;color:#59675d;font-size:15px;line-height:1.6">Поступила новая заявка на бронирование дома на Хвойной.</p>
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9eee8;border-radius:12px;border-spacing:0;overflow:hidden">${rows}</table>
  </div>
  <div style="padding:16px 30px;background:#f7f9f6;color:#7a857c;font-size:12px">Автоматическое уведомление с сайта «Собери своих»</div>
 </div>
</body>
</html>`;
 return{text,html};
}

export function createMailNotificationService({env=process.env,createTransport=nodemailer.createTransport}={}){
 let transporter;
 const send=async message=>{
  const config=mailConfiguration(env);
  transporter??=createTransport({
   host:'smtp.mail.ru',
   port:465,
   secure:true,
   connectionTimeout:5000,
   greetingTimeout:5000,
   socketTimeout:10000,
   auth:{user:config.user,pass:config.password}
  });
  await transporter.sendMail({
   from:config.user,
   to:config.recipient,
   ...message
  });
 };
 return{
  sendBooking(booking){
   return send({subject:BOOKING_EMAIL_SUBJECT,...createBookingEmail(booking)});
  },
  sendTest(){
   return send({
    subject:'🌲 Тест уведомлений — Собери своих',
    text:'Тестовое письмо. Уведомления о новых заявках настроены.',
    html:'<div style="max-width:560px;margin:24px auto;padding:28px;border:1px solid #e2e9e1;border-radius:16px;font-family:Arial,sans-serif;color:#24382b"><div style="font-size:13px;letter-spacing:2px;color:#59735f">СОБЕРИ СВОИХ</div><h1 style="font-size:24px">🌲 Почта подключена</h1><p style="line-height:1.6">Тестовое письмо. Уведомления о новых заявках настроены.</p></div>'
   });
  }
 };
}

export function scheduleBookingEmail(booking,{sendBooking,logger=console,schedule=setImmediate}){
 schedule(()=>Promise.resolve().then(()=>sendBooking(booking)).catch(error=>{
  logger.error('Booking email delivery failed',error.code||error.name);
 }));
}
