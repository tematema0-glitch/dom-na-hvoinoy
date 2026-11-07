import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// IndexNow verification key is intentionally public. Yandex checks the
// matching file at /<key>.txt before accepting site update notifications.
export const INDEXNOW_KEY='004c4a640a4b239ba734535385fd8200291009824ad8485e';
export const INDEXNOW_HOME='https://xn----9sbekpc0bfogg5c.xn--p1ai/';
const LAST_REVISION_SETTING='seo:indexnow:last-notified-fingerprint';

/** Notify Yandex only when actual HTML/sitemap contents changed.
 * Never sends guest, booking, or calendar data. Google does not support
 * IndexNow for ordinary pages: it discovers the public sitemap instead.
 */
export async function notifyYandexOnSeoChange(pool,publicDir,{fetchImpl=fetch,readFileImpl=readFile}={}){
  if(!pool) return {skipped:true,reason:'no_database'};
  const [home,sitemap]=await Promise.all([
    readFileImpl(path.join(publicDir,'index.html')),
    readFileImpl(path.join(publicDir,'sitemap.xml'))
  ]);
  const fingerprint=crypto.createHash('sha256').update(home).update(sitemap).digest('hex');
  const previous=await pool.query('SELECT value FROM settings WHERE key=$1',[LAST_REVISION_SETTING]);
  if(previous.rows[0]?.value===fingerprint)return {skipped:true,reason:'unchanged'};
  const url=new URL('https://yandex.com/indexnow');
  url.searchParams.set('url',INDEXNOW_HOME);
  url.searchParams.set('key',INDEXNOW_KEY);
  const response=await fetchImpl(url,{method:'GET',signal:AbortSignal.timeout(12000)});
  if(response.status!==200&&response.status!==202){
    throw new Error('Yandex IndexNow returned HTTP '+response.status);
  }
  // 202 means key verification is pending; retry on the next check.
  if(response.status===202)return {pendingVerification:true,status:202};
  // Cache confirmed submissions so we don't repeatedly notify search engines.
  await pool.query('INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
    [LAST_REVISION_SETTING,JSON.stringify(fingerprint)]);
  return {accepted:true,status:200};
}
