export async function handleTelegramStart(message,{ownerChatId,ownerUserId,telegram}){
 const text=message?.text;
 if(typeof text!=='string'||!/^\/start(?:@[a-zA-Z0-9_]+)?(?:\s|$)/.test(text))return false;

 const chat=message.chat;
 const user=message.from;
 if(chat?.type!=='private'||!chat.id||!user?.id||user.is_bot||String(chat.id)!==String(user.id))return false;

 const isOwner=ownerUserId
  ?String(user.id)===String(ownerUserId)
  :ownerChatId&&String(chat.id)===String(ownerChatId);
 if(!isOwner)return false;

 await telegram('sendMessage',{
  chat_id:chat.id,
  text:'Старая клавиатура удалена.',
  reply_markup:{remove_keyboard:true}
 });
 return true;
}
