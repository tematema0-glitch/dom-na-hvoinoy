import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function getFreePort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const address=server.address();
   server.close(error=>error?reject(error):resolve(address.port));
  });
 });
}

test('static assets remain correctly served on repeated visits',async t=>{
 const port=await getFreePort();
 const child=spawn(process.execPath,['server.js'],{
  cwd:root,
  env:{...process.env,DATABASE_URL:'',PORT:String(port),NODE_ENV:'test'},
  stdio:'ignore'
 });
 t.after(()=>{if(child.exitCode===null)child.kill();});
 const base=`http://127.0.0.1:${port}`;
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){
  if(child.exitCode!==null)throw new Error('Test server exited early');
  try{const res=await fetch(base+'/');if(res.ok){ready=true;break;}}catch{}
  await delay(100);
 }
 assert.equal(ready,true,'Test server did not start');

 for(let attempt=0;attempt<8;attempt++){
  const css=await fetch(base+'/_next/static/css/index.Lc-UNUed.css');
  assert.equal(css.status,200);
  assert.match(css.headers.get('content-type')||'',/^text\/css/);
  assert.match(css.headers.get('cache-control')||'',/immutable/);
  assert.ok((await css.text()).length>1000);
  const image=await fetch(base+'/exterior.jpeg');
  assert.equal(image.status,200);
  assert.match(image.headers.get('content-type')||'',/^image\/jpeg/);
  assert.ok((await image.arrayBuffer()).byteLength>1000);
 }
 const js=await fetch(base+'/_next/static/chunks/index-CzOB0V2F.js');
 assert.equal(js.status,200);
 assert.match(js.headers.get('content-type')||'',/javascript/);
 for(const url of ['/_next/static/css/not-found.css','/cdn-cgi/challenge-platform/scripts/jsd/main.js','/missing-photo.webp']){
  const res=await fetch(base+url);
  assert.equal(res.status,404,url);
  assert.doesNotMatch(res.headers.get('content-type')||'',/text\/html/,url);
 }
 const page=await fetch(base+'/');
 assert.equal(page.status,200);
 assert.match(page.headers.get('cache-control')||'',/no-store/);
 const body=await page.text();
 assert.match(body,/114076900/);
 assert.doesNotMatch(body,/\/cdn-cgi\/challenge-platform\//);
 const spa=await fetch(base+'/friends');
 assert.equal(spa.status,200);
 assert.match(spa.headers.get('content-type')||'',/text\/html/);
});
