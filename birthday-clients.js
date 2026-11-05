import { ekaterinburgToday, isValidISODate } from './public/birthday-utils.js';

const minBirthday='1900-01-01';
const MAX_NAME=80;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bad(message,status=400){
 return Object.assign(new Error(message),{status});
}
export function validateBirthdayRecord(input,normalizePhone,today=ekaterinburgToday()){
 const x=input||{};
 if(typeof x.name!=='string'||/[\u0000-\u001f\u007f]/.test(x.name))throw bad('Укажите имя клиента без управляющих символов.');
 const name=x.name.trim().replace(/\s+/gu,' ');
 if(name.length<2||name.length>MAX_NAME)throw bad('Имя должно содержать от 2 до 80 символов.');
 if(typeof normalizePhone!=='function')throw Error('Phone normalizer unavailable');
 const phone=normalizePhone(x.phone);
 if(!phone)throw bad('Укажите корректный российский номер телефона.');
 if(typeof x.birth_date!=='string'||!isValidISODate(x.birth_date)||
    x.birth_date<minBirthday||x.birth_date>today)throw bad('Проверьте дату рождения клиента.');
 if(typeof x.invitation_consent!=='boolean')throw bad('Укажите, разрешил ли клиент приглашения.');
 return {name,phone,birth_date:x.birth_date,invitation_consent:x.invitation_consent};
}
export function validateBirthdayId(id){
 if(typeof id!=='string'||!UUID.test(id))throw bad('Некорректный идентификатор клиента.');
 return id;
}
export async function saveBirthdayRecord(queryable,input,normalizePhone,newId){
 const record=validateBirthdayRecord(input,normalizePhone);
 const values=[record.name,record.phone,record.birth_date,record.invitation_consent];
 try{
  if(input.id!==undefined&&input.id!==null&&input.id!==''){
   const clientId=validateBirthdayId(input.id);
   const changed=await queryable.query(
    'UPDATE client_birthdays SET name=$1,phone=$2,birth_date=$3,invitation_consent=$4,updated_at=now() WHERE id=$5 RETURNING id,name,phone,birth_date::text,invitation_consent',
    [...values,clientId]);
   if(!changed.rowCount)throw bad('Запись не найдена.',404);
   return changed.rows[0];
  }
  const created=await queryable.query(
   'INSERT INTO client_birthdays(id,name,phone,birth_date,invitation_consent) VALUES($1,$2,$3,$4,$5) ON CONFLICT (phone) DO NOTHING RETURNING id,name,phone,birth_date::text,invitation_consent',
   [newId(),...values]);
  if(!created.rowCount)throw bad('Клиент с таким номером уже есть. Отредактируйте существующую запись.',409);
  return created.rows[0];
 }catch(error){
  if(error.code==='23505')throw bad('Такой номер телефона уже указан у другого клиента.',409);
  throw error;
 }
}
export async function deleteBirthdayRecord(queryable,id){
 const checked=validateBirthdayId(id);
 const result=await queryable.query('DELETE FROM client_birthdays WHERE id=$1 RETURNING id',[checked]);
 if(!result.rowCount)throw bad('Запись не найдена.',404);
 return result.rows[0];
}
