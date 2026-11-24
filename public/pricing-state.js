// The owner's configured tariffs are the only source of public prices.
// A missing or malformed response must never become a guessed price.
function validPrice(value){
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1_000_000;
}
export function isConfiguredPricing(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(![value.weekday,value.friday,value.saturday].every(validPrice))return false;
  if(!value.dates||typeof value.dates!=='object'||Array.isArray(value.dates))return false;
  return Object.values(value.dates).every(validPrice);
}
