import { dateRangeInclusive } from './public/date-price-range.js';

const ONE_DAY_MS=86_400_000;

export function nextCalendarDate(isoDate){
  const stamp=Date.parse(isoDate+'T00:00:00Z');
  if(!Number.isFinite(stamp))throw Object.assign(new Error('Некорректная дата'),{status:400});
  return new Date(stamp+ONE_DAY_MS).toISOString().slice(0,10);
}

export function parseAvailabilityChange(input){
  const x=input||{};
  if(x.operation!=='open'&&x.operation!=='close')throw Object.assign(new Error('Неверное действие с датами'),{status:400});
  let days;
  try{days=dateRangeInclusive(x.from,x.to,180);}
  catch{throw Object.assign(new Error('Выберите от 1 до 180 последовательных ночей'),{status:400});}
  const kind=x.operation==='close'?(x.kind||'blocked'):'blocked';
  if(!['blocked','booked'].includes(kind))throw Object.assign(new Error('Неверный тип блокировки'),{status:400});
  if(x.operation==='close'&&typeof x.note!=='undefined'&&typeof x.note!=='string')throw Object.assign(new Error('Неверный формат заметки'),{status:400});
  const note=x.operation==='close'?String(x.note||'').trim():'';
  if(note.length>200)throw Object.assign(new Error('Заметка не должна превышать 200 символов'),{status:400});
  return {operation:x.operation,from:days[0],departure:nextCalendarDate(days[days.length-1]),kind,note,nights:days.length};
}

function conflict(message){
  return Object.assign(new Error(message),{status:409});
}
function hasRows(result){return (result.rowCount??result.rows?.length??0)>0;}

/**
 * Called only after the server authenticates the owner and acquires its existing
 * booking-dates advisory transaction lock. End dates in SQL are exclusive.
 * Never changes bookings or reward rows; it edits manual calendar_blocks only.
 */
export async function applyAvailabilityChange(client,input,newId){
  const x=parseAvailabilityChange(input);
  if(typeof newId!=='function')throw Error('Missing id generator');
  const dates=[x.from,x.departure];
  const booking=await client.query(
    "SELECT id FROM bookings WHERE archived=false AND status IN ('confirmed','completed') AND dates_released=false AND arrival<$2 AND departure>$1 LIMIT 1",dates);
  if(hasRows(booking))throw conflict('Эти даты заняты подтверждённой бронью. Откройте её через раздел заявок.');
  const reward=await client.query(
    "SELECT id FROM rewards WHERE kind='stay' AND status IN ('approved','issued') AND date >= $1 AND date < $2 LIMIT 1",dates);
  if(hasRows(reward))throw conflict('В выбранном периоде есть подтверждённая бонусная ночь. Она не будет изменена.');
  if(x.operation==='close'){
    const overlap=await client.query(
      'SELECT id FROM calendar_blocks WHERE arrival<$2 AND departure>$1 LIMIT 1',dates);
    if(hasRows(overlap))throw conflict('Некоторые выбранные даты уже закрыты вручную. Выберите только свободные ночи.');
    await client.query(
      'INSERT INTO calendar_blocks(id,arrival,departure,kind,note) VALUES($1,$2,$3,$4,$5)',
      [newId(),x.from,x.departure,x.kind,x.note]);
    return {operation:x.operation,affectedNights:x.nights};
  }

  const old=await client.query(
    'SELECT id,arrival::text,departure::text,kind,note,created_at FROM calendar_blocks WHERE arrival<$2 AND departure>$1 ORDER BY arrival,id FOR UPDATE',dates);
  if(!hasRows(old))throw conflict('На выбранных датах нет ручных блокировок.');
  for(const block of old.rows){
    await client.query('DELETE FROM calendar_blocks WHERE id=$1',[block.id]);
    // Preserve portions before or after the selected period, including notes and kind.
    if(block.arrival<x.from){
      await client.query(
        'INSERT INTO calendar_blocks(id,arrival,departure,kind,note,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [newId(),block.arrival,x.from,block.kind,block.note,block.created_at]);
    }
    if(block.departure>x.departure){
      await client.query(
        'INSERT INTO calendar_blocks(id,arrival,departure,kind,note,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [newId(),x.departure,block.departure,block.kind,block.note,block.created_at]);
    }
  }
  return {operation:x.operation,affectedNights:x.nights,updatedBlocks:old.rows.length};
}
