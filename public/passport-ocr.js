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

export async function recognizeRussianPassport(file,onProgress=()=>{}){
 const notify=(message)=>{if(typeof onProgress==='function')onProgress(message);};
 notify('Готовим фотографию…');
 const canvas=await decodeImage(file);
 let worker;
 try{
  notify('Загружаем русскую модель распознавания…');
  const Tesseract=await loadOcrLibrary();
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
  notify('Читаем данные паспорта…');
  const result=await worker.recognize(canvas);
  const parsed=extractPassportIdentity(result?.data?.text||'');
  return { ...parsed, confidence: Math.max(0,Math.min(100,Math.round(Number(result?.data?.confidence)||0))) };
 }catch(error){
  // Never log OCR text or the original image.
  if(error?.message?.startsWith('Выберите фотографию'))throw error;
  throw new Error('Не удалось распознать фото. Проверьте интернет и качество снимка или заполните поля вручную.');
 }finally{
  canvas.width=0;canvas.height=0;
  if(worker){try{await worker.terminate();}catch{/* cleanup best effort */}}
 }
}
