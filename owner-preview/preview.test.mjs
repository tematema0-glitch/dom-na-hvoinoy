import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mountOwnerPreview } from './route.js';
const html=readFileSync(new URL('./dark-side.html',import.meta.url),'utf8');
const source=html.split('<script>')[1].split('</script>')[0];
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';this.dataset={};this.style={};this.disabled=false;this.listeners={};this.attrs={};this.classes=new Set();this.classList={add:c=>this.classes.add(c)};}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 setAttribute(k,v){this.attrs[k]=String(v)}
 addEventListener(name,fn){this.listeners[name]=fn}
 showModal(){this.open=true}
 close(){this.open=false}
 getTotalLength(){return 100}
 getPointAtLength(n){return{x:n,y:n/2}}
}
const date=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function boot(fail=false){const els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));els.guests.value='12';const requests=[];const document={getElementById:id=>els[id],createElement:tag=>new Element(tag),createElementNS:(ns,tag)=>new Element(tag),addEventListener(){},hidden:false};const location={hash:''};const now='2026-11-25';class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-25T10:00:00Z']))}static now(){return Date.parse('2026-11-25T10:00:00Z')}}const prices={weekday:20000,friday:25000,saturday:30000,dates:{'2026-11-27':42000}};const ranges=[{arrival:'2026-11-29',departure:'2026-11-30'}];const fetch=async(url,opts)=>{requests.push({url,opts});return{ok:!fail,status:fail?503:200,json:async()=>url.includes('pricing')?prices:{ranges}}};const context={document,location,Image:Element,Date:Clock,Intl,Math,fetch,matchMedia:()=>({matches:true,addEventListener(){}}),requestAnimationFrame:()=>1,cancelAnimationFrame(){},IntersectionObserver:class{constructor(cb){this.cb=cb}observe(){this.cb([{isIntersecting:true}])}}};context.window=context;vm.runInNewContext(source,context);await new Promise(r=>setImmediate(r));return{els,requests,location};}
function select(e,a,b,n=14){e.arrival.value=a;e.departure.value=b;e.guests.value=String(n);e.guests.listeners.input()}
function rub(s){return Number(s.replace(/\D/g,''))}
test('preview renders all scenarios, gallery and uses read-only APIs',async()=>{const{els:e,requests,location}=await boot();assert.equal(e.events.children.length,6);assert.equal(e.photos.children.length,6);e.more.listeners.click();assert.equal(e.photos.children.length,13);e.photos.children[0].listeners.click();assert.equal(e.light.open,true);e['forward-photo'].onclick();assert.match(e.caption.textContent,/2 \/ 13/);e['close-light'].onclick();assert.equal(e.light.open,false);e.events.children[0].children[1].children[2].listeners.click();assert.equal(location.hash,'booking');assert.equal(e.occasion.textContent,'День рождения');assert.ok(e.car.attrs.transform);assert.deepEqual(requests.map(x=>x.url),['/api/pricing','/api/availability']);assert.ok(requests.every(x=>!x.opts.method));});
test('special rate, weekend, extra guests, checkout and waitlist; no booking request',async()=>{const{els:e,requests}=await boot();select(e,'2026-11-27','2026-11-29');assert.equal(rub(e.total.textContent),76000);assert.match(e.notice.textContent,/свободны/);assert.equal(e['test-book'].disabled,false);e['test-book'].onclick();assert.match(e.notice.textContent,/НЕ отправлена/);assert.equal(requests.length,2);select(e,'2026-11-27','2026-11-30');assert.match(e.notice.textContent,/занятые ночи/);select(e,'2026-11-27','2026-11-27');assert.equal(e['test-book'].disabled,true);});
test('API failure never displays fake rates or enables test booking',async()=>{const{els:e}=await boot(true);select(e,'2026-11-27','2026-11-29');assert.equal(e.total.textContent,'—');assert.equal(e['test-book'].disabled,true);assert.match(e['pricing-status'].textContent,/недоступны/);});
test('private route denies unauthenticated requests and returns exact preview only to owner',async()=>{let handler;mountOwnerPreview({get:(path,h)=>{assert.equal(path,'/admin/dark-side');handler=h}},r=>r.owner===true);function res(){return{headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},type(t){this.contentType=t;return this},send(s){this.body=s;return this}}}const no=res();await handler({},no,e=>{throw e});assert.equal(no.statusCode,401);assert.ok(!no.body.includes('<!doctype'));assert.equal(no.headers['Cache-Control'],'private, no-store');const yes=res();await handler({owner:true},yes,e=>{throw e});assert.equal(yes.body,html);assert.match(yes.headers['Content-Security-Policy'],/form-action 'none'/);});
