// Shared contract for the public snowfall overlay and the owner-only editor.
// Off by default: deploying these files cannot turn snow on for visitors.
export const DEFAULT_SNOWFALL_SETTINGS = Object.freeze({
  enabled: false,
  size: 3,
  speed: 1.0,
  count: 70,
  shape: 'mixed',
  tilt: true,
  interaction: true
});

export const SNOWFLAKE_SHAPES = Object.freeze(['mixed', 'soft', 'crystal', 'star']);

export function normalizeSnowfallSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Некорректные настройки снега.');
  }
  const defaults = DEFAULT_SNOWFALL_SETTINGS;
  const fields = Object.keys(defaults);
  if (Object.keys(input).some(key => !fields.includes(key)) ||
      fields.some(key => !Object.hasOwn(input, key))) {
    throw new TypeError('Неполный или неизвестный набор настроек снега.');
  }
  if (typeof input.enabled !== 'boolean' ||
      typeof input.tilt !== 'boolean' ||
      typeof input.interaction !== 'boolean') {
    throw new TypeError('Переключатели снега должны быть логическими.');
  }
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > 6) {
    throw new RangeError('Размер снежинок должен быть от 1 до 6.');
  }
  if (typeof input.speed !== 'number' ||
      !Number.isFinite(input.speed) || input.speed < 0.4 || input.speed > 2.4 ||
      Math.abs(input.speed * 10 - Math.round(input.speed * 10)) > 1e-8) {
    throw new RangeError('Скорость снежинок должна быть от 0.4 до 2.4.');
  }
  if (!Number.isInteger(input.count) || input.count < 20 || input.count > 160) {
    throw new RangeError('Количество снежинок должно быть от 20 до 160.');
  }
  if (!SNOWFLAKE_SHAPES.includes(input.shape)) {
    throw new RangeError('Неизвестная форма снежинок.');
  }
  return {
    enabled: input.enabled,
    size: input.size,
    speed: Math.round(input.speed * 10) / 10,
    count: input.count,
    shape: input.shape,
    tilt: input.tilt,
    interaction: input.interaction
  };
}
