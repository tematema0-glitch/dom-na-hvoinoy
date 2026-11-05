import { ekaterinburgToday, isValidISODate } from './birthday-utils.js';

// Tesseract runs in a browser Web Worker. Only the OCR engine and Russian
// language model are downloaded; the selected photo is never uploaded.
// Pin every executable resource to an exact version for this first pilot.
const TESSERACT_VERSION='7.0.0';
const CDN='https://cdn.jsdelivr.net/npm/';
const SCRIPT_URL=CDN+'tesseract.js@'+TESSERACT_VERSION+'/dist/tesseract.min.js';
const WORKER_URL=CDN+'tesseract.js@'+TESSERACT_VERSION+'/dist/worker.min.js';
const CORE_URL=CDN+'tesseract.js-core@7.0.0';
const LANGUAGE_URL=CDN+'@tesseract.js-data/rus/4.0.0_best_int';
const MAX_FILE_BYTES=15*1024*1024;
const MAX_IMAGE_EDGE=2600;
let libraryPromise=null;

export function normalizePassportLines(text){
 if(typeof text!=='string')return [];
 return text.normalize('NFKC').replace(/\u00ad/g,'').split(/\r?\n/)
  .map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,160);
}
function cleanPart(raw){
 const match=String(raw||'').toLocaleUpperCase('ru-RU').match(/^[\s:.\-\u2014]*([А-ЯЁ]{2,40}(?:-[А-ЯЁ]{2,40})?)(?=\s|[.,;:]|$)/u);
 if(!match)return null;
 const value=match[1];
 if(/^(?:ФАМИЛИЯ|ИМЯ|ОТЧЕСТВО|РОЖДЕНИЯ|МУЖСКОЙ|ЖЕНСКИЙ|РОССИЙСКАЯ|ФЕДЕРАЦИЯ|ПОЛ|ГОРОД|ДАТА|МЕСТО|ВЫДАН|РОССИЯ)$/.test(value))return null;
 return value.toLocaleLowerCase('ru-RU').split('-').map(s=>s[0].toLocaleUpperCase('ru-RU')+s.slice(1)).join('-');
}
function findLabeledName(lines,label){
 const expression=label==='surname'?/(?:^|[^А-ЯЁ])ФАМИЛИ[ЯИ](?=$|[^А-ЯЁ])/iu:label==='given'?/(?:^|[^А-ЯЁ])ИМЯ(?=$|[^А-ЯЁ])/iu:/(?:^|[^А-ЯЁ])ОТЧЕСТВО(?=$|[^А-ЯЁ])/iu;
 for(let index=0;index<lines.length;index++){
  const line=lines[index];
  const match=expression.exec(line);
  if(!match)continue;
  const inline=cleanPart(line.slice(match.index+match[0].length));
  if(inline)return inline;
  // Values in Russian passports often occupy the line immediately under labels.
  for(let offset=1;offset<=2&&index+offset<lines.length;offset++){
   const next=lines[index+offset];
   if(/(?:^|[^А-ЯЁ])(?:ФАМИЛИ[ЯИ]|ИМЯ|ОТЧЕСТВО|ДАТА|РОЖДЕНИЯ|МЕСТО|ПОЛ|ВЫДАН)(?=$|[^А-ЯЁ])/iu.test(next))break;
   const candidate=cleanPart(next);
   if(candidate)return candidate;
  }
 }
 return null;
}
function detectDate(text,today){
 const cleaned=text.replace(/\s*([.\/-])\s*/g,'$1');
 const candidates=cleaned.matchAll(/\b([0-3]?\d)[.\/\s-]([01]?\d)[.\/\s-]((?:19|20)\d{2})\b/g);
 for(const m of candidates){
  const iso=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  if(isValidISODate(iso)&&iso>='1900-01-01'&&iso<=today)return iso;
 }
 return null;
}
function findBirthDate(lines,today){
 for(let index=0;index<lines.length;index++){
  const upper=lines[index].toLocaleUpperCase('ru-RU');
  if(!/РОЖДЕНИ[ЯЕ]/u.test(upper)||/МЕСТО/u.test(upper))continue;
  // Never infer DOB from a preceding passport issue date.
  const found=detectDate(lines.slice(index,index+3).join(' '),today);
  if(found)return found;
 }
 return null;
}

export function extractPassportIdentity(text,today=ekaterinburgToday()){
 const lines=normalizePassportLines(text);
 const surname=findLabeledName(lines,'surname');
 const givenName=findLabeledName(lines,'given');
 const patronymic=findLabeledName(lines,'patronymic');
 const birthDate=findBirthDate(lines,today);
 const fullName=surname&&givenName?[surname,givenName,patronymic].filter(Boolean).join(' '):'';
 const warnings=[];
 if(!fullName)warnings.push('Не удалось уверенно определить фамилию и имя.');
 if(!patronymic)warnings.push('Отчество не распознано — проверьте его вручную.');
 if(!birthDate)warnings.push('Дата рождения не распознана.');
 // Return only the two fields needed by the directory; don't retain MRZ,
 // passport series/number, issue authority, signature or address.
 return {fullName,birthDate,warnings};
}

function loadOcrLibrary(){
 if(typeof window==='undefined'||typeof document==='undefined')return Promise.reject(new Error('Доступно только в браузере.'));
 if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
 if(libraryPromise)return libraryPromise;
 libraryPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=SCRIPT_URL;
  script.async=true;
  script.referrerPolicy='no-referrer';
  script.onload=()=>{
   if(window.Tesseract?.createWorker)resolve(window.Tesseract);
   else reject(new Error('Не удалось запустить движок распознавания.'));
  };
  script.onerror=()=>reject(new Error('Не загрузился движок OCR. Проверьте интернет и повторите.'));
  document.head.append(script);
 }).catch(error=>{libraryPromise=null;throw error;});
 return libraryPromise;
}
async function decodeImage(file){
 if(!file||!file.type.startsWith('image/')||!Number.isFinite(file.size)||file.size<1||file.size>MAX_FILE_BYTES){
  throw new Error('Выберите фотографию паспортной страницы до 15 МБ.');
 }
 let bitmap=null,image=null,url=null;
 try{
  if(typeof createImageBitmap==='function'){
   try{bitmap=await createImageBitmap(file);}catch{/* image decoder fallback for mobile Safari */}
  }
  if(!bitmap){
   url=URL.createObjectURL(file);
   image=new Image();
   image.decoding='async';
   image.src=url;
   if(typeof image.decode==='function')await image.decode();
   else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;});
  }
  const width=bitmap?.width||image.naturalWidth;
  const height=bitmap?.height||image.naturalHeight;
  if(!width||!height||width<400||height<300)throw new Error('Фото слишком маленькое. Снимите страницу крупнее.');
  const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Не удалось обработать фотографию.');
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bitmap||image,0,0,canvas.width,canvas.height);
  return canvas;
 }finally{
  if(bitmap)bitmap.close();
  if(url)URL.revokeObjectURL(url);
 }
}

function rotateCanvas(source,angle){
 if(angle===0)return source;
 const rotated=document.createElement('canvas');
 const quarterTurn=angle===90||angle===270;
 rotated.width=quarterTurn?source.height:source.width;
 rotated.height=quarterTurn?source.width:source.height;
 const ctx=rotated.getContext('2d',{alpha:false});
 if(!ctx)throw new Error('Не удалось повернуть фотографию.');
 ctx.fillStyle='#fff';
 ctx.fillRect(0,0,rotated.width,rotated.height);
 ctx.translate(rotated.width/2,rotated.height/2);
 ctx.rotate(angle*Math.PI/180);
 ctx.drawImage(source,-source.width/2,-source.height/2);
 return rotated;
}

// In a Russian passport the field captions are small and printed to the left
// of the values. OCR on the entire photograph commonly loses those captions.
// A separate read of the lower-right identity block is therefore essential.
function identityCrop(source,variant=0){
 const portrait=source.height>source.width;
 const rect=portrait?
  (variant===0?[.43,.43,.55,.35]:[.48,.47,.49,.25]):
  (variant===0?[.39,.40,.59,.44]:[.44,.44,.54,.34]);
 const canvas=document.createElement('canvas');
 const sw=Math.max(1,Math.round(source.width*rect[2]));
 const sh=Math.max(1,Math.round(source.height*rect[3]));
 canvas.width=Math.min(3000,sw*2);
 canvas.height=Math.min(2200,sh*2);
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx)throw new Error('Не удалось подготовить область ФИО.');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(source,Math.round(source.width*rect[0]),Math.round(source.height*rect[1]),sw,sh,0,0,canvas.width,canvas.height);
 return canvas;
}
const BLOCKED_NAME_WORDS=new Set([
 'РОССИЯ','РОССИЙСКАЯ','ФЕДЕРАЦИЯ','ОБЛАСТЬ','СВЕРДЛОВСКАЯ',
 'ФАМИЛИЯ','ИМЯ','ОТЧЕСТВО','РОЖДЕНИЯ','ДАТА','МЕСТО','ПОЛ',
 'ЖЕН','МУЖ','ЖЕНСКИЙ','МУЖСКОЙ','ГОРОД','ГОР','ЕКАТЕРИНБУРГ',
 'РОССИИ','МВД','КОД','ПОДРАЗДЕЛЕНИЯ','ВЫДАН','ГУ','РФ','РУС'
]);
function identityFromRegion(text,today=ekaterinburgToday()){
 const lines=normalizePassportLines(text);
 const candidates=[];
 for(const line of lines){
  // Avoid selecting a random date as a name; the identity zone contains
  // three adjacent uppercase Cyrillic values, usually on separate lines.
  const words=(line.toLocaleUpperCase('ru-RU').match(/[А-ЯЁ]{3,32}(?:-[А-ЯЁ]{3,32})?/gu)||[])
   .filter(w=>!BLOCKED_NAME_WORDS.has(w));
  if(words.length===1&&line.replace(/[^А-ЯЁа-яё]/g,'').length<=words[0].length+3)
   candidates.push(words[0]);
  else if(words.length>=2&&words.length<=3&&
    words.join('').length>=line.replace(/[^А-ЯЁа-яё]/g,'').length-3)
   candidates.push(...words);
 }
 const unique=candidates.filter((word,i)=>i===0||word!==candidates[i-1]);
 let fullName='';
 if(unique.length>=3&&unique.length<=7){
  // Last name, first name, patronymic must occur in sequence. If the
  // region is noisy, don't invent a name; the user can correct manually.
  const group=unique.slice(0,3);
  if(group.every(w=>w.length>=3)&&group[0]!==group[1]){
   fullName=group.map(w=>w.toLocaleLowerCase('ru-RU').replace(/(^|-)[а-яё]/gu,x=>x.toLocaleUpperCase('ru-RU'))).join(' ');
  }
 }
 const birthDate=detectDate(lines.join(' '),today);
 return {fullName,birthDate,warnings:[]};
}

function mergePasses(first,second){
 if(!second)return first;
 const warnings=[];
 const fullName=first.fullName||second.fullName;
 const birthDate=first.birthDate||second.birthDate;
 if(first.fullName&&second.fullName&&first.fullName!==second.fullName)
  warnings.push('Два способа чтения дали разные ФИО. Сверьте результат с документом.');
 if(first.birthDate&&second.birthDate&&first.birthDate!==second.birthDate)
  warnings.push('Два способа чтения дали разные даты рождения. Проверьте дату вручную.');
 return {
  fullName,birthDate,
  warnings:[...new Set([...first.warnings,...second.warnings,...warnings])].filter(w=>
    !(fullName&&w.includes('фамилию и имя'))&&
    !(birthDate&&w==='Дата рождения не распознана.')&&
    !(second.fullName&&second.fullName.trim().split(/\s+/).length>=3&&w.includes('Отчество не распознано')))
 };
}

export async function recognizeRussianPassport(file,onProgress=()=>{},options={}){
 const notify=message=>{if(typeof onProgress==='function')onProgress(message);};
 const angle=Number(options.rotation||0);
 if(![0,90,180,270].includes(angle))throw new Error('Недопустимый поворот изображения.');
 notify('Подготавливаем фотографию…');
 let originalCanvas,workingCanvas,worker,stage='photo';
 try{
  originalCanvas=await decodeImage(file);
  workingCanvas=rotateCanvas(originalCanvas,angle);
  stage='library';
  notify('Загружаем движок OCR…');
  const Tesseract=await loadOcrLibrary();
  stage='model';
  notify('Загружаем русскую модель распознавания…');
  worker=await Tesseract.createWorker('rus',1,{
   workerPath:WORKER_URL,
   corePath:CORE_URL,
   langPath:LANGUAGE_URL,
   logger:report=>{
    if(report?.status==='recognizing text'){
     const progress=Math.max(0,Math.min(100,Math.round((report.progress||0)*100)));
     notify('Распознаём текст: '+progress+'%');
    }
   }
  });
  stage='recognition';
  notify('Читаем ФИО и дату рождения…');
  const firstResult=await worker.recognize(workingCanvas);
  const firstText=firstResult?.data?.text||'';
  const first=extractPassportIdentity(firstText);
  let second=null,secondText='',secondConfidence=0;
  if(!first.fullName||!first.birthDate){
   notify('Первая попытка не нашла все поля. Проверяем вторым способом…');
   try{
    await worker.setParameters({tessedit_pageseg_mode:'11'});
    const secondResult=await worker.recognize(workingCanvas,{rotateAuto:true});
    secondText=secondResult?.data?.text||'';
    secondConfidence=Number(secondResult?.data?.confidence)||0;
    second=extractPassportIdentity(secondText);
   }catch{
    // A second recognition method is optional: preserve the first result.
    notify('Дополнительное распознавание недоступно. Проверяем первый результат…');
   }
  }
  let parsed=mergePasses(first,second);
  let regionCharacters=0;
  if(!parsed.fullName||!parsed.birthDate){
   notify('Читаем крупным планом область с ФИО и датой рождения…');
   for(let variant=0;variant<2;variant++){
    let crop=null;
    try{
     crop=identityCrop(workingCanvas,variant);
     await worker.setParameters({tessedit_pageseg_mode:'6'});
     const regional=await worker.recognize(crop);
     const text=regional?.data?.text||'';
     regionCharacters=Math.max(regionCharacters,text.trim().length);
     const byLabels=extractPassportIdentity(text);
     const byPosition=identityFromRegion(text);
     const candidate={
      fullName:byLabels.fullName||byPosition.fullName,
      birthDate:byLabels.birthDate||byPosition.birthDate,
      warnings:[]
     };
     parsed=mergePasses(parsed,candidate);
     if(parsed.fullName&&parsed.birthDate)break;
    }catch{/* optional regional pass must never break manual entry */}
    finally{if(crop){crop.width=0;crop.height=0;}}
   }
  }
  const recognizedCharacters=Math.max(firstText.trim().length,secondText.trim().length,regionCharacters);
  return {
   ...parsed,
   confidence:Math.max(0,Math.min(100,Math.round(Math.max(Number(firstResult?.data?.confidence)||0,secondConfidence)))),
   recognizedCharacters
  };
 }catch(error){
  // Never log the selected passport image or the OCR text, even on failure.
  if(stage==='library')throw new Error('Не удалось загрузить движок OCR. Проверь интернет или блокировщик рекламы.');
  if(stage==='model')throw new Error('Не удалось запустить русскую модель OCR. Попробуй другую сеть или браузер.');
  if(stage==='photo')throw error;
  throw new Error('Движок OCR не смог обработать изображение. Попробуй JPEG, поворот или другое фото.');
 }finally{
  if(worker){try{await worker.terminate();}catch{/* best effort */}}
  if(workingCanvas&&workingCanvas!==originalCanvas){workingCanvas.width=0;workingCanvas.height=0;}
  if(originalCanvas){originalCanvas.width=0;originalCanvas.height=0;}
 }
}
