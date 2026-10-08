export const TELEGRAM_WEBHOOK_URL = 'https://собери-своих.рф/api/telegram/webhook';

const webhookInfoFields = new Set([
 'url',
 'has_custom_certificate',
 'pending_update_count',
 'ip_address',
 'last_error_date',
 'last_error_message',
 'last_synchronization_error_date',
 'max_connections',
 'allowed_updates'
]);

export async function reconnectTelegramWebhook(telegram,{token,secret}){
 if(!token||!secret)throw new Error('Telegram webhook is not configured');
 await telegram('setWebhook',{
  url:TELEGRAM_WEBHOOK_URL,
  secret_token:secret,
  allowed_updates:['message','callback_query'],
  drop_pending_updates:false
 });
 const info=await telegram('getWebhookInfo');
 return Object.fromEntries(Object.entries(info).filter(([key])=>webhookInfoFields.has(key)));
}
