// Avito iCal imports occupied NIGHTS only. Never persist raw calendar text
// (which may contain guest names), and keep owner-created blocks separate.
// Export URL was explicitly approved for the public repository by the owner.
export const AVITO_ICAL_URL=process.env.AVITO_ICAL_URL||'https://www.avito.ru/calendars-export/80/92/8095324792.ics';
export const AVITO_POLL_MS=15*60*1000;
const DAY_MS=86_400_000;
const MAX_BYTES=2_000_000;
const MAX_EVENTS=2500;
let activeSync=null;

function invalid(message){throw new Error('Некорректный iCal Авито: '+message);}
function dateFromParts(y,m,d){
 const result=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 const iso=y+'-'+m+'-'+d;
 if(!Number.isFinite(result.valueOf())||result.toISOString().slice(0,10)!==iso)invalid('неверная дата');
 return iso;
}
function localDateOfUtc(date){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=type=>parts.find(part=>part.type===type)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
function parseIcalDate(raw){
 const value=String(raw||'').trim();
 const match=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
 if(!match)invalid('неподдерживаемая дата события');
 const [,year,month,day,hour,minute,second,utc]=match;
 const iso=dateFromParts(year,month,day);
 if(hour!==undefined){
  const h=Number(hour),m=Number(minute),s=Number(second);
  if(h>23||m>59||s>59)invalid('неверное время');
  if(utc){
   const instant=new Date(Date.UTC(Number(year),Number(month)-1,Number(day),h,m,s));
   return localDateOfUtc(instant);
  }
 }
 return iso;
}
function mergeRanges(ranges){
 const sorted=ranges.sort((a,b)=>a.arrival.localeCompare(b.arrival)||a.departure.localeCompare(b.departure));
 const output=[];
 for(const item of sorted){
  const last=output[output.length-1];
  if(last&&item.arrival<=last.departure){
   if(item.departure>last.departure)last.departure=item.departure;
  }else output.push({...item});
 }
 return output;
}
/**
 * RFC5545 calendar DATE values have an EXCLUSIVE DTEND.
 * [11 December, 12 December) blocks only the night of the 11th.
 * The Avito feed may also contain timed events; UTC times are converted to
 * Ekaterinburg before extracting calendar dates.
 */
export function parseAvitoIcal(input){
 if(typeof input!=='string'||Buffer.byteLength(input,'utf8')>MAX_BYTES)invalid('файл слишком большой');
 const unfolded=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'');
 const lines=unfolded.split('\n').map(line=>line.trim()).filter(Boolean);
 if(lines[0]!=='BEGIN:VCALENDAR'||lines[lines.length-1]!=='END:VCALENDAR')invalid('нет начала или конца VCALENDAR');
 if(lines.some(line=>line.toUpperCase()==='METHOD:CANCEL'))invalid('получено уведомление об отмене вместо календаря');
 const ranges=[];
 let event=null;
 let events=0;
 for(const line of lines){
  const upper=line.toUpperCase();
  if(upper==='BEGIN:VEVENT'){
   if(event)invalid('вложенные события');
   event={};
   if(++events>MAX_EVENTS)invalid('слишком много событий');
   continue;
  }
  if(upper==='END:VEVENT'){
   if(!event)invalid('лишний END:VEVENT');
   if(event.status!=='CANCELLED'&&event.transp!=='TRANSPARENT'){
    if(!event.start||!event.end||event.rrule||event.recurrence)invalid('событие без поддерживаемого периода');
    const arrival=parseIcalDate(event.start);
    const departure=parseIcalDate(event.end);
    const nights=(Date.parse(departure+'T00:00:00Z')-Date.parse(arrival+'T00:00:00Z'))/DAY_MS;
    if(!Number.isInteger(nights)||nights<1||nights>730)invalid('неправильная длительность брони');
    ranges.push({arrival,departure});
   }
   event=null;
   continue;
  }
  if(!event)continue;
  const colon=line.indexOf(':');
  if(colon<0)continue;
  const property=line.slice(0,colon).split(';')[0].toUpperCase();
  const value=line.slice(colon+1);
  if(property==='DTSTART')event.start=value;
  else if(property==='DTEND')event.end=value;
  else if(property==='STATUS')event.status=value.toUpperCase();
  else if(property==='TRANSP')event.transp=value.toUpperCase();
  else if(property==='RRULE')event.rrule=true;
  else if(property==='RECURRENCE-ID')event.recurrence=true;
 }
 if(event)invalid('незакрытый VEVENT');
 return mergeRanges(ranges);
}
async function performSync(pool,fetchImpl){
 try{
  const response=await fetchImpl(AVITO_ICAL_URL,{
   signal:AbortSignal.timeout(12000),
   headers:{Accept:'text/calendar, text/plain;q=0.8'}
  });
  if(!response.ok)throw new Error('Авито не вернул календарь (HTTP '+response.status+')');
  const advertised=Number(response.headers?.get?.('content-length')||0);
  if(advertised>MAX_BYTES)invalid('файл слишком большой');
  const body=await response.text();
  const ranges=parseAvitoIcal(body);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Same lock as booking confirmation and owner's manual calendar edits.
   await client.query("SELECT pg_advisory_xact_lock(hashtext('dom-na-hvoinoy-booking-dates'))");
   const status=await client.query("SELECT imported_ranges,empty_confirmations FROM avito_calendar_sync WHERE source='avito' FOR UPDATE");
   if(!status.rowCount)throw new Error('Не инициализировано состояние синхронизации Авито');
   const previous=status.rows[0];
   // A single unexpectedly empty response must not clear valid reservations.
   if(!ranges.length&&Number(previous.imported_ranges)>0&&!Number(previous.empty_confirmations)){
    await client.query("UPDATE avito_calendar_sync SET empty_confirmations=1,last_attempt_at=now(),last_error='Пустая выгрузка: ожидаем повторную проверку' WHERE source='avito'");
    await client.query('COMMIT');
    return {pendingEmpty:true,importedRanges:Number(previous.imported_ranges)};
   }
   await client.query('DELETE FROM avito_calendar_blocks');
   if(ranges.length){
    await client.query('INSERT INTO avito_calendar_blocks(arrival,departure) SELECT arrival,departure FROM unnest($1::date[],$2::date[]) AS dates(arrival,departure)',[
     ranges.map(range=>range.arrival),ranges.map(range=>range.departure)
    ]);
   }
   await client.query("UPDATE avito_calendar_sync SET last_success_at=now(),last_attempt_at=now(),last_error=NULL,empty_confirmations=0,imported_ranges=$1 WHERE source='avito'",[ranges.length]);
   await client.query('COMMIT');
   return {ok:true,importedRanges:ranges.length};
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   throw error;
  }finally{client.release();}
 }catch(error){
  const message=String(error?.name==='TimeoutError'?'Таймаут подключения к Авито':error?.message||'Ошибка обновления Авито').slice(0,200);
  try{await pool.query("UPDATE avito_calendar_sync SET last_attempt_at=now(),last_error=$1 WHERE source='avito'",[message]);}catch{}
  throw error;
 }
}
export function syncAvitoCalendar(pool,fetchImpl=fetch){
 if(!pool)throw new Error('Database is unavailable');
 if(activeSync)return activeSync;
 const task=performSync(pool,fetchImpl);
 activeSync=task;
 task.finally(()=>{if(activeSync===task)activeSync=null;}).catch(()=>{});
 return task;
}
