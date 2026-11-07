import {buildIncomeReport,incomeChartSeries} from './admin-income-core.js';

const STYLE_ID='admin-income-dashboard-style';
const PERIOD_LABELS={week:'Неделя',month:'Месяц',quarter:'3 месяца',half:'Полгода',year:'Год'};
const money=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const monthFormatter=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'});
const dayFormatter=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
let currentDashboard=null;

function localToday(){
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date());
 const get=type=>parts.find(part=>part.type===type)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
function monthName(value){
 const valueDate=new Date(value+'-01T00:00:00Z');
 const name=monthFormatter.format(valueDate);
 return name[0].toUpperCase()+name.slice(1);
}
function dateName(value){return dayFormatter.format(new Date(value+'T00:00:00Z'));}
function fmt(value){return money.format(value)+' ₽';}
function compact(value){
 const abs=Math.abs(value),sign=value<0?'−':'';
 if(abs>=1000000)return sign+money.format(Math.round(abs/100000)/10)+' млн';
 if(abs>=1000)return sign+money.format(Math.round(abs/100)/10)+' тыс.';
 return sign+money.format(abs);
}
function element(tag,className='',content=''){
 const item=document.createElement(tag);
 if(className)item.className=className;
 if(content)item.textContent=content;
 return item;
}
function installStyles(){
 if(document.getElementById(STYLE_ID))return;
 const style=element('style');style.id=STYLE_ID;
 style.textContent=[
 '.owner-income-analytics{margin:30px 0 42px;padding:26px;border-radius:24px;background:#2c2f34;border:1px solid #656970;color:#f5f5f3;box-shadow:0 10px 36px #00000012;min-width:0}',
 '.owner-income-analytics *{box-sizing:border-box}',
 '.owner-income-analytics h2,.owner-income-analytics h3,.owner-income-analytics p{margin:0}',
 '.income-heading{display:flex;align-items:start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
 '.income-eyebrow{font-size:11px;font-weight:750;letter-spacing:.13em;color:#d8ff44;margin-bottom:8px!important}',
 '.income-heading h2{font-size:clamp(22px,3vw,29px);line-height:1.2;font-weight:750}',
 '.income-heading p:not(.income-eyebrow){margin-top:9px!important;color:#c2c6c7;font-size:13px;line-height:1.55;max-width:770px}',
 '.income-refresh{background:transparent;color:#f5f5f3;border:1px solid #8b9194;border-radius:12px;padding:11px 15px;min-height:44px;cursor:pointer;font:inherit;font-size:13px}',
 '.income-refresh:disabled{opacity:.5;cursor:wait}',
 '.income-filters{display:flex;justify-content:space-between;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:25px}',
 '.income-periods{display:flex;flex-wrap:wrap;gap:7px}',
 '.income-periods button{min-height:40px;background:#41464c;color:#f2f2f2;border:1px solid #5c6269;border-radius:11px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}',
 '.income-periods button[aria-pressed="true"]{background:#d8ff44;color:#202421;border-color:#d8ff44;font-weight:750}',
 '.income-periods button:focus-visible,.income-refresh:focus-visible{outline:2px solid #d8ff44;outline-offset:2px}',
 '.income-month-picker{display:grid;gap:6px;color:#d0d3d4;font-size:12px}',
 '.income-month-picker input{width:166px;min-height:40px;border-radius:10px;border:1px solid #9fa4a7;background:#f7f7f7;color:#222;padding:7px 11px;font:inherit;font-size:15px}',
 '.income-options{display:flex;flex-wrap:wrap;gap:12px 22px;margin-top:18px;color:#d7d9d9;font-size:13px}',
 '.income-options label{display:inline-flex;align-items:center;gap:8px;cursor:pointer}',
 '.income-options input{accent-color:#d8ff44;width:17px;height:17px}',
 '.income-status{margin-top:17px!important;color:#afb7b9;font-size:12px;line-height:1.5}',
 '.income-status[data-error="true"]{color:#ffc7ba}',
 '.income-kpis{display:grid;grid-template-columns:minmax(200px,1.55fr) repeat(3,minmax(120px,1fr));gap:11px;margin-top:24px}',
 '.income-kpi{border:1px solid #5f6267;background:#383c42;border-radius:16px;padding:17px 16px;min-width:0;display:flex;flex-direction:column;gap:10px}',
 '.income-kpi small{font-size:12px;color:#cdd1d2}',
 '.income-kpi strong{font-size:clamp(18px,2vw,24px);font-weight:730;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap}',
 '.income-kpi.primary{background:#d8ff44;border-color:#d8ff44;color:#1d2821}',
 '.income-kpi.primary small{color:#36402d}',
 '.income-kpi.primary strong{font-size:clamp(24px,3.3vw,35px);letter-spacing:-.03em}',
 '.income-content{display:grid;grid-template-columns:minmax(0,1fr);gap:17px;margin-top:20px}',
 '.income-chart-panel,.income-table-panel{background:#34383e;border:1px solid #60666d;border-radius:17px;padding:19px 18px;min-width:0}',
 '.income-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}',
 '.income-card-head h3{font-size:17px;font-weight:720}',
 '.income-card-head span{color:#bac0c2;font-size:12px}',
 '.income-chart-scroll{overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;padding-top:19px}',
 '.income-chart-bars{display:grid;gap:10px;align-items:end;min-height:213px;min-width:100%}',
 '.income-chart-bar{display:flex;flex-direction:column;align-items:center;justify-content:end;gap:8px;min-width:0}',
 '.income-chart-value{min-height:17px;color:#f1f4f1;text-align:center;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}',
 '.income-chart-track{width:100%;height:155px;display:flex;align-items:end;justify-content:center;border-bottom:1px solid #777c82;background:linear-gradient(to bottom,transparent 24.5%,#ffffff0b 25%,transparent 25.5%,transparent 49.5%,#ffffff0b 50%,transparent 50.5%,transparent 74.5%,#ffffff0b 75%,transparent 75.5%)}',
 '.income-chart-fill{display:block;width:72%;max-width:47px;min-width:8px;border-radius:7px 7px 0 0;background:#d8ff44;transition:height .2s}',
 '.income-chart-bar.is-negative .income-chart-fill{background:#f2ad99}',
 '.income-chart-bar.is-empty .income-chart-fill{display:none}',
 '.income-chart-label{color:#c2c7c8;text-align:center;font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}',
 '.income-chart-bars.is-daily .income-chart-value{font-size:10px}',
 '.income-chart-bars.is-long-daily .income-chart-value{visibility:hidden}',
 '.income-table-scroll{width:100%;overflow:auto;margin-top:13px}',
 '.income-month-table{border-collapse:collapse;width:100%;min-width:450px;font-size:13px}',
 '.income-month-table th,.income-month-table td{text-align:right;padding:12px 8px;border-bottom:1px solid #ffffff1e;white-space:nowrap;font-variant-numeric:tabular-nums}',
 '.income-month-table th{font-size:11px;color:#c5c9ca;font-weight:550}',
 '.income-month-table th:first-child,.income-month-table td:first-child{text-align:left;padding-left:0}',
 '.income-month-table td:last-child{color:#e6ff9a;font-weight:700}',
 '.income-month-table tr:last-child td{border-bottom:0}',
 '.income-breakdown{margin-top:15px;display:flex;flex-wrap:wrap;gap:7px 15px;color:#d4d7d7;font-size:12px}',
 '.income-meta{font-size:12px;line-height:1.6;color:#bfc5c6;margin-top:14px!important}',
 '.income-warning{margin-top:18px!important;border-top:1px solid #ffffff2e;padding-top:14px;color:#c6cbca;font-size:12px;line-height:1.65}',
 '@media(max-width:850px){.income-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.income-kpi.primary{grid-column:span 2}}',
 '@media(max-width:540px){.owner-income-analytics{padding:15px;border-radius:18px}.income-kpis{gap:8px}.income-kpi{padding:13px 12px}.income-kpi strong{font-size:19px}.income-kpi.primary strong{font-size:27px}.income-chart-panel,.income-table-panel{padding:15px 12px}.income-chart-bars{gap:7px}.income-periods button{padding:8px 10px}.income-month-picker{width:100%}.income-month-picker input{width:100%}}'
 ].join('\n');
 document.head.append(style);
}
function renderBars(container,report){
 container.replaceChildren();
 const series=incomeChartSeries(report);
 const allDays=report.mode==='week'||report.mode==='month';
 const bars=element('div','income-chart-bars');
 if(allDays)bars.classList.add('is-daily');
 if(series.length>18)bars.classList.add('is-long-daily');
 const itemMin=series.length>18?30:series.length>12?47:63;
 bars.style.gridTemplateColumns='repeat('+series.length+',minmax('+itemMin+'px,1fr))';
 bars.style.minWidth=series.length*itemMin+Math.max(0,series.length-1)*10+'px';
 const peak=Math.max(1,...series.map(item=>Math.abs(item.share)));
 for(const point of series){
  const bar=element('div','income-chart-bar');
  if(point.share<0)bar.classList.add('is-negative');
  if(point.nights===0||point.share===0)bar.classList.add('is-empty');
  bar.title=(allDays?dateName(point.key):monthName(point.key))+' — '+fmt(point.share)+' · ночей: '+point.nights;
  const labelValue=element('span','income-chart-value',point.nights?compact(point.share):'');
  const track=element('div','income-chart-track');
  const fill=element('span','income-chart-fill');
  fill.style.height=(point.nights?Math.max(4,Math.round(Math.abs(point.share)/peak*100)):0)+'%';
  track.append(fill);
  const label=element('span','income-chart-label',point.label);
  bar.append(labelValue,track,label);
  bars.append(bar);
 }
 container.append(bars);
}
function renderMonthlyTable(container,report){
 container.replaceChildren();
 const table=element('table','income-month-table');
 const head=element('thead'),tr=element('tr');
 for(const col of ['Месяц','Ночей','Сумма по тарифам','−3 000 ₽/ночь','Твоя доля']){
  const th=element('th','',col);tr.append(th);
 }
 head.append(tr);table.append(head);
 const body=element('tbody');
 for(const item of report.months){
  const row=element('tr');
  for(const value of [monthName(item.month),String(item.nights),fmt(item.gross),'−'+fmt(item.expenses),fmt(item.share)]){
   row.append(element('td','',value));
  }
  body.append(row);
 }
 table.append(body);
 container.append(table);
}
function setupDashboard(section){
 installStyles();
 const state={
  period:'quarter',month:localToday().slice(0,7),
  includeManualBlocked:true,includeFuture:false,
  availability:null,pricing:null,lastLoad:0,loading:false
 };
 section.id='admin-income-dashboard';
 section.className='owner-income-analytics';
 section.setAttribute('aria-label','Аналитика доходов по занятым ночам');
 section.innerHTML=[
  '<div class="income-heading"><div><p class="income-eyebrow">АНАЛИТИКА · КОТТЕДЖ НА ХВОЙНОЙ</p>',
  '<h2>Доход по занятым ночам</h2>',
  '<p>Автоматический расчёт по календарям Авито и сайта. За каждую занятую ночь: (цена − 3 000 ₽) ÷ 2.</p></div>',
  '<button class="income-refresh" type="button">Обновить данные</button></div>',
  '<div class="income-filters"><div class="income-periods" role="group" aria-label="Период"></div>',
  '<label class="income-month-picker">По месяц включительно <input type="month" aria-label="Последний месяц отчёта"></label></div>',
  '<div class="income-options">',
  '<label><input class="income-include-manual" type="checkbox" checked> Учитывать вручную закрытые ночи</label>',
  '<label><input class="income-include-future" type="checkbox"> Учитывать будущие даты</label></div>',
  '<p class="income-status" role="status" aria-live="polite">Загружаем календарь и цены…</p>',
  '<div class="income-kpis">',
  '<div class="income-kpi primary"><small>Твоя расчётная доля</small><strong data-income="share">—</strong></div>',
  '<div class="income-kpi"><small>Закрытых ночей в расчёте</small><strong data-income="nights">—</strong></div>',
  '<div class="income-kpi"><small>Стоимость этих ночей</small><strong data-income="gross">—</strong></div>',
  '<div class="income-kpi"><small>Расходы по 3 000 ₽</small><strong data-income="costs">—</strong></div></div>',
  '<div class="income-content"><div class="income-chart-panel">',
  '<div class="income-card-head"><h3>Динамика по периодам</h3><span class="income-chart-subtitle">Твоя доля, ₽</span></div>',
  '<div class="income-chart-scroll" aria-label="График расчётного дохода"></div></div>',
  '<div class="income-table-panel"><div class="income-card-head"><h3>Сравнение месяцев</h3>',
  '<span class="income-period-label"></span></div>',
  '<div class="income-table-scroll"></div><div class="income-breakdown"></div>',
  '<p class="income-meta"></p></div></div>',
  '<p class="income-warning">Это <strong>оценка, а не подтверждённая выручка</strong>: используются ',
  'действующие тарифы выбранных дат, без доплат за гостей, скидок и сведений об оплате. ',
  'Авито передаёт занятость, но не отличает оплаченные брони от просто закрытых дат. ',
  'Одинаковые даты из разных календарей учитываются один раз; бонусные бесплатные ночи исключены. ',
  'Исторические цены могут отличаться от нынешних.</p>'
 ].join('');
 const controls=section.querySelector('.income-periods');
 const anchor=section.querySelector('.income-month-picker input');
 anchor.value=state.month;
 for(const [key,label] of Object.entries(PERIOD_LABELS)){
  const button=element('button','',label);
  button.type='button';button.dataset.incomePeriod=key;
  button.setAttribute('aria-pressed',String(state.period===key));
  button.addEventListener('click',()=>{
   state.period=key;
   for(const b of controls.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.incomePeriod===key));
   render();
  });
  controls.append(button);
 }
 const manual=section.querySelector('.income-include-manual');
 const future=section.querySelector('.income-include-future');
 const status=section.querySelector('.income-status');
 const refreshButton=section.querySelector('.income-refresh');
 anchor.addEventListener('change',()=>{if(/^\d{4}-\d{2}$/.test(anchor.value)){state.month=anchor.value;render();}});
 manual.addEventListener('change',()=>{state.includeManualBlocked=manual.checked;render();});
 future.addEventListener('change',()=>{state.includeFuture=future.checked;render();});
 refreshButton.addEventListener('click',()=>{void load();});
 function render(){
  if(!state.availability||!state.pricing)return;
  let report;
  try{
   report=buildIncomeReport({
    availability:state.availability,pricing:state.pricing,
    mode:state.period,month:state.month,today:localToday(),
    includeManualBlocked:state.includeManualBlocked,
    includeFuture:state.includeFuture
   });
  }catch(error){
   status.dataset.error='true';
   status.textContent=error.message||'Ошибка расчёта';
   return;
  }
  section.querySelector('[data-income="share"]').textContent=fmt(report.share);
  section.querySelector('[data-income="nights"]').textContent=String(report.nights);
  section.querySelector('[data-income="gross"]').textContent=fmt(report.gross);
  section.querySelector('[data-income="costs"]').textContent='−'+fmt(report.expenses);
  section.querySelector('.income-period-label').textContent=
   dateName(report.window.from)+' — '+dateName(new Date(Date.parse(report.window.toExclusive+'T00:00:00Z')-86400000).toISOString().slice(0,10));
  renderBars(section.querySelector('.income-chart-scroll'),report);
  renderMonthlyTable(section.querySelector('.income-table-scroll'),report);
  const breakdown=section.querySelector('.income-breakdown');
  breakdown.replaceChildren();
  const captions=[
   ['Сайт',report.sources.site],
   ['Авито',report.sources.avito],
   ['Бронь вручную',report.sources.manualBooked],
   ['Закрыто вручную',report.sources.manualBlocked]
  ];
  for(const [name,count] of captions){
   const badge=element('span','',name+': '+count+' ноч.');
   breakdown.append(badge);
  }
  const notes=[];
  if(report.excludedFuture)notes.push('Будущих закрытых ночей вне расчёта: '+report.excludedFuture);
  if(report.excludedManual)notes.push('Не учтено ручных закрытий: '+report.excludedManual);
  if(report.excludedRewards)notes.push('Бесплатных бонусных ночей: '+report.excludedRewards);
  if(report.overlapNights)notes.push('Совпадения календарей учтены один раз: '+report.overlapNights);
  const ranked=report.months.filter(item=>item.nights>0).sort((a,b)=>b.share-a.share);
  if(ranked.length>1){
   notes.push('Лучший месяц: '+monthName(ranked[0].month)+' ('+fmt(ranked[0].share)+')');
   const weakest=ranked[ranked.length-1];
   notes.push('Самый слабый из занятых: '+monthName(weakest.month)+' ('+fmt(weakest.share)+')');
  }
  section.querySelector('.income-meta').textContent=notes.join(' · ')||'За выбранный период занятые ночи не найдены.';
 }
 async function load(){
  if(state.loading)return;
  state.loading=true;refreshButton.disabled=true;
  status.dataset.error='false';
  status.textContent='Обновляем календарь и тарифы…';
  try{
   const [a,p]=await Promise.all([
    fetch('/api/admin/calendar-availability',{credentials:'same-origin',cache:'no-store'}),
    fetch('/api/pricing',{credentials:'same-origin',cache:'no-store'})
   ]);
   if(!a.ok||!p.ok)throw new Error(a.status===401?'Нужно заново войти в кабинет владельца.':'Не удалось получить данные календаря или цен.');
   const availability=await a.json(),pricing=await p.json();
   if(!Array.isArray(availability.blocks)||!Array.isArray(availability.bookings)||!Array.isArray(availability.avito)||!Array.isArray(availability.rewards))throw new Error('Календарь вернул неполные данные.');
   state.availability=availability;state.pricing=pricing;state.lastLoad=Date.now();
   status.dataset.error='false';
   const timestamp=availability.avitoSync?.last_success_at;
   const avitoUpdated=timestamp?new Date(timestamp).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
   status.textContent='Данные получены. '+(avitoUpdated?'Авито обновлено '+avitoUpdated+'.':'Авито ещё не подтвердил успешную синхронизацию.')+
    (availability.avitoSync?.last_error?' Последняя проверка Авито завершилась ошибкой.':'');
   render();
  }catch(error){
   status.dataset.error='true';
   status.textContent=error.message||'Ошибка обновления аналитики.';
   if(error.message?.includes('заново войти')){state.availability=null;state.pricing=null;}
  }finally{state.loading=false;refreshButton.disabled=false;}
 }
 currentDashboard={section,refresh:load,lastLoaded:()=>state.lastLoad};
 void load();
}
function mount(){
 const calendar=document.querySelector('.owner-calendar');
 if(!calendar)return;
 const destination=calendar.closest('[data-slot="tabs-content"]')||calendar.parentElement;
 if(!destination||destination.querySelector('#admin-income-dashboard'))return;
 const section=element('section');
 destination.append(section);
 setupDashboard(section);
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
 else mount();
 new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('focus',()=>{
  if(currentDashboard?.section?.isConnected&&Date.now()-currentDashboard.lastLoaded()>5*60*1000)
   void currentDashboard.refresh();
 });
 window.addEventListener('prices-updated',()=>{
  if(currentDashboard?.section?.isConnected)void currentDashboard.refresh();
 });
}
