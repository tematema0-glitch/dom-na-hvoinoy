import { dateRangeInclusive } from './date-price-range.js';

const STYLE_ID='admin-availability-calendar-css';
let calendarState=null;
let currentView=null;
let stateRequest=null;
let lastFetch=0;
let lastSuccess=0;

function create(tag,cls='',content=''){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(content)node.textContent=content;
  return node;
}
function labeledInput(label,type){
  const wrapper=create('label','availability-field',label);
  const input=create('input');
  input.type=type;
  wrapper.append(input);
  return {wrapper,input};
}
function dateRange(from,to){
  try{return dateRangeInclusive(from,to,180);}catch{return null;}
}
// Clicking a date in the owner availability calendar selects that night only.
// Departure is exclusive in storage, so an occupied next day is permitted.
export function singleCalendarNightSelection(isoDate){
  const days=dateRange(isoDate,isoDate);
  return days?{from:days[0],to:days[0]}:null;
}
function overlaps(start,end,arrival,departure){
  return typeof arrival==='string'&&typeof departure==='string'&&arrival<end&&departure>start;
}
export function summarizeAvailability(data,from,to){
  const days=dateRange(from,to);
  if(!days)return null;
  const start=days[0];
  const last=days[days.length-1];
  const lastStamp=Date.parse(last+'T00:00:00Z');
  const end=new Date(lastStamp+86400000).toISOString().slice(0,10);
  const manual=Array.isArray(data?.blocks)?data.blocks:[];
  const bookings=Array.isArray(data?.bookings)?data.bookings:[];
  const rewards=Array.isArray(data?.rewards)?data.rewards:[];
  const blocks=manual.filter(item=>overlaps(start,end,item.arrival,item.departure));
  const booked=bookings.filter(item=>overlaps(start,end,item.arrival,item.departure));
  const rewardDates=rewards.filter(item=>item.date>=start&&item.date<end);
  const manualNights=days.filter(day=>blocks.some(block=>day>=block.arrival&&day<block.departure)).length;
  const locked=booked.length>0||rewardDates.length>0;
  return {days,manualNights,manualBlocks:blocks,bookingCount:booked.length,rewardCount:rewardDates.length,
    canClose:!locked&&manualNights===0,canOpen:!locked&&manualNights>0,hasProtectedDates:locked};
}
function mountStyle(){
  if(document.getElementById(STYLE_ID))return;
  const style=create('style');style.id=STYLE_ID;
  style.textContent=[
    '.owner-calendar.availability-inline-active:not(.price-calendar-mode) .calendar-grid > form:not(.price-calendar-editor){display:none!important}',
    '.owner-calendar.availability-inline-active > .manual-blocks{display:none!important}',
    '.owner-calendar.price-calendar-mode .availability-calendar-editor{display:none!important}',
    '.availability-calendar-editor{min-width:0;border:1px solid #53565d;background:#33353a;border-radius:20px;padding:18px;display:grid;gap:14px}',
    '.availability-calendar-editor h3,.availability-calendar-editor p{margin:0}',
    '.availability-calendar-editor h3{font-size:20px;line-height:1.35}',
    '.availability-calendar-editor p{font-size:14px;line-height:1.55}',
    '.availability-calendar-editor .availability-hint{color:#d6d6d6}',
    '.availability-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
    '.availability-field{display:grid;gap:8px;min-width:0;font-size:14px}',
    '.availability-field input,.availability-field select{min-width:0;width:100%;font-size:16px;min-height:46px;padding:11px 12px;border-radius:12px;border:1px solid #979797;background:#fff;color:#171717}',
    '.availability-actions{display:flex;gap:10px;flex-wrap:wrap}',
    '.availability-actions button{flex:1 1 140px;min-height:48px;padding:11px 13px;border-radius:13px;cursor:pointer;font-weight:650;line-height:1.25}',
    '.availability-close{background:#dcff38;color:#131313;border:1px solid #dcff38}',
    '.availability-open{background:transparent;color:#fff;border:1px solid #bababa}',
    '.availability-actions button:disabled{opacity:.48;cursor:not-allowed}',
    '.availability-message{border-radius:12px;padding:10px 12px;background:#25272b;color:#f2f2f2;white-space:pre-line}',
    '.availability-message[data-kind="error"]{color:#ffd0c9;border:1px solid #d5857a}',
    '.availability-message[data-kind="success"]{color:#ddffad;border:1px solid #96c657}',
    '.availability-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;line-height:1.4;color:#d6d6d6}',
    '.availability-legend span{display:flex;gap:6px;align-items:center}',
    '.availability-legend i{display:inline-block;height:12px;width:12px;border-radius:5px;border:2px solid #fff}',
    '.availability-legend .manual{border-color:#c48528}',
    '.availability-legend .real{border-color:#b94c49;background:#f5c7c5}',
    '.owner-calendar .admin-calendar td[data-manual-calendar-block="1"] > button{outline:2px solid #d59c2f!important;outline-offset:-2px}',
    '.owner-calendar .admin-calendar td[data-protected-calendar-night="1"] > button{box-shadow:inset 0 0 0 2px #d66a6a!important}',
    '@media(max-width:700px){.availability-fields{grid-template-columns:1fr}.availability-calendar-editor{padding:14px}.availability-actions button{flex:1 1 100%}}'
  ].join('\n');
  document.head.append(style);
}
function paintStatusMarkers(){
  if(!calendarState)return;
  const cells=document.querySelectorAll('.owner-calendar.availability-inline-active .admin-calendar td[data-day]');
  for(const cell of cells){
    const date=cell.getAttribute('data-day');
    if(!date)continue;
    const manual=calendarState.blocks.some(block=>date>=block.arrival&&date<block.departure);
    const protectedDate=calendarState.bookings.some(booking=>date>=booking.arrival&&date<booking.departure)||
       calendarState.rewards.some(reward=>reward.date===date);
    const man=manual?'1':'0',pro=protectedDate?'1':'0';
    if(cell.getAttribute('data-manual-calendar-block')!==man)cell.setAttribute('data-manual-calendar-block',man);
    if(cell.getAttribute('data-protected-calendar-night')!==pro)cell.setAttribute('data-protected-calendar-night',pro);
  }
}
async function refreshCalendarState(force=false){
  if(stateRequest)return stateRequest;
  if(!force&&calendarState){currentView?.refresh();paintStatusMarkers();return;}
  if(!force&&Date.now()-lastFetch<12000)return;
  lastFetch=Date.now();
  stateRequest=fetch('/api/admin/calendar-availability',{credentials:'same-origin',cache:'no-store'})
    .then(async response=>{
      const result=await response.json();
      if(!response.ok)throw Error(response.status===401?'Войдите в админку заново.':(result.error||'Не удалось загрузить занятость.'));
      if(!Array.isArray(result.blocks)||!Array.isArray(result.bookings)||!Array.isArray(result.rewards))throw Error('Некорректные данные календаря');
      calendarState=result;lastSuccess=Date.now();
      currentView?.refresh();paintStatusMarkers();
    })
    .catch(error=>{calendarState=null;currentView?.showError(error.message||'Ошибка загрузки календаря');})
    .finally(()=>{stateRequest=null;});
  return stateRequest;
}
function mount(section){
  const grid=[...section.children].find(element=>element.classList.contains('calendar-grid'));
  const calendar=grid?.querySelector('.admin-calendar');
  const oldForm=[...(grid?.children||[])].find(element=>element.tagName==='FORM');
  if(!calendar||!oldForm||oldForm.querySelectorAll('input[type="date"]').length<2)return;
  if(grid.querySelector('.availability-calendar-editor'))return;
  mountStyle();
  const panel=create('div','availability-calendar-editor');
  panel.append(create('h3','','Открыть или закрыть даты'));
  panel.append(create('p','availability-hint','Нажмите на дату, чтобы выбрать одну ночь. Для диапазона укажите даты в полях. День выезда не блокируется.'));
  const fromField=labeledInput('С даты','date'),toField=labeledInput('По дату включительно','date');
  const rangeBox=create('div','availability-fields');rangeBox.append(fromField.wrapper,toField.wrapper);
  panel.append(rangeBox);
  const kind=labeledInput('Как отметить','select');
  for(const [value,label] of [['blocked','Закрыто для заезда'],['booked','Бронь вручную (Авито, телефон)']]){
    const option=create('option','',label);option.value=value;kind.input.append(option);
  }
  panel.append(kind.wrapper);
  const note=labeledInput('Заметка (необязательно)','text');
  note.input.maxLength=200;note.input.placeholder='Например, выходной или бронь по телефону';
  panel.append(note.wrapper);
  const summary=create('p','','Выберите даты на календаре.');
  summary.setAttribute('aria-live','polite');
  const message=create('p','availability-message','Загружаем занятость…');
  message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const actions=create('div','availability-actions');
  const close=create('button','availability-close','Закрыть даты'),open=create('button','availability-open','Открыть даты');
  close.type=open.type='button';
  close.disabled=open.disabled=true;actions.append(close,open);
  const legend=create('div','availability-legend');
  const first=create('span');first.append(create('i','manual'),document.createTextNode('Ручная отметка'));
  const second=create('span');second.append(create('i','real'),document.createTextNode('Подтверждённая бронь'));
  legend.append(first,second);
  panel.append(summary,actions,message,legend);
  grid.append(panel);
  section.classList.add('availability-inline-active');
  let busy=false,loadingMessage='';
  function selectedRange(){
    return summarizeAvailability(calendarState,fromField.input.value,toField.input.value);
  }
  function setMessage(value,kind='info'){
    if(message.textContent!==value)message.textContent=value;
    message.setAttribute('data-kind',kind);
  }
  function refresh(){
    const from=fromField.input.value,to=toField.input.value;
    const days=dateRange(from,to);
    if(!days){
      summary.textContent='Выберите одну ночь или диапазон до 180 ночей.';
      close.disabled=open.disabled=true;
      return;
    }
    if(!calendarState){
      summary.textContent='Выбрано ночей: '+days.length+'. Получаем актуальную занятость.';
      close.disabled=open.disabled=true;
      return;
    }
    const overview=selectedRange();
    const amount=days.length;
    if(overview.hasProtectedDates){
      summary.textContent='Выбрано ночей: '+amount+'. Есть подтверждённые брони или бонусные ночи — их нельзя открыть или закрыть здесь.';
    }else if(overview.manualNights){
      summary.textContent='Выбрано ночей: '+amount+'. Ручных закрытых: '+overview.manualNights+'. Их можно открыть, остальные даты останутся прежними.';
    }else{
      summary.textContent='Выбрано ночей: '+amount+'. Все выбранные ночи свободны.';
    }
    close.disabled=busy||!overview.canClose;
    open.disabled=busy||!overview.canOpen;
  }
  function showError(value){setMessage(value,'error');refresh();}
  function chooseCalendarNight(isoDate){
    const selected=singleCalendarNightSelection(isoDate);
    if(!selected)return;
    fromField.input.value=selected.from;
    toField.input.value=selected.to;
    setMessage('Выбрана одна ночь. Для диапазона укажите даты в полях выше.','info');
    refresh();
  }
  // Do not copy the legacy React range selection: it can include a blocked
  // checkout date. For availability, one calendar click always means one night.
  // The native date inputs remain available for multi-night ranges.
  grid.addEventListener('click',e=>{
    if(section.classList.contains('price-calendar-mode')||!(e.target instanceof Element))return;
    const date=e.target.closest('.admin-calendar button')?.closest('td[data-day]')?.getAttribute('data-day');
    if(date)chooseCalendarNight(date);
  });
  for(const input of [fromField.input,toField.input])input.addEventListener('input',()=>{setMessage('','info');refresh();});
  async function send(operation){
    if(busy||!calendarState)return;
    const overview=selectedRange();
    if(!overview||!(operation==='open'?overview.canOpen:overview.canClose))return;
    const count=overview.days.length,from=overview.days[0],to=overview.days[count-1];
    const warning=operation==='open'?
      'Открыть '+overview.manualNights+' вручную закрытых ночей из выбранного периода?\nЭто снимет также ручные отметки «Забронировано», но не затронет подтверждённые заявки.':
      'Закрыть '+count+' ночей с '+from+' по '+to+'?\nНовые гости не смогут забронировать эти даты.';
    if((operation==='open'||count>7)&&!window.confirm(warning))return;
    busy=true;refresh();setMessage('Сохраняем изменения…','info');
    try{
      const response=await fetch('/api/club',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'changeAvailabilityRange',operation,from,to,
          ...(operation==='close'?{kind:kind.input.value,note:note.input.value}:{})
        })
      });
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(response.status===401?'Войдите в админку заново.':(result.error||'Не удалось изменить даты.'));
      setMessage(operation==='open'?'Даты открыты. Обновляем календарь…':'Даты закрыты. Обновляем календарь…','success');
      window.setTimeout(()=>window.location.reload(),400);
    }catch(error){
      busy=false;showError(error.message||'Сохранить не удалось.');
      await refreshCalendarState(true);
    }
  }
  close.addEventListener('click',()=>{void send('close');});
  open.addEventListener('click',()=>{void send('open');});
  currentView={section,refresh,showError};
  refresh();
  void refreshCalendarState();
}
function mountAll(){
  document.querySelectorAll('.owner-calendar').forEach(mount);
  if(currentView?.section?.isConnected)paintStatusMarkers();
}
if(typeof window!=='undefined'){
  window.addEventListener('focus',()=>{
    if(currentView?.section?.isConnected&&Date.now()-lastSuccess>20000)void refreshCalendarState(true);
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&currentView?.section?.isConnected&&Date.now()-lastSuccess>20000)void refreshCalendarState(true);
  });
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountAll,{once:true});
  else mountAll();
  new MutationObserver(mountAll).observe(document.documentElement,{childList:true,subtree:true});
}
