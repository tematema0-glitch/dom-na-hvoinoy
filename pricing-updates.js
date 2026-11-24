import { dateRangeInclusive, checkedNightlyPrice, changeDatePrices } from './public/date-price-range.js';

import { isConfiguredPricing } from './public/pricing-state.js';

const EMPTY_PRICING = Object.freeze({ dates:{} });
function error(message) { return Object.assign(new Error(message), { status:400 }); }
function acceptableBasePrice(value) { if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()))return false; const price = Number(value); return Number.isFinite(price) && price >= 0 && price <= 1_000_000; }

// All pricing edits serialize on the same settings row so a bulk change cannot
// overwrite another owner's single-date or weekday update from a second session.
export async function handlePricingAction(pool, input) {
  const x = input || {};
  let transform;
  if (x.action === 'setPrices') {
    const weekday = Number(x.weekday), friday = Number(x.friday), saturday = Number(x.saturday);
    if (![x.weekday, x.friday, x.saturday].every(acceptableBasePrice)) throw error('Invalid base prices');
    transform = current => ({...current,weekday,friday,saturday,dates:current?.dates??{}});
  } else if (x.action === 'setDatePrice') {
    let dates;
    try { dates = dateRangeInclusive(x.date,x.date); } catch { throw error('Invalid calendar date'); }
    if (!acceptableBasePrice(x.price)) throw error('Invalid nightly price');
    const price = Number(x.price);
    transform = current => changeDatePrices(current,dates,price);
  } else if (x.action === 'removeDatePrice') {
    let dates;
    try { dates = dateRangeInclusive(x.date,x.date); } catch { throw error('Invalid calendar date'); }
    transform = current => changeDatePrices(current,dates);
  } else if (x.action === 'setDatePricesRange' || x.action === 'removeDatePricesRange') {
    let dates;
    try { dates = dateRangeInclusive(x.from,x.to); } catch { throw error('Invalid range (maximum 366 nights)'); }
    if (x.action === 'setDatePricesRange') {
      let price;
      try { price = checkedNightlyPrice(x.price); } catch { throw error('Invalid nightly price'); }
      transform = current => changeDatePrices(current,dates,price);
    } else {
      transform = current => changeDatePrices(current,dates);
    }
  } else {
    throw error('Unknown pricing action');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO settings(key,value) VALUES('pricing',$1) ON CONFLICT(key) DO NOTHING",[EMPTY_PRICING]);
    const stored = await client.query("SELECT value FROM settings WHERE key='pricing' FOR UPDATE");
    const current = stored.rows[0]?.value || EMPTY_PRICING;
    if(x.action!=='setPrices'&&!isConfiguredPricing(current))throw error('Сначала установите обычные цены');
    const next = transform(current);
    if(!isConfiguredPricing(next))throw error('Некорректные тарифы');
    await client.query("UPDATE settings SET value=$1,updated_at=now() WHERE key='pricing'",[next]);
    await client.query('COMMIT');
    return { ok:true };
  } catch (cause) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw cause;
  } finally {
    client.release();
  }
}
