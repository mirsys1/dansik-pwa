(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingActivity = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // This module deliberately accepts only *active* energy samples. Basal energy
  // belongs to the fasting calculation and must never be mixed into these values.
  const MIN_TIME = Date.UTC(2000, 0, 1);
  const MAX_TIME = Date.UTC(2100, 0, 1);
  const MAX_SAMPLES = 50000;
  const MAX_KCAL = 100000;
  const MAX_STEPS = 100000000;
  const MAX_TRANSFER_CHARS = 20 * 1024 * 1024;
  const DEFAULT_PROFILE = Object.freeze({ sex: 'male', age: 35, heightCm: 170, weightKg: 68, activityLevel: 'light' });

  function assert(condition, message) { if (!condition) throw new TypeError(message); }
  function validText(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 160; }
  function validTime(value) { return Number.isSafeInteger(value) && value >= MIN_TIME && value <= MAX_TIME; }
  function keyOf(sample) { return sample.source + '\u0000' + sample.id; }
  function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
  function compareSample(left, right) {
    return left.start - right.start || left.end - right.end || compareText(left.source, right.source) || compareText(left.id, right.id);
  }
  function roundKcal(value) { return Math.round((value + Number.EPSILON) * 10) / 10; }

  function normalizeSample(raw) {
    assert(raw && typeof raw === 'object' && !Array.isArray(raw), '활동 기록 형식이 올바르지 않습니다.');
    assert(validText(raw.id), '활동 기록 ID가 올바르지 않습니다.');
    assert(validText(raw.source), '활동 기록 출처가 올바르지 않습니다.');
    assert(validTime(raw.start) && validTime(raw.end) && raw.end > raw.start, '활동 기록 시간 범위가 올바르지 않습니다.');
    assert(typeof raw.kcal === 'number' && Number.isFinite(raw.kcal) && raw.kcal >= 0 && raw.kcal <= MAX_KCAL, '활동 칼로리는 0~100000 사이여야 합니다.');
    if (raw.steps !== undefined) assert(Number.isSafeInteger(raw.steps) && raw.steps >= 0 && raw.steps <= MAX_STEPS, '걸음 수가 올바르지 않습니다.');
    const normalized = { id: raw.id, source: raw.source, start: raw.start, end: raw.end, kcal: raw.kcal };
    if (raw.steps !== undefined) normalized.steps = raw.steps;
    return normalized;
  }

  function normalizeSamples(samples) {
    assert(Array.isArray(samples) && samples.length <= MAX_SAMPLES, '활동 기록 개수는 50000개 이하여야 합니다.');
    const keys = new Set();
    const normalized = samples.map(function (sample) {
      const value = normalizeSample(sample);
      assert(!keys.has(keyOf(value)), '같은 출처의 활동 기록 ID가 중복되었습니다.');
      keys.add(keyOf(value));
      return value;
    });
    return normalized.sort(compareSample);
  }

  // Later input replaces the same source/id, making repeated imports idempotent.
  function mergeSamples(existing, incoming) {
    assert(Array.isArray(existing) && existing.length <= MAX_SAMPLES, '기존 활동 기록 개수는 50000개 이하여야 합니다.');
    assert(Array.isArray(incoming) && incoming.length <= MAX_SAMPLES, '새 활동 기록 개수는 50000개 이하여야 합니다.');
    const merged = new Map();
    normalizeSamples(existing).forEach(function (sample) { merged.set(keyOf(sample), sample); });
    incoming.forEach(function (raw) {
      const sample = normalizeSample(raw);
      merged.set(keyOf(sample), sample);
    });
    assert(merged.size <= MAX_SAMPLES, '병합 후 활동 기록 개수는 50000개 이하여야 합니다.');
    return Array.from(merged.values()).sort(compareSample);
  }

  function addRecordedSamples(existing, incoming, now, manual = false) {
    const samples = normalizeSamples(incoming);
    assert(samples.length > 0, '활동 에너지 기록이 없어요.');
    assert(samples.every(sample => sample.end <= now), '미래의 활동은 기록할 수 없어요.');
    if (manual) {
      assert(samples.length === 1 && samples[0].source === 'manual', '운동 기록 형식이 올바르지 않습니다.');
      const candidate = samples[0];
      const overlaps = existing.some(sample => sample.source === 'manual' && sample.id !== candidate.id &&
        sample.start < candidate.end && sample.end > candidate.start);
      assert(!overlaps, '이미 기록한 운동 시간과 겹쳐요. 종료 시각이나 운동 시간을 확인해 주세요.');
    }
    return mergeSamples(existing, samples);
  }

  function parseIsoTime(value) {
    assert(typeof value === 'string', '단축어 활동 시각은 시간대가 있는 ISO 8601 문자열이어야 합니다.');
    // Do not accept local-time strings: imports must mean the same instant on
    // every device. Calendar validation prevents Date.parse normalising 2/30.
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    assert(match, '단축어 활동 시각은 시간대가 있는 ISO 8601 문자열이어야 합니다.');
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const hour = Number(match[4]); const minute = Number(match[5]); const second = match[6] === undefined ? 0 : Number(match[6]);
    const millis = match[7] === undefined ? 0 : Number((match[7] + '000').slice(0, 3));
    const timezone = match[8];
    assert(hour <= 23 && minute <= 59 && second <= 59, '단축어 활동 시각이 올바르지 않습니다.');
    if (timezone !== 'Z') {
      const parts = timezone.slice(1).split(':');
      assert(Number(parts[0]) <= 23 && Number(parts[1]) <= 59, '단축어 활동 시각의 시간대가 올바르지 않습니다.');
    }
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
    assert(calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day, '단축어 활동 시각이 올바르지 않습니다.');
    const parsed = Date.parse(value);
    assert(Number.isSafeInteger(parsed) && validTime(parsed), '단축어 활동 시각이 올바르지 않습니다.');
    return parsed;
  }

  function parseTransferTime(value) {
    if (typeof value === 'number') {
      assert(validTime(value), '단축어 활동 시각이 올바르지 않습니다.');
      return value;
    }
    return parseIsoTime(value);
  }

  function convertToKcal(value, unit) {
    assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, '단축어 활동 에너지 값이 올바르지 않습니다.');
    if (unit === 'kcal') return value;
    if (unit === 'kJ') return value / 4.184;
    if (unit === 'J') return value / 4184;
    if (unit === 'cal') return value / 1000;
    throw new TypeError('지원하지 않는 활동 에너지 단위입니다.');
  }

  function assertNotFuture(samples, now) {
    assert(Number.isSafeInteger(now) && validTime(now), '현재 시각이 올바르지 않습니다.');
    samples.forEach(function (sample) { assert(sample.end <= now, '미래 시각의 활동 기록은 가져올 수 없습니다.'); });
    return samples;
  }

  // Parses clipboard/export text only. It returns normalized samples; callers
  // merge them through mergeSamples so repeating the same transfer is idempotent.
  function parseTransfer(text, now) {
    assert(typeof text === 'string' && text.length <= MAX_TRANSFER_CHARS, '활동 가져오기 텍스트는 20MB 이하여야 합니다.');
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new TypeError('활동 가져오기 JSON 형식이 올바르지 않습니다.'); }
    const checkedNow = now === undefined ? Date.now() : now;
    if (Array.isArray(parsed)) return assertNotFuture(normalizeSamples(parsed), checkedNow);
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), '지원하지 않는 활동 가져오기 형식입니다.');
    if (parsed.version === 1 && Array.isArray(parsed.samples) && parsed.format === undefined) return assertNotFuture(normalizeSamples(parsed.samples), checkedNow);
    assert(parsed.format === 'dansik-shortcuts-v1' && Array.isArray(parsed.samples), '지원하지 않는 활동 가져오기 형식입니다.');
    assert(parsed.samples.length <= MAX_SAMPLES, '활동 기록 개수는 50000개 이하여야 합니다.');
    const samples = parsed.samples.map(function (raw) {
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), '단축어 활동 기록 형식이 올바르지 않습니다.');
      assert(raw.type === 'active-energy', '단축어에서는 활성 에너지 기록만 가져올 수 있습니다.');
      assert(typeof raw.source === 'string' && raw.source.trim().length > 0 && raw.source.length <= 100, '단축어 활동 기록 출처가 올바르지 않습니다.');
      assert(typeof raw.id === 'string' && raw.id.length >= 1 && raw.id.length <= 160, '단축어 활동 기록 ID가 올바르지 않습니다.');
      const normalized = {
        id: raw.id,
        source: 'apple-shortcuts:' + raw.source,
        start: parseTransferTime(raw.start),
        end: parseTransferTime(raw.end),
        kcal: convertToKcal(raw.value, raw.unit),
      };
      if (raw.steps !== undefined) normalized.steps = raw.steps;
      return normalized;
    });
    return assertNotFuture(normalizeSamples(samples), checkedNow);
  }

  function validateRange(from, to) {
    assert(validTime(from) && validTime(to) && to > from, '계산 시간 범위가 올바르지 않습니다.');
  }

  // Kept in sync with the core profile bounds, but activityLevel intentionally
  // does not affect this mode: measured activity replaces the multiplier.
  function normalizeProfile(profile) {
    const value = profile && typeof profile === 'object' ? profile : {};
    const number = function (input) { return Number(input); };
    const age = number(value.age);
    const heightCm = number(value.heightCm);
    const weightKg = number(value.weightKg);
    return {
      sex: value.sex === 'female' ? 'female' : 'male',
      age: Number.isFinite(age) && age >= 10 && age <= 120 ? Math.round(age) : DEFAULT_PROFILE.age,
      heightCm: Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 250 ? Math.round(heightCm * 10) / 10 : DEFAULT_PROFILE.heightCm,
      weightKg: Number.isFinite(weightKg) && weightKg >= 25 && weightKg <= 300 ? Math.round(weightKg * 10) / 10 : DEFAULT_PROFILE.weightKg,
      activityLevel: typeof value.activityLevel === 'string' ? value.activityLevel : DEFAULT_PROFILE.activityLevel,
    };
  }

  // An ambiguous overlap is rejected as zero activity rather than double-counted.
  // Samples touching at one endpoint do not overlap.
  function calculate(samples, from, to, source) {
    validateRange(from, to);
    assert(validText(source), '계산할 활동 기록 출처를 하나 선택해야 합니다.');
    const selected = normalizeSamples(samples).filter(function (sample) { return sample.source === source; });
    const included = [];
    let excludedBoundary = 0;
    selected.forEach(function (sample) {
      if (sample.start >= from && sample.end <= to) included.push(sample);
      // Only a sample that actually crosses this interval's boundary is useful
      // warning information. A wholly earlier/later record is not a boundary
      // exclusion for this calculation.
      else if (sample.start < to && sample.end > from) excludedBoundary += 1;
    });
    for (let index = 1; index < included.length; index += 1) {
      if (included[index].start < included[index - 1].end) {
        return { activeKcal: 0, sampleCount: 0, excludedBoundary: excludedBoundary, overlapDetected: true, steps: null, stepSampleCount: 0 };
      }
    }
    let activeKcal = 0;
    let steps = 0;
    let stepSampleCount = 0;
    included.forEach(function (sample) {
      activeKcal += sample.kcal;
      if (sample.steps !== undefined) { steps += sample.steps; stepSampleCount += 1; }
    });
    return {
      activeKcal: roundKcal(activeKcal),
      sampleCount: included.length,
      excludedBoundary: excludedBoundary,
      overlapDetected: false,
      steps: stepSampleCount ? steps : null,
      stepSampleCount: stepSampleCount,
    };
  }

  // Activity mode: BMR for the exact fasting duration plus one selected source's
  // measured active energy. There is deliberately no activity multiplier or
  // fasting-stage rate bonus, which would count the same movement twice.
  function estimate(samples, from, to, source, profile, elapsedMs) {
    const duration = elapsedMs === undefined ? to - from : elapsedMs;
    assert(validTime(from) && validTime(to) && to >= from, '계산 시간 범위가 올바르지 않습니다.');
    assert(Number.isFinite(duration) && duration >= 0, '경과 시간은 0 이상의 유한한 값이어야 합니다.');
    const normalizedProfile = normalizeProfile(profile);
    const bmr = Math.max(800, 10 * normalizedProfile.weightKg + 6.25 * normalizedProfile.heightCm - 5 * normalizedProfile.age + (normalizedProfile.sex === 'female' ? -161 : 5));
    const basalKcal = roundKcal(bmr * duration / 86400000);
    const noActivity = { activeKcal: 0, sampleCount: 0, excludedBoundary: 0, overlapDetected: false, steps: null, stepSampleCount: 0 };
    // An initial setting can enable activity mode before a source is selected,
    // and a just-recorded meal has a zero-length interval. Neither is an error.
    if (!validText(source) || duration === 0 || from === to) {
      return { totalKcal: basalKcal, basalKcal: basalKcal, activeKcal: null, calculationStatus: 'missing-activity-data', activity: noActivity };
    }
    const activity = calculate(samples, from, to, source);
    if (activity.overlapDetected) {
      return { totalKcal: basalKcal, basalKcal: basalKcal, activeKcal: null, calculationStatus: 'overlap-detected', activity: activity };
    }
    if (activity.sampleCount === 0) {
      return { totalKcal: basalKcal, basalKcal: basalKcal, activeKcal: null, calculationStatus: 'missing-activity-data', activity: activity };
    }
    return { totalKcal: roundKcal(basalKcal + activity.activeKcal), basalKcal: basalKcal, activeKcal: activity.activeKcal, calculationStatus: 'measured-activity', activity: activity };
  }

  return { MIN_TIME: MIN_TIME, MAX_TIME: MAX_TIME, MAX_SAMPLES: MAX_SAMPLES, MAX_TRANSFER_CHARS: MAX_TRANSFER_CHARS, DEFAULT_PROFILE: DEFAULT_PROFILE, normalizeSample: normalizeSample, normalizeSamples: normalizeSamples, mergeSamples: mergeSamples, addRecordedSamples: addRecordedSamples, parseTransfer: parseTransfer, normalizeProfile: normalizeProfile, calculate: calculate, estimate: estimate };
});
