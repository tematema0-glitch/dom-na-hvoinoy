import test from 'node:test';
import assert from 'node:assert/strict';
import {
 BOOKING_EMAIL_SUBJECT,
 createBookingEmail,
 createMailNotificationService,
 isMailConfigured,
 scheduleBookingEmail
} from '../booking-email.js';

const env={
 MAIL_USER:'owner@mail.ru',
 MAIL_APP_PASSWORD:'private-app-password',
 MAIL_TO:'reservations@example.com'
};

const booking={
 name:'<Иван> & Анна',
 phone:'79990000000',
 arrival:'2026-12-03',
 departure:'2026-12-06',
 guests:4,
 total:68000,
 status:'request'
};

test('booking email contains all Russian booking details and escapes guest input',()=>{
 const email=createBookingEmail(booking);
 assert.equal(BOOKING_EMAIL_SUBJECT,'🌲 Новая заявка — Собери своих');
 assert.match(email.text,/Гость: <Иван> & Анна/);
 assert.match(email.text,/Телефон: 79990000000/);
 assert.ok(email.text.includes('Заезд: 3 декабря 2026 г.'));
 assert.ok(email.text.includes('Выезд: 6 декабря 2026 г.'));
 assert.match(email.text,/Количество гостей: 4/);
 assert.match(email.text,/Стоимость: 68 000 ₽/);
 assert.match(email.text,/Статус заявки: Новая заявка/);
 assert.match(email.html,/&lt;Иван&gt; &amp; Анна/);
 assert.doesNotMatch(email.html,/<Иван>/);
});

test('SMTP delivery uses Mail.ru SSL settings and configured addresses',async()=>{
 let transportOptions;
 let message;
 const service=createMailNotificationService({
  env,
  createTransport(options){
   transportOptions=options;
   return{async sendMail(value){message=value;}};
  }
 });
 await service.sendBooking(booking);
 assert.deepEqual(transportOptions,{
  host:'smtp.mail.ru',
  port:465,
  secure:true,
  connectionTimeout:5000,
  greetingTimeout:5000,
  socketTimeout:10000,
  auth:{user:env.MAIL_USER,pass:env.MAIL_APP_PASSWORD}
 });
 assert.equal(message.from,env.MAIL_USER);
 assert.equal(message.to,env.MAIL_TO);
 assert.equal(message.subject,BOOKING_EMAIL_SUBJECT);
 assert.equal(message.text.includes(env.MAIL_APP_PASSWORD),false);
});

test('missing mail settings fail clearly without creating an SMTP transport',async()=>{
 assert.equal(isMailConfigured(env),true);
 assert.equal(isMailConfigured({MAIL_USER:env.MAIL_USER,MAIL_TO:env.MAIL_TO}),false);
 let transportCreated=false;
 const service=createMailNotificationService({
  env:{MAIL_USER:env.MAIL_USER,MAIL_TO:env.MAIL_TO},
  createTransport(){transportCreated=true;throw new Error('must not be called');}
 });
 await assert.rejects(service.sendTest(),/Mail notifications are not configured/);
 assert.equal(transportCreated,false);
});

test('test email uses the configured recipient and reports transport failures',async()=>{
 let message;
 const service=createMailNotificationService({
  env,
  createTransport:()=>({async sendMail(value){message=value;}})
 });
 await service.sendTest();
 assert.equal(message.to,env.MAIL_TO);
 assert.match(message.subject,/Тест уведомлений/);
 assert.match(message.text,/Тестовое письмо/);

 const failed=createMailNotificationService({
  env,
  createTransport:()=>({async sendMail(){throw Object.assign(new Error(env.MAIL_APP_PASSWORD),{code:'EAUTH'});}})
 });
 await assert.rejects(failed.sendTest(),error=>error.code==='EAUTH');
});

test('booking notification is deferred and delivery failures never escape the request path',async()=>{
 let deferred;
 let delivered=false;
 const logged=[];
 scheduleBookingEmail(booking,{
  sendBooking:async()=>{delivered=true;throw Object.assign(new Error(env.MAIL_APP_PASSWORD),{code:'ETIMEDOUT'});},
  logger:{error:(...args)=>logged.push(args)},
  schedule:callback=>{deferred=callback;}
 });
 assert.equal(delivered,false);
 assert.deepEqual(logged,[]);
 deferred();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(delivered,true);
 assert.deepEqual(logged,[['Booking email delivery failed','ETIMEDOUT']]);
 assert.equal(JSON.stringify(logged).includes(env.MAIL_APP_PASSWORD),false);
});
