import { dateRangeInclusive, checkedNightlyPrice } from './date-price-range.js';

const PRICE_DAY=/^\d{4}-\d{2}-\d{2}$/;
const NIGHT_PRICE_FORMAT=new Intl.NumberFormat('ru-RU');

export function calendarNightPrice(pricing,isoDate){
  if(!pricing||!PRICE_DAY.test(isoDate))return null;
  const date=new Date(isoDate+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==isoDate)return null;
  const overrides=pricing.dates||{};
  const special=Object.prototype.hasOwnProperty.call(overrides,isoDate);
  const day=date.getUTCDay();
  const raw=special?overrides[isoDate]:(day===5?pricing.friday:day===6?pricing.saturday:pricing.weekday);
  const price=Number(raw);
  return Number.isSafeInteger(price)&&price>=0?{price,special}:null;
}
export function formatCalendarNightPrice(price){
  if(!Number.isSafeInteger(price)||price<0)return '';
  if(price>=1000000)return NIGHT_PRICE_FORMAT.format(price/1000000)+' млн';
  return NIGHT_PRICE_FORMAT.format(price).replace(/[\u00a0\u202f]/g,'\u202f');
}

const STYLE_ID='admin-price-calendar-css';
const MODE_KEY='admin-price-calendar-mode';
let saving=false;
let calendarPricing=null;
let pricingRequest=null;
let lastPricingRequest=0;
let lastPricingSuccess=0;
function el(tag,className='',text=''){
  const e=document.createElement(tag);if(className)e.className=className;if(text)e.textContent=text;return e;
}
function field(label,type,name,opts={}){
  const l=el('label','price-calendar-field',label),i=el('input');
  i.type=type;i.name=name;i.required=true;
  if(opts.min!==undefined)i.min=String(opts.min);
  if(opts.max!==undefined)i.max=String(opts.max);
  if(opts.step!==undefined)i.step=String(opts.step);
  l.append(i);return [l,i];
}
function style(){
  if(document.getElementById(STYLE_ID))return;
  const css=el('style');css.id=STYLE_ID;
  css.textContent=`
    /* Display live effective nightly rates within existing DayPicker day buttons.
       Pseudo-elements do not modify React-owned DOM children or date selection. */
    .owner-calendar .admin-calendar td[data-day] > button[data-admin-night-price]{
      display:flex!important;flex-direction:column!important;align-items:center!important;
      justify-content:center!important;gap:2px!important;padding:2px 0!important;
      font-size:15px!important;line-height:1.05!important;min-height:var(--cell-size)!important;
      width:100%;font-variant-numeric:tabular-nums;
    }
    .owner-calendar .admin-calendar button[data-admin-night-price]::after{
      content:attr(data-admin-night-price);display:block;font-size:9px;font-weight:550;
      line-height:1!important;letter-spacing:-.035em;white-space:nowrap;
      opacity:.82;pointer-events:none;font-variant-numeric:tabular-nums;
    }
    .owner-calendar .admin-calendar button[data-admin-price-compact="1"]::after{font-size:8px;letter-spacing:-.06em}
    .owner-calendar .admin-calendar button[data-admin-price-special="1"]::after{
      font-weight:750;opacity:1;color:#235e81;
    }
    .owner-calendar .admin-calendar .occupied-day button[data-admin-price-special="1"]::after{color:#762925}
    @media(max-width:700px){
      .owner-calendar .admin-calendar td[data-day] > button[data-admin-night-price]{font-size:14px!important;gap:1px!important}
      .owner-calendar .admin-calendar button[data-admin-night-price]::after{font-size:8.5px}
      .owner-calendar .admin-calendar button[data-admin-price-compact="1"]::after{font-size:7.5px}
    }
    .price-calendar-mode-buttons{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}
    .price-calendar-mode-buttons button{min-height:44px;border:1px solid #858a8e;border-radius:12px;background:#303339;color:#fff;padding:10px 16px;cursor:pointer}
    .price-calendar-mode-buttons button[aria-pressed="true"]{background:#dbff00;color:#111;border-color:#dbff00;font-weight:700}
    .price-calendar-editor{padding:18px;border-radius:20px;background:#303339;border:1px solid #ffffff30;display:grid;gap:14px;min-width:0}
    .price-calendar-editor h3,.price-calendar-editor p{margin:0}
    .price-calendar-editor p{line-height:1.5;font-size:14px}
    .price-calendar-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .price-calendar-field{display:grid;gap:8px;min-width:0}
    .price-calendar-field input{width:100%;min-width:0;padding:12px;border:1px solid #888;border-radius:12px;font-size:16px;background:#fff;color:#111}
    .price-calendar-actions{display:flex;flex-wrap:wrap;gap:10px}
    .price-calendar-actions button{min-height:44px;padding:12px 16px;border-radius:12px;cursor:pointer}
    .price-calendar-actions button:disabled{opacity:.5;cursor:not-allowed}
    .price-calendar-reset{color:white;background:transparent;border:1px solid #bcbcbc}
    .owner-calendar:not(.price-calendar-mode) .price-calendar-editor{display:none}
    .owner-calendar.price-calendar-mode .calendar-grid>form:not(.price-calendar-editor){display:none}
    /* Hide retired one-day form and its legacy list, preserving stored price overrides. */
    .owner-calendar.legacy-price-controls-hidden > .special-price-form,
    .owner-calendar.legacy-price-controls-hidden > .special-price-form ~ .history{display:none!important}
    @media(max-width:700px){.price-calendar-dates{grid-template-columns:1fr}.price-calendar-mode-buttons button{flex:1}}
  `;
  document.head.append(css);
}
function mount(section){
  const grid=[...section.children].find(e=>e.classList.contains('calendar-grid'));
  if(!grid||grid.querySelector('.price-calendar-editor')||!grid.querySelector('.admin-calendar'))return;
  const oldForm=[...grid.children].find(e=>e.tagName==='FORM');
  if(!oldForm||oldForm.querySelectorAll('input[type="date"]').length<2)return;
  style();
  const modes=el('div','price-calendar-mode-buttons');
  modes.setAttribute('role','group');modes.setAttribute('aria-label','Действие с календарём');
  const occupancy=el('button','','Занятость'),prices=el('button','','Изменить цены');
  occupancy.type=prices.type='button';modes.append(occupancy,prices);grid.before(modes);

  const form=el('form','price-calendar-editor');
  form.append(el('h3','','Цена на выбранные даты'),el('p','','Выберите одну дату или первую и последнюю даты периода на календаре. Цена действует за каждую ночь. Существующие брони не пересчитываются.'));
  const [fromLabel,from]=field('С даты','date','price-from');
  const [toLabel,to]=field('По дату включительно','date','price-to');
  const dates=el('div','price-calendar-dates');dates.append(fromLabel,toLabel);
  const [priceLabel,amount]=field('Цена за ночь, ₽','number','price-amount',{min:1,max:1000000,step:1});
  const selected=el('p','','Выберите дату на календаре. Неделя выбирается двумя нажатиями.');
  selected.setAttribute('aria-live','polite');
  const actions=el('div','price-calendar-actions');
  const submit=el('button','','Установить цену');submit.type='submit';
  const reset=el('button','price-calendar-reset','Вернуть обычный тариф');reset.type='button';
  actions.append(submit,reset);
  const message=el('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  form.append(dates,priceLabel,selected,actions,message);grid.append(form);

  function selectedDays(){
    try{return dateRangeInclusive(from.value,to.value);}catch{return null;}
  }
  function refresh(){
    const days=selectedDays();
    selected.textContent=days?'Выбрано ночей: '+days.length:'Выберите дату или диапазон (не более 366 ночей).';
    let valid=false;try{checkedNightlyPrice(amount.value);valid=true;}catch{}
    submit.disabled=saving||!days||!valid;reset.disabled=saving||!days;
  }
  function syncSelection(){
    const inputs=oldForm.querySelectorAll('input[type="date"]');
    const first=inputs[0]?.value||'',last=inputs[1]?.value||first;
    if(first){from.value=first;to.value=last;message.textContent='';refresh();}
  }
  grid.addEventListener('click',e=>{
    if(e.target instanceof Element&&e.target.closest('.admin-calendar button')){
      setTimeout(syncSelection,0);requestAnimationFrame(syncSelection);
    }
  });
  grid.addEventListener('keyup',e=>{
    if(e.target instanceof Element&&e.target.closest('.admin-calendar button'))setTimeout(syncSelection,0);
  });
  [from,to,amount].forEach(input=>input.addEventListener('input',refresh));
  function setMode(active){
    section.classList.toggle('price-calendar-mode',active);
    prices.setAttribute('aria-pressed',String(active));
    occupancy.setAttribute('aria-pressed',String(!active));
    try{sessionStorage.setItem(MODE_KEY,active?'price':'occupancy');}catch{}
    if(active)syncSelection();
    refresh();
  }
  occupancy.addEventListener('click',()=>setMode(false));
  prices.addEventListener('click',()=>setMode(true));

  async function save(action,price=null){
    const days=selectedDays();
    if(!days){message.textContent='Выберите корректный период.';return;}
    if(action==='setDatePricesRange'&&days.length>30&&!confirm('Изменить цену на '+days.length+' ночей?'))return;
    if(action==='removeDatePricesRange'&&!confirm('Вернуть обычные тарифы для всех выбранных дат?'))return;
    saving=true;message.textContent='Сохраняем изменения…';refresh();
    try{
      const response=await fetch('/api/club',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,from:from.value,to:to.value,...(price===null?{}:{price})})
      });
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(response.status===401?'Войдите в админку заново.':(result.error||'Не удалось сохранить.'));
      message.textContent='Сохранено. Обновляем цены…';
      window.dispatchEvent(new Event('prices-updated'));
      window.setTimeout(()=>window.location.reload(),650);
    }catch(error){
      saving=false;message.textContent=error.message||'Ошибка сохранения';refresh();
    }
  }
  form.addEventListener('submit',e=>{
    e.preventDefault();if(saving)return;
    let value;try{value=checkedNightlyPrice(amount.value);}catch{message.textContent='Укажите целую цену от 1 до 1000000 ₽.';return;}
    void save('setDatePricesRange',value);
  });
  reset.addEventListener('click',()=>{if(!saving)void save('removeDatePricesRange');});
  let active=false;try{active=sessionStorage.getItem(MODE_KEY)==='price';}catch{}
  setMode(active);
}
function hideLegacyPriceControls(){
  const legacyForms=document.querySelectorAll('.owner-calendar > .special-price-form');
  if(!legacyForms.length)return;
  style();
  for(const form of legacyForms){
    form.parentElement.classList.add('legacy-price-controls-hidden');
  }
}
function paintNightlyPrices(){
  if(!calendarPricing)return;
  // DayPicker puts the ISO date on each table cell, unlike its localized day button.
  // Only update attributes, never the text/children managed by React.
  document.querySelectorAll('.owner-calendar .calendar-grid .admin-calendar td[data-day]').forEach(cell=>{
    const date=cell.getAttribute('data-day');
    const button=cell.querySelector('button');
    if(!button)return;
    const effective=calendarNightPrice(calendarPricing,date);
    if(!effective){
      button.removeAttribute('data-admin-night-price');
      button.removeAttribute('data-admin-price-special');
      button.removeAttribute('data-admin-price-compact');
      return;
    }
    const display=formatCalendarNightPrice(effective.price);
    if(button.getAttribute('data-admin-night-price')!==display)button.setAttribute('data-admin-night-price',display);
    const special=effective.special?'1':'0';
    if(button.getAttribute('data-admin-price-special')!==special)button.setAttribute('data-admin-price-special',special);
    const compact=display.length>6?'1':'0';
    if(button.getAttribute('data-admin-price-compact')!==compact)button.setAttribute('data-admin-price-compact',compact);
  });
}
function loadCalendarPricing(force=false){
  if(!document.querySelector('.owner-calendar .calendar-grid .admin-calendar'))return;
  if(pricingRequest)return;
  if(!force&&calendarPricing){paintNightlyPrices();return;}
  if(!force&&Date.now()-lastPricingRequest<15000)return;
  lastPricingRequest=Date.now();
  pricingRequest=fetch('/api/pricing',{credentials:'same-origin',cache:'no-store'})
    .then(response=>{if(!response.ok)throw new Error('Pricing not available');return response.json();})
    .then(data=>{
      if(!data||!data.dates||!Number.isFinite(Number(data.weekday))||!Number.isFinite(Number(data.friday))||!Number.isFinite(Number(data.saturday)))throw new Error('Invalid pricing data');
      calendarPricing=data;
      lastPricingSuccess=Date.now();
      paintNightlyPrices();
    })
    .catch(error=>{console.warn('Unable to display admin calendar prices:',error);})
    .finally(()=>{pricingRequest=null;});
}
function mountAll(){
  hideLegacyPriceControls();
  document.querySelectorAll('.owner-calendar').forEach(mount);
  if(document.querySelector('.owner-calendar .calendar-grid .admin-calendar')){
    if(calendarPricing)paintNightlyPrices();
    else loadCalendarPricing();
  }
}
function refreshCalendarPricing(){
  if(document.hidden||!document.querySelector('.owner-calendar .calendar-grid .admin-calendar'))return;
  if(Date.now()-lastPricingSuccess>=30000)loadCalendarPricing(true);
}
if(typeof window!=='undefined'){
  window.addEventListener('prices-updated',()=>loadCalendarPricing(true));
  window.addEventListener('focus',refreshCalendarPricing);
  document.addEventListener('visibilitychange',refreshCalendarPricing);
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountAll,{once:true});
  else mountAll();
  new MutationObserver(mountAll).observe(document.documentElement,{childList:true,subtree:true});
}
