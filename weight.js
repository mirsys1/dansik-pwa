(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingWeight = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MIN_KG = 25;
  const MAX_KG = 300;
  const MAX_MEASUREMENTS = 36600;

  function validDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2000-01-01' || date > '2100-01-01') return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  function requireDate(date, today) {
    if (!validDate(date) || (today !== undefined && (!validDate(today) || date > today))) {
      throw new TypeError('체중 기록 날짜를 확인해 주세요.');
    }
  }

  function validateWeight(weightKg) {
    if (!Number.isFinite(weightKg) || weightKg < MIN_KG || weightKg > MAX_KG || Math.round(weightKg * 10) / 10 !== weightKg) {
      throw new TypeError('체중은 25~300 kg 사이에서 소수 첫째 자리까지 입력해 주세요.');
    }
    return weightKg;
  }

  function normalizeMeasurements(input) {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > MAX_MEASUREMENTS) throw new TypeError('체중 기록 목록이 올바르지 않습니다.');
    const dates = new Set();
    return input.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('체중 기록이 올바르지 않습니다.');
      const { date, weightKg } = item;
      requireDate(date);
      if (dates.has(date)) throw new TypeError('같은 날짜의 체중 기록이 두 개 이상 있습니다.');
      dates.add(date);
      return { date, weightKg: validateWeight(weightKg) };
    }).sort((left, right) => left.date < right.date ? 1 : left.date > right.date ? -1 : 0);
  }

  function checkExpected(current, expectedWeightKg) {
    if (expectedWeightKg !== undefined && (current?.weightKg ?? null) !== expectedWeightKg) {
      throw new TypeError('체중 기록이 변경됐어요. 날짜 화면을 다시 열어 확인해 주세요.');
    }
  }

  function record(measurements, date, weightKg, today, expectedWeightKg) {
    requireDate(date, today);
    validateWeight(weightKg);
    const records = normalizeMeasurements(measurements);
    checkExpected(records.find(item => item.date === date), expectedWeightKg);
    return normalizeMeasurements([...records.filter(item => item.date !== date), { date, weightKg }]);
  }

  function remove(measurements, date, today, expectedWeightKg) {
    requireDate(date, today);
    const records = normalizeMeasurements(measurements);
    checkExpected(records.find(item => item.date === date), expectedWeightKg);
    return records.filter(item => item.date !== date);
  }

  function merge(current, incoming) {
    const existing = normalizeMeasurements(current);
    const dates = new Set(existing.map(item => item.date));
    const additions = normalizeMeasurements(incoming).filter(item => !dates.has(item.date));
    return normalizeMeasurements([...existing, ...additions]);
  }

  // Validated state is sorted newest first, so the first earlier entry is the comparison.
  function compare(measurements, date) {
    const records = measurements || [];
    const current = records.find(item => item.date === date) || null;
    const previous = current ? records.find(item => item.date < date) || null : null;
    const changeKg = previous ? (Math.round(current.weightKg * 10) - Math.round(previous.weightKg * 10)) / 10 : null;
    return { current, previous, changeKg };
  }

  return { MIN_KG, MAX_KG, MAX_MEASUREMENTS, validDate, normalizeMeasurements, record, remove, merge, compare };
});
