import { ekaterinburgToday, sortBirthdayClients, birthdayHint } from './birthday-utils.js';
import { recognizeRussianPassport } from './passport-ocr.js';

const MODULE_CLASS='birthday-clients-module';
const STYLE_ID='birthday-clients-style';
const formatDate=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
function node(tag,className='',text=''){
 const item=document.createElement(tag);
 if(className)item.className=className;
 if(text)item.textContent=text;
 return item;
}
function dateText(date){
 const value=Date.parse(String(date||'')+'T00:00:00Z');
 return Number.isFinite(value)?formatDate.format(new Date(value)):'—';
}
function formField(label,type,placeholder='',required=true){
 const wrap=node('label','birthday-input-field');
 const title=node('span','',label),input=node('input');
 input.type=type;input.placeholder=placeholder;input.required=required;input.autocomplete='off';
 wrap.append(title,input);
 return {wrap,input};
}
function injectStyles(){
 if(document.getElementById(STYLE_ID))return;
 const stylesheet=node('link');stylesheet.id=STYLE_ID;
 stylesheet.rel='stylesheet';stylesheet.href='/admin-birthdays.css';
 document.head.append(stylesheet);
}
function createBirthdayModule(section){
 if(section.querySelector('.'+MODULE_CLASS))return;
 injectStyles();
 const root=node('section',MODULE_CLASS);
 root.setAttribute('aria-label','Дни рождения клиентов');
 const heading=node('div','birthday-heading');
 const title=node('h2','','Дни рождения клиентов');
 const count=node('span','birthday-count','0');title.append(count);
 const add=node('button','birthday-add','+ Добавить клиента');add.type='button';
 heading.append(title,add);
 const about=node('p','birthday-about',
   'Ближайшие дни рождения отображаются первыми. Данные доступны только владельцу, приглашения не отправляются автоматически.');
 const toolbar=node('div','birthday-toolbar');
 const search=node('input','birthday-search');search.type='search';search.placeholder='Поиск по имени или номеру';
 search.setAttribute('aria-label','Поиск клиентов');
 const upcomingCount=node('span','birthday-upcoming-count');
 toolbar.append(search,upcomingCount);
 const form=node('form','birthday-client-form');form.hidden=true;
 const formTitle=node('h3','birthday-form-title','Новый клиент');
 const name=formField('Имя клиента','text','Имя и фамилия');
 name.input.maxLength=80;name.input.autocomplete='name';
 const phone=formField('Телефон','tel','+7 900 000-00-00');
 phone.input.autocomplete='tel';
 const birthday=formField('Дата рождения','date');
 birthday.input.min='1900-01-01';birthday.input.max=ekaterinburgToday();
 const formGrid=node('div','birthday-form-grid');formGrid.append(name.wrap,phone.wrap,birthday.wrap);
 const consentLabel=node('label','birthday-consent');
 const consent=node('input');consent.type='checkbox';
 consentLabel.append(consent,node('span','',
   'Клиент дал согласие получать предложения и приглашения. Если нет — быстрые кнопки связи отключены.'));
 const formActions=node('div','birthday-form-actions');
 const save=node('button','birthday-save','Сохранить');save.type='submit';
 const cancel=node('button','birthday-cancel','Отмена');cancel.type='button';
 formActions.append(save,cancel);
 const scanBox=node('section','birthday-scan-box');
 scanBox.setAttribute('aria-label','Распознать паспорт');
 const scanHeader=node('strong','birthday-scan-heading','Заполнить по фото паспорта');
 const scanDescription=node('p','birthday-scan-note',
  'Выбери фотографию страницы с ФИО и датой рождения. Распознавание выполняется на этом устройстве; фото не загружается на сервер сайта. После распознавания обязательно проверь поля.');
 const scanPermissionLabel=node('label','birthday-consent birthday-scan-permission');
 const scanPermission=node('input');scanPermission.type='checkbox';
 scanPermissionLabel.append(scanPermission,node('span','',
  'Подтверждаю, что владелец паспорта разрешил использовать его фото для заполнения карточки.'));
 const scanInputLabel=node('label','birthday-input-field','Фото паспорта');
 const scanInput=node('input','birthday-scan-file');
 scanInput.type='file';scanInput.accept='image/jpeg,image/png,image/webp,image/heic,image/heif';
 scanInput.setAttribute('aria-label','Выбрать фото паспортной страницы');
 scanInputLabel.append(scanInput);
 const scanRotationLabel=node('label','birthday-input-field birthday-scan-rotation');
 scanRotationLabel.append(node('span','','Поворот фото (если текст расположен боком)'));
 const scanRotation=node('select','birthday-scan-select');
 for(const [angle,label] of [['0','Без поворота'],['90','Повернуть на 90°'],['180','Повернуть на 180°'],['270','Повернуть на 270°']]){
  const option=node('option','',label);option.value=angle;scanRotation.append(option);
 }
 scanRotationLabel.append(scanRotation);
 const scanButton=node('button','birthday-scan-button','Распознать фото');
 scanButton.type='button';
 const scanStatus=node('p','birthday-scan-status');
 scanStatus.setAttribute('role','status');
 scanStatus.setAttribute('aria-live','polite');
 scanBox.append(scanHeader,scanDescription,scanPermissionLabel,scanInputLabel,scanRotationLabel,scanButton,scanStatus);
 form.append(formTitle,formGrid,scanBox,consentLabel,formActions);
 const message=node('p','birthday-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 const list=node('div','birthday-list');
 root.append(heading,about,form,toolbar,message,list);
 section.append(root);

 let clients=[],editId=null,busy=false,scanning=false,initialized=false;
 function setScanStatus(message,kind='info'){
  scanStatus.textContent=message;
  scanStatus.setAttribute('data-kind',kind);
 }
 function notify(text,kind='info'){
  message.textContent=text;
  message.setAttribute('data-kind',kind);
 }
 function resetEditor(){
  editId=null;form.reset();scanInput.value='';scanRotation.value='0';setScanStatus('');form.hidden=true;
  save.textContent='Сохранить';formTitle.textContent='Новый клиент';
 }
 function edit(client=null){
  editId=client?.id||null;form.hidden=false;
  name.input.value=client?.name||'';
  phone.input.value=client?.phone?'+'+client.phone:'';
  birthday.input.value=client?.birth_date||'';
  consent.checked=client?.invitation_consent===true;
  formTitle.textContent=editId?'Редактировать клиента':'Новый клиент';
  save.textContent=editId?'Сохранить изменения':'Добавить клиента';
  notify('');
  scanInput.value='';scanRotation.value='0';scanPermission.checked=false;setScanStatus('');
  name.input.focus();
 }
 function cardFor(client){
  const days=client.daysUntil;
  const soon=Number.isInteger(days)&&days<=30;
  const card=node('article','birthday-client-card'+(soon?' is-soon':''));
  const main=node('div');
  main.append(node('strong','birthday-name',client.name));
  main.append(node('span','birthday-small',
    client.invitation_consent?'Согласен на приглашения':'Без согласия на приглашения'));
  const contact=node('div');
  contact.append(node('span','birthday-phone','+'+client.phone));
  contact.append(node('span','birthday-small','Родился: '+dateText(client.birth_date)));
  const next=node('div');
  next.append(node('div','birthday-next',client.nextDate?dateText(client.nextDate):'Дата не указана'));
  if(Number.isInteger(days))next.append(node('span',soon?'birthday-soon-tag':'birthday-small',birthdayHint(days)));
  const actions=node('div','birthday-actions');
  if(client.invitation_consent===true&&/^7\d{10}$/.test(client.phone)){
   const call=node('a','','Позвонить');call.href='tel:+'+client.phone;
   const whats=node('a','birthday-write','Написать');
   const greeting='Здравствуйте, '+client.name+'! Приглашаем вас отметить день рождения в коттедже «Собери своих на Хвойной». Если интересно, расскажем о свободных датах.';
   whats.href='https://wa.me/'+client.phone+'?text='+encodeURIComponent(greeting);
   whats.target='_blank';whats.rel='noopener noreferrer';
   whats.setAttribute('aria-label','Написать клиенту '+client.name+' в WhatsApp');
   actions.append(call,whats);
  }
  const change=node('button','','Изменить');change.type='button';
  change.addEventListener('click',()=>edit(client));
  const remove=node('button','birthday-delete','Удалить');remove.type='button';
  remove.addEventListener('click',()=>{void deleteClient(client);});
  actions.append(change,remove);
  card.append(main,contact,next,actions);
  return card;
 }
 function render(){
  if(!root.isConnected)return;
  const sorted=sortBirthdayClients(clients,ekaterinburgToday());
  count.textContent=String(sorted.length);
  upcomingCount.textContent=sorted.filter(c=>Number.isInteger(c.daysUntil)&&c.daysUntil>=0&&c.daysUntil<=30).length+' ДР в ближайшие 30 дней';
  const query=search.value.trim().toLocaleLowerCase('ru-RU'),digits=query.replace(/\D/g,'');
  const filtered=sorted.filter(c=>!query||c.name.toLocaleLowerCase('ru-RU').includes(query)||
    (digits.length>=3&&c.phone.includes(digits)));
  list.replaceChildren();
  if(!filtered.length){
   list.append(node('div','birthday-empty',query?'Клиенты по запросу не найдены.':
     'Пока никого нет. Нажмите «Добавить клиента», чтобы создать первую запись.'));
   return;
  }
  const fragment=document.createDocumentFragment();
  for(const client of filtered)fragment.append(cardFor(client));
  list.append(fragment);
 }
 async function request(method='GET',payload=null){
  const options={method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
  if(payload!==null){
   options.headers['Content-Type']='application/json';
   options.headers['X-Requested-With']='XMLHttpRequest';
   options.body=JSON.stringify(payload);
  }
  const response=await fetch('/api/admin/birthdays',options);
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(response.status===401?'Войдите в админку заново.':(result.error||'Не удалось выполнить запрос.'));
  return result;
 }
 async function load(){
  try{
   const data=await request();
   if(!Array.isArray(data.clients))throw new Error('Некорректный список клиентов.');
   clients=data.clients;
   render();
   if(!initialized)notify('');
   initialized=true;
  }catch(error){
   clients=[];render();notify(error.message||'Не удалось загрузить дни рождения.','error');
  }
 }
 async function deleteClient(client){
  if(busy||!window.confirm('Удалить запись «'+client.name+'»? Данные будут удалены без возможности восстановления.'))return;
  busy=true;notify('Удаляем запись…');
  try{
   await request('POST',{action:'delete',id:client.id});
   clients=clients.filter(item=>item.id!==client.id);
   if(editId===client.id)resetEditor();
   render();notify('Запись удалена.','success');
  }catch(error){notify(error.message,'error');}
  finally{busy=false;}
 }
 scanButton.addEventListener('click',async()=>{
  if(scanning||busy)return;
  const selected=scanInput.files?.[0];
  if(!selected){setScanStatus('Сначала выбери фотографию паспорта.','error');return;}
  if(!scanPermission.checked){
   setScanStatus('Сначала подтверди разрешение владельца паспорта.','error');
   return;
  }
  scanning=true;
  scanButton.disabled=true;
  scanInput.disabled=true;
  save.disabled=true;
  scanButton.textContent='Распознаём…';
  setScanStatus('Подготавливаем фотографию…');
  try{
   const extracted=await recognizeRussianPassport(selected,progress=>setScanStatus(progress),{rotation:Number(scanRotation.value)});
   // Never save automatically. Do not leave stale OCR results in either field.
   // Keep manually entered values untouched when OCR cannot verify a field.
   if(extracted.fullName)name.input.value=extracted.fullName;
   if(extracted.birthDate)birthday.input.value=extracted.birthDate;
   const recognized=[];
   if(extracted.fullName)recognized.push('ФИО: '+extracted.fullName);
   if(extracted.birthDate)recognized.push('Дата рождения: '+extracted.birthDate);
   const warnings=extracted.warnings||[];
   setScanStatus(
    (recognized.length?recognized.join('\n')+'\n':'Нужные поля не распознаны.\n')+
    (warnings.length?warnings.join('\n')+'\n':'')+
    (extracted.recognizedCharacters===0?
       'OCR не обнаружил читаемый текст. Сними страницу крупнее при хорошем освещении или поверни фото.\n':
       'Движок прочитал '+extracted.recognizedCharacters+' символов (оценка качества '+extracted.confidence+'%).\n')+
    'Проверь данные по оригиналу. Нажми «Сохранить» только после проверки.',
    (extracted.fullName&&extracted.birthDate)?'success':'error'
   );
  }catch(error){
   setScanStatus(error?.message||'Не удалось распознать фотографию. Заполни поля вручную.','error');
  }finally{
   // Drop the browser's reference to the selected document image.
   scanInput.value='';
   scanning=false;
   scanButton.disabled=false;
   scanInput.disabled=false;
   save.disabled=busy;
   scanButton.textContent='Распознать фото';
  }
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||scanning)return;
  busy=true;save.disabled=true;cancel.disabled=true;scanButton.disabled=true;notify('Сохраняем данные…');
  try{
   const payload={action:'save',name:name.input.value,phone:phone.input.value,
     birth_date:birthday.input.value,invitation_consent:consent.checked};
   if(editId)payload.id=editId;
   await request('POST',payload);
   resetEditor();
   await load();
   notify('Клиент сохранён.','success');
  }catch(error){notify(error.message||'Ошибка сохранения.','error');}
  finally{busy=false;save.disabled=false;cancel.disabled=false;scanButton.disabled=false;}
 });
 add.addEventListener('click',()=>edit());
 cancel.addEventListener('click',resetEditor);
 search.addEventListener('input',render);
 notify('Загружаем клиентов…');
 void load();
 window.addEventListener('focus',()=>{if(root.isConnected&&!busy)void load();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&root.isConnected&&!busy)void load();});
}
function mount(){
 const section=[...document.querySelectorAll('section.member-section')].find(s=>
  [...s.children].some(child=>child.tagName==='H2'&&child.textContent.includes('Участники программы')));
 if(!section||section.querySelector('.'+MODULE_CLASS))return;
 createBirthdayModule(section);
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
 else mount();
 new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
}
