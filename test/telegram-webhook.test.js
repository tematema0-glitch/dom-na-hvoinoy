import test from 'node:test';
import assert from 'node:assert/strict';
import {reconnectTelegramWebhook,TELEGRAM_WEBHOOK_URL} from '../telegram-webhook.js';

test('reconnect registers only the required updates without dropping pending updates',async()=>{
 const calls=[];
 const info={
  url:new URL(TELEGRAM_WEBHOOK_URL).href,
  has_custom_certificate:false,
  pending_update_count:3,
  ip_address:'192.0.2.1',
  last_error_date:123,
  last_error_message:'Temporary failure',
  max_connections:40,
  allowed_updates:['message','callback_query'],
  secret_token:'must not be returned',
  unrecognized_field:'must not be returned'
 };
 const result=await reconnectTelegramWebhook(async(method,payload)=>{
  calls.push({method,payload});
  return method==='getWebhookInfo'?info:true;
 },{token:'bot-token',secret:'webhook-secret'});

 assert.deepEqual(calls,[
  {
   method:'setWebhook',
   payload:{
    url:TELEGRAM_WEBHOOK_URL,
    secret_token:'webhook-secret',
    allowed_updates:['message','callback_query'],
    drop_pending_updates:false
   }
  },
  {method:'getWebhookInfo',payload:undefined}
 ]);
 assert.deepEqual(result,{
  url:info.url,
  has_custom_certificate:false,
  pending_update_count:3,
  ip_address:'192.0.2.1',
  last_error_date:123,
  last_error_message:'Temporary failure',
  max_connections:40,
  allowed_updates:['message','callback_query']
 });
 assert.equal(JSON.stringify(result).includes('webhook-secret'),false);
 assert.equal(JSON.stringify(result).includes('bot-token'),false);
});

test('reconnect requires both Telegram secrets before making API calls',async()=>{
 let called=false;
 await assert.rejects(
  reconnectTelegramWebhook(async()=>{called=true;},{token:'bot-token',secret:''}),
  /Telegram webhook is not configured/
 );
 assert.equal(called,false);
});

test('does not request webhook info when Telegram rejects setWebhook',async()=>{
 const calls=[];
 await assert.rejects(
  reconnectTelegramWebhook(async method=>{
   calls.push(method);
   throw new Error('Telegram request failed');
  },{token:'bot-token',secret:'webhook-secret'}),
  /Telegram request failed/
 );
 assert.deepEqual(calls,['setWebhook']);
});
