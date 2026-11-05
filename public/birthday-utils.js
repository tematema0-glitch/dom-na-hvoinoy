const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY=86400000;

export function isValidISODate(value){
 if(typeof value!=='string'||!ISO_DATE.test(value))return false;
 const stamp=Date.parse(value+'T00:00:00.000Z');
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;
}

export function ekaterinburgToday(now=new Date()){
 const date=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(date.getTime()))throw new RangeError('Invalid current date');
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(date);
 const part=type=>parts.find(p=>p.type===type)?.value;
 return part('year')+'-'+part('month')+'-'+part('day');
}

function birthdayInYear(birthDate,year){
 const month=birthDate.slice(5,7);
 const day=birthDate.slice(8,10);
 const proposed=String(year).padStart(4,'0')+'-'+month+'-'+day;
 // Feb 29 is celebrated on March 1 in non-leap years.
 return isValidISODate(proposed)?proposed:(month==='02'&&day==='29'?String(year).padStart(4,'0')+'-03-01':null);
}

export function upcomingBirthday(birthDate,today=ekaterinburgToday()){
 if(!isValidISODate(birthDate)||!isValidISODate(today))return null;
 const currentYear=Number(today.slice(0,4));
 const thisYear=birthdayInYear(birthDate,currentYear);
 const nextDate=thisYear>=today?thisYear:birthdayInYear(birthDate,currentYear+1);
 if(!nextDate)return null;
 const daysUntil=Math.round((Date.parse(nextDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/ONE_DAY);
 return {nextDate,daysUntil};
}

export function sortBirthdayClients(clients,today=ekaterinburgToday()){
 if(!Array.isArray(clients))return [];
 return clients.map(client=>({...client,...upcomingBirthday(client.birth_date,today)}))
  .sort((a,b)=>{
   const daysA=Number.isInteger(a.daysUntil)?a.daysUntil:Number.MAX_SAFE_INTEGER;
   const daysB=Number.isInteger(b.daysUntil)?b.daysUntil:Number.MAX_SAFE_INTEGER;
   return daysA-daysB||
    String(a.name||'').localeCompare(String(b.name||''),'ru')||
    String(a.phone||'').localeCompare(String(b.phone||''));
  });
}

export function birthdayHint(daysUntil){
 if(!Number.isInteger(daysUntil)||daysUntil<0)return '';
 if(daysUntil===0)return 'Сегодня';
 if(daysUntil===1)return 'Завтра';
 const last2=daysUntil%100;
 const last=daysUntil%10;
 const suffix=last2>=11&&last2<=14?'дней':last===1?'день':last>=2&&last<=4?'дня':'дней';
 return 'Через '+daysUntil+' '+suffix;
}
