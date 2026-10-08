import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTelegramStart } from '../telegram-start.js';

test('owner /start in private chat removes only the reply keyboard',async()=>{
 const calls=[];
 const handled=await handleTelegramStart({
  text:'/start@house_bot',
  chat:{id:123,type:'private'},
  from:{id:123,is_bot:false}
 },{
  ownerChatId:'-100987',
  ownerUserId:'123',
  telegram:async(method,payload)=>calls.push({method,payload})
 });
 assert.equal(handled,true);
 assert.deepEqual(calls,[{
  method:'sendMessage',
  payload:{chat_id:123,text:'Старая клавиатура удалена.',reply_markup:{remove_keyboard:true}}
 }]);
});

test('non-owner and group /start messages do not receive bot actions',async()=>{
 const calls=[];
 const telegram=async(...args)=>calls.push(args);
 const options={ownerChatId:'123',ownerUserId:'123',telegram};
 assert.equal(await handleTelegramStart({text:'/start',chat:{id:456,type:'private'},from:{id:456}},options),false);
 assert.equal(await handleTelegramStart({text:'/start',chat:{id:-100,type:'group'},from:{id:123}},options),false);
 assert.equal(await handleTelegramStart({text:'/start-help',chat:{id:123,type:'private'},from:{id:123}},options),false);
 assert.deepEqual(calls,[]);
});

test('private owner is identified by configured chat ID when user ID is unset',async()=>{
 let payload;
 const handled=await handleTelegramStart({
  text:'/start',
  chat:{id:123,type:'private'},
  from:{id:123}
 },{
  ownerChatId:'123',
  telegram:async(_method,value)=>{payload=value;}
 });
 assert.equal(handled,true);
 assert.equal(payload.chat_id,123);
 assert.deepEqual(payload.reply_markup,{remove_keyboard:true});
});
