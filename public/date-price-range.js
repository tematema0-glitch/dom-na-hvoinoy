const DAY_MS = 86_400_000;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_PRICE_RANGE_DAYS = 366;

function utcDay(value) {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) throw new RangeError('Invalid calendar date');
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new RangeError('Invalid calendar date');
  }
  return timestamp;
}

// Both endpoints are included: selecting Monday through Sunday updates seven nightly rates.
export function dateRangeInclusive(from, to, maxDays = MAX_PRICE_RANGE_DAYS) {
  const start = utcDay(from);
  const end = utcDay(to);
  const count = (end - start) / DAY_MS + 1;
  if (!Number.isInteger(count) || count < 1 || count > maxDays) {
    throw new RangeError(`Choose 1 to ${maxDays} consecutive dates`);
  }
  return Array.from({ length: count }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
}

export function checkedNightlyPrice(input) {
  if (typeof input !== 'number' && (typeof input !== 'string' || !/^\d+$/.test(input.trim()))) {
    throw new RangeError('Price must be a whole number in rubles');
  }
  const price = Number(input);
  if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000) {
    throw new RangeError('Price must be between 1 and 1000000 rubles');
  }
  return price;
}

export function changeDatePrices(previous, dates, price = null) {
  const updated = { ...previous, dates: { ...(previous?.dates || {}) } };
  for (const date of dates) {
    if (price === null) delete updated.dates[date];
    else updated.dates[date] = price;
  }
  return updated;
}
