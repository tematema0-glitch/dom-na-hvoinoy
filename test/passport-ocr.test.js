import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPassportIdentity, normalizePassportLines } from '../public/passport-ocr.js';

const today='2026-11-05';
test('read labeled Cyrillic passport fields on separate lines',()=>{
 const scan=[
  'РОССИЙСКАЯ ФЕДЕРАЦИЯ','ФАМИЛИЯ','ИВАНОВ','ИМЯ','ИВАН','ОТЧЕСТВО','ИВАНОВИЧ',
  'ПОЛ МУЖСКОЙ','ДАТА РОЖДЕНИЯ','15.03.1995','МЕСТО РОЖДЕНИЯ','Г. ЕКАТЕРИНБУРГ',
  'ПАСПОРТ 65 12 123456','ВЫДАН 06.10.2015'
 ].join('\n');
 const result=extractPassportIdentity(scan,today);
 assert.equal(result.fullName,'Иванов Иван Иванович');
 assert.equal(result.birthDate,'1995-03-15');
 assert.deepEqual(result.warnings,[]);
 assert.deepEqual(Object.keys(result),['fullName','birthDate','warnings']);
 assert.doesNotMatch(JSON.stringify(result),/123456|ВЫДАН|ЕКАТЕРИНБУРГ/);
});
test('read passport fields on the same line in mixed case',()=>{
 const scan='Фамилия: ПЕТРОВА\nИмя: АННА\nОтчество: СЕРГЕЕВНА\nДата рождения: 04.10.2000';
 const result=extractPassportIdentity(scan,today);
 assert.equal(result.fullName,'Петрова Анна Сергеевна');
 assert.equal(result.birthDate,'2000-10-04');
});
test('missing birth date must never be guessed from the issue date',()=>{
 const scan='Дата выдачи 01.03.2020\nФамилия СИДОРОВ\nИмя ВЛАДИМИР\nОтчество ОЛЕГОВИЧ\nМесто рождения МОСКВА';
 const result=extractPassportIdentity(scan,today);
 assert.equal(result.fullName,'Сидоров Владимир Олегович');
 assert.equal(result.birthDate,null);
 assert.ok(result.warnings.some(item=>item.includes('Дата рождения')));
});
test('reading the label Место рождения does not treat adjacent issue date as DOB',()=>{
 const scan='Фамилия ИВАНОВ\nИмя ИВАН\nОтчество ИВАНОВИЧ\nМесто рождения ГОРОД\nВыдан 12.04.2020';
 assert.equal(extractPassportIdentity(scan,today).birthDate,null);
});
test('invalid dates are not inserted into the client form',()=>{
 const scan='Фамилия ИВАНОВ\nИмя ИВАН\nОтчество ИВАНОВИЧ\nДата рождения 31.02.2000';
 assert.equal(extractPassportIdentity(scan,today).birthDate,null);
 assert.equal(extractPassportIdentity('Дата рождения 13.06.2031',today).birthDate,null);
});
test('uncertain identity stays empty instead of inventing names',()=>{
 const result=extractPassportIdentity('РОССИЙСКАЯ ФЕДЕРАЦИЯ\nПОЛ МУЖСКОЙ\nДата рождения 01.09.1998',today);
 assert.equal(result.fullName,'');
 assert.equal(result.birthDate,'1998-09-01');
 assert.ok(result.warnings.length>0);
});
test('unicode normalization retains line boundaries and drops empty lines',()=>{
 assert.deepEqual(normalizePassportLines('  \n ФАМИЛИЯ   \n\n ИВАНОВ \r\n '),['ФАМИЛИЯ','ИВАНОВ']);
});
