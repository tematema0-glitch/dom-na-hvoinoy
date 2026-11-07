// Pure income ESTIMATE from availability + current calendar rates.
// A closed date is not proof that a guest actually paid. Never present as actual receipts.
export const CLEANING_COST_PER_NIGHT=3000;
export const OWNER_SHARE_PARTS=2;
export const INCOME_PERIODS=Object.freeze({
 week:7, month:1, quarter:3, half:6, year:12
});
const DAY_MS=86400000;
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH=/^\d{4}-\d{2}$/;

function dayStamp(value){
 if(typeof value!=='string'||!ISO_DAY.test(value))throw new RangeError('Некорректная дата');
 const stamp=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)throw new RangeError('Некорректная дата');
 return stamp;
}
function isoDay(timestamp){return new Date(timestamp).toISOString().slice(0,10);}
function monthDate(value){
 if(typeof value!=='string'||!ISO_MONTH.test(value))throw new RangeError('Некорректный месяц');
 return dayStamp(value+'-01');
}
function shiftMonth(value,offset){
 const stamp=monthDate(value);
 const d=new Date(stamp);
 d.setUTCMonth(d.getUTCMonth()+offset,1);
 return d.toISOString().slice(0,7);
}
export function incomeWindow(mode,month,today){
 if(!Object.hasOwn(INCOME_PERIODS,mode))throw new RangeError('Некорректный период');
 const todayTime=dayStamp(today);
 monthDate(month);
 if(mode==='week'){
  const nextMonth=shiftMonth(month,1)+'-01';
  const lastDay=month===today.slice(0,7)?today:isoDay(dayStamp(nextMonth)-DAY_MS);
  const last=dayStamp(lastDay);
  return {from:isoDay(last-6*DAY_MS),toExclusive:isoDay(last+DAY_MS)};
 }
 const count=INCOME_PERIODS[mode];
 return {from:shiftMonth(month,1-count)+'-01',toExclusive:shiftMonth(month,1)+'-01'};
}
function priceForNight(pricing,date){
 if(!pricing||typeof pricing!=='object')throw new TypeError('Не удалось получить цены');
 const overrides=pricing.dates||{};
 const weekday=new Date(dayStamp(date)).getUTCDay();
 const base=weekday===5?pricing.friday:weekday===6?pricing.saturday:pricing.weekday;
 const raw=Object.prototype.hasOwnProperty.call(overrides,date)?overrides[date]:base;
 const value=Number(raw);
 if(!Number.isSafeInteger(value)||value<0||value>1000000)throw new RangeError('Некорректная цена ночи '+date);
 return value;
}
function includesNight(entry,date){
 return entry&&typeof entry.arrival==='string'&&typeof entry.departure==='string'&&entry.arrival<=date&&date<entry.departure;
}
function isReward(entry,date){return entry&&entry.date===date;}
function safeArray(value){return Array.isArray(value)?value:[];}
export function buildIncomeReport({availability,pricing,mode='month',month,today,includeManualBlocked=true,includeFuture=false}={}){
 const {from,toExclusive}=incomeWindow(mode,month,today);
 const manual=safeArray(availability?.blocks);
 const avito=safeArray(availability?.avito);
 const bookings=safeArray(availability?.bookings);
 const rewards=safeArray(availability?.rewards);
 const rows=[],monthMap=new Map();
 let gross=0,expenses=0,share=0,nights=0,excludedManual=0,excludedFuture=0,excludedRewards=0,overlapNights=0;
 const sources={site:0,avito:0,manualBooked:0,manualBlocked:0};
 const months=[];
 const lastIncludedMonth=isoDay(dayStamp(toExclusive)-DAY_MS).slice(0,7);
 for(let key=from.slice(0,7);key<=lastIncludedMonth;key=shiftMonth(key,1)){
  const item={month:key,nights:0,gross:0,expenses:0,share:0};
  monthMap.set(key,item);months.push(item);
 }
 for(let ms=dayStamp(from),end=dayStamp(toExclusive);ms<end;ms+=DAY_MS){
  const date=isoDay(ms);
  const isComp=rewards.some(item=>isReward(item,date));
  const isSite=bookings.some(item=>includesNight(item,date));
  const isAvito=avito.some(item=>includesNight(item,date));
  const isManualBooked=manual.some(item=>item.kind==='booked'&&includesNight(item,date));
  const isManualBlocked=manual.some(item=>(item.kind==='blocked'||!item.kind)&&includesNight(item,date));
  const candidates=Number(isSite)+Number(isAvito)+Number(isManualBooked)+Number(isManualBlocked);
  if(candidates>1)overlapNights++;
  if(isComp){excludedRewards++;continue;}
  const source=isSite?'site':isAvito?'avito':isManualBooked?'manualBooked':isManualBlocked?'manualBlocked':null;
  if(!source)continue;
  if(!includeFuture&&date>today){excludedFuture++;continue;}
  if(source==='manualBlocked'&&!includeManualBlocked){excludedManual++;continue;}
  const price=priceForNight(pricing,date);
  const cost=CLEANING_COST_PER_NIGHT;
  const ownerShare=(price-cost)/OWNER_SHARE_PARTS;
  const row={date,month:date.slice(0,7),source,price,cost,share:ownerShare};
  rows.push(row);sources[source]++;
  gross+=price;expenses+=cost;share+=ownerShare;nights++;
  const group=monthMap.get(row.month);
  if(group){group.gross+=price;group.expenses+=cost;group.share+=ownerShare;group.nights++;}
 }
 return {
  window:{from,toExclusive},mode,month,today,
  gross,expenses,share,nights,rows,months,sources,
  excludedManual,excludedFuture,excludedRewards,overlapNights,
  perNightExpense:CLEANING_COST_PER_NIGHT,shareParts:OWNER_SHARE_PARTS,
  isEstimate:true
 };
}
export function incomeChartSeries(report){
 if(report.mode==='week'||report.mode==='month'){
  const byDate=new Map(report.rows.map(row=>[row.date,row]));
  const points=[];
  for(let ms=dayStamp(report.window.from),end=dayStamp(report.window.toExclusive);ms<end;ms+=DAY_MS){
   const date=isoDay(ms),entry=byDate.get(date);
   points.push({key:date,label:report.mode==='week'?date.slice(8)+'.'+date.slice(5,7):String(Number(date.slice(8))),share:entry?.share||0,nights:entry?1:0});
  }
  return points;
 }
 return report.months.map(item=>({key:item.month,label:item.month.slice(5,7)+'.'+item.month.slice(2,4),share:item.share,nights:item.nights}));
}
