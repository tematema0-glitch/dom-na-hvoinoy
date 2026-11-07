import test from 'node:test';
import assert from 'node:assert/strict';
import {INDEXNOW_KEY,INDEXNOW_HOME,notifyYandexOnSeoChange} from '../indexnow-seo.js';

function mock(){
 const state={fingerprint:null,fetches:[],reads:[],saves:0};
 const settings={status:200,sitemap:'sitemap content'};
 const pool={async query(sql,params=[]){
  if(sql.startsWith('SELECT value FROM settings')){
   return {rows:state.fingerprint?[{value:state.fingerprint}]:[]};
  }
  if(sql.startsWith('INSERT INTO settings')){
   state.fingerprint=JSON.parse(params[1]);
   state.saves++;
   return {rows:[]};
  }
  throw Error('Unexpected query: '+sql);
 }};
 const readFileImpl=async file=>{state.reads.push(file);return Buffer.from(file.endsWith('index.html')?'home content':settings.sitemap);};
 const fetchImpl=async url=>{state.fetches.push(String(url));return {status:settings.status};};
 return {state,pool,readFileImpl,fetchImpl,mock:settings};
}
test('IndexNow key and URL refer to the real domain',()=>{
 assert.match(INDEXNOW_KEY,/^[a-zA-Z0-9-]{8,128}$/);
 assert.equal(new URL(INDEXNOW_HOME).hostname,'xn----9sbekpc0bfogg5c.xn--p1ai');
});
test('IndexNow sends only the canonical home page and skips unchanged content',async()=>{
 const {state,pool,readFileImpl,fetchImpl}=mock();
 const first=await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 assert.deepEqual(first,{accepted:true,status:200});
 assert.equal(state.saves,1);
 assert.equal(state.fetches.length,1);
 const target=new URL(state.fetches[0]);
 assert.equal(target.host,'yandex.com');
 assert.equal(target.searchParams.get('url'),INDEXNOW_HOME);
 assert.equal(target.searchParams.get('key'),INDEXNOW_KEY);
 const next=await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 assert.deepEqual(next,{skipped:true,reason:'unchanged'});
 assert.equal(state.fetches.length,1);
});
test('IndexNow 202 retains pending state to retry verification',async()=>{
 const {state,pool,readFileImpl,fetchImpl,mock:settings}=mock();
 settings.status=202;
 const first=await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 assert.deepEqual(first,{pendingVerification:true,status:202});
 assert.equal(state.saves,0);
 await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 assert.equal(state.fetches.length,2);
 settings.status=200;
 await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 assert.equal(state.saves,1);
});
test('changed sitemap triggers an updated IndexNow submission',async()=>{
 const {state,pool,readFileImpl,fetchImpl,mock:settings}=mock();
 await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 settings.sitemap='sitemap content v2';
 await notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl});
 assert.equal(state.fetches.length,2);
 assert.equal(state.saves,2);
});
test('IndexNow failures do not affect site state or record successful indexing',async()=>{
 const {state,pool,readFileImpl,fetchImpl,mock:settings}=mock();
 settings.status=403;
 await assert.rejects(notifyYandexOnSeoChange(pool,'/site/public',{fetchImpl,readFileImpl}),/HTTP 403/);
 assert.equal(state.saves,0);
});
