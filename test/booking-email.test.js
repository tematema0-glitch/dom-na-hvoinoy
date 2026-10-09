import test from 'node:test';
import assert from 'node:assert/strict';
import {
 BOOKING_EMAIL_SUBJECT,
 completeBookingSubmission,
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

test('a persisted booking produces a complete email while the public response keeps its original shape',async()=>{
 const savedBooking={
  id:'booking-from-postgres',
  name:'Мария Иванова',
  phone:'79991112233',
  arrival:'2026-12-03',
  departure:'2026-12-06',
  guests:5,
  total:72500,
  status:'waitlist'
 };
 let response;
 let deferred;
 let sentMessage;
 const service=createMailNotificationService({
  env,
  createTransport:()=>({async sendMail(message){sentMessage=message;}})
 });

 completeBookingSubmission(savedBooking,{
  respond:value=>{response={status:201,body:value};},
  notify:created=>scheduleBookingEmail(created,{
   sendBooking:service.sendBooking,
   schedule:callback=>{deferred=callback;}
  })
 });

 assert.deepEqual(response,{
  status:201,
  body:{
   id:'booking-from-postgres',
   status:'waitlist',
   total:72500,
   availability:'waitlist'
  }
 });
 assert.equal(deferred instanceof Function,true);
 assert.equal(sentMessage,undefined);
 deferred();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sentMessage.subject,BOOKING_EMAIL_SUBJECT);
 assert.match(sentMessage.text,/Гость: Мария Иванова/);
 assert.match(sentMessage.text,/Телефон: 79991112233/);
 assert.ok(sentMessage.text.includes('Заезд: 3 декабря 2026 г.'));
 assert.ok(sentMessage.text.includes('Выезд: 6 декабря 2026 г.'));
 assert.match(sentMessage.text,/Количество гостей: 5/);
 assert.match(sentMessage.text,/Стоимость: 72 500 ₽/);
 assert.match(sentMessage.text,/Статус заявки: Лист ожидания/);
});

test('SMTP failure after booking persistence does not change the booking response',async()=>{
 const savedBooking={
  id:'booking-mail-failure',
  name:'Пётр Петров',
  phone:'79990001122',
  arrival:'2026-12-03',
  departure:'2026-12-04',
  guests:2,
  total:24000,
  status:'request'
 };
 let response;
 let deferred;
 const errors=[];
 const failedService=createMailNotificationService({
  env,
  createTransport:()=>({async sendMail(){throw Object.assign(new Error('SMTP offline'),{code:'ETIMEDOUT'});}})
 });
 completeBookingSubmission(savedBooking,{
  respond:value=>{response=value;},
  notify:created=>scheduleBookingEmail(created,{
   sendBooking:failedService.sendBooking,
   logger:{error:(...args)=>errors.push(args)},
   schedule:callback=>{deferred=callback;}
  })
 });
 assert.equal(response.id,savedBooking.id);
 assert.equal(errors.length,0);
 deferred();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(response.id,savedBooking.id);
 assert.deepEqual(errors,[['Booking email delivery failed','ETIMEDOUT']]);
});
