(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TYPES = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack']);
  const MIN_DATE = Date.UTC(2000, 0, 1);
  // Practical upper ceiling keeps Date/Intl rendering and a 24-hour goal safe.
  const MAX_DATE = Date.UTC(2100, 0, 1);
  const MAX_EVENTS = 100000;
  const MAX_FOODS_PER_MEAL = 24;
  const MAX_BACKUP_CHARS = 64 * 1024 * 1024;
  const HOUR = 60 * 60 * 1000;
  const INVALID_FOOD_MESSAGE = '음식 이름, 양과 칼로리를 확인해 주세요.';

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function assert(condition, message) { if (!condition) throw new TypeError(message); }
  function defaultState() {
    return { version: 1, events: [], settings: { goalHours: 12, goalEnabled: false, notifications: false, theme: 'light', themeAuto: true }, notifiedKey: null };
  }
  function validTimestamp(at, now) {
    return Number.isSafeInteger(at) && at >= MIN_DATE && at <= MAX_DATE && at <= now;
  }
  function normalizeFoods(foods) {
    if (foods === undefined) return [];
    assert(Array.isArray(foods) && foods.length <= MAX_FOODS_PER_MEAL, INVALID_FOOD_MESSAGE);
    return Array.from(foods, (food) => {
      assert(food && typeof food === 'object' && !Array.isArray(food), INVALID_FOOD_MESSAGE);
      assert(typeof food.name === 'string', INVALID_FOOD_MESSAGE);
      const name = food.name.trim();
      assert(name.length >= 1 && name.length <= 100, INVALID_FOOD_MESSAGE);
      assert(Number.isFinite(food.kcal) && food.kcal >= 0 && food.kcal <= 20000, INVALID_FOOD_MESSAGE);
      const normalized = { name, kcal: food.kcal };
      if (food.grams !== undefined) {
        assert(Number.isFinite(food.grams) && food.grams > 0 && food.grams <= 10000, INVALID_FOOD_MESSAGE);
        normalized.grams = food.grams;
      }
      return normalized;
    });
  }
  function foodKcalTotal(foods) { return normalizeFoods(foods).reduce((total, food) => total + food.kcal, 0); }
  function validateEvent(event, now) {
    assert(event && typeof event === 'object', '식사 기록 형식이 올바르지 않습니다.');
    assert(typeof event.id === 'string' && event.id.length >= 1 && event.id.length <= 160, '식사 기록 ID가 올바르지 않습니다.');
    assert(TYPES.includes(event.type), '식사 종류가 올바르지 않습니다.');
    assert(validTimestamp(event.at, now), '식사 시각은 2000년 이후이고 현재 시각보다 미래가 아니어야 합니다.');
    assert(typeof event.note === 'string' && event.note.length <= 200, '메모는 200자 이하여야 합니다.');
    const foods = normalizeFoods(event.foods);
    return foods.length ? { id: event.id, type: event.type, at: event.at, note: event.note, foods } : { id: event.id, type: event.type, at: event.at, note: event.note };
  }
  function validateState(raw, now) {
    const checkedNow = Number.isSafeInteger(now) ? now : Date.now();
    assert(raw && typeof raw === 'object' && !Array.isArray(raw), '저장 데이터 형식이 올바르지 않습니다.');
    assert(raw.version === 1, '지원하지 않는 저장 데이터 버전입니다.');
    assert(Array.isArray(raw.events) && raw.events.length <= MAX_EVENTS, '식사 기록 개수가 올바르지 않습니다.');
    assert(raw.settings && typeof raw.settings === 'object', '설정 형식이 올바르지 않습니다.');
    assert(Number.isInteger(raw.settings.goalHours) && raw.settings.goalHours >= 8 && raw.settings.goalHours <= 24, '목표 시간은 8~24시간 정수여야 합니다.');
    const goalEnabled = raw.settings.goalEnabled === undefined ? false : raw.settings.goalEnabled;
    assert(typeof goalEnabled === 'boolean', '목표 사용 설정이 올바르지 않습니다.');
    // Older saves chose a theme explicitly, so a missing flag keeps that choice.
    const themeAuto = raw.settings.themeAuto === undefined ? false : raw.settings.themeAuto;
    assert(typeof themeAuto === 'boolean', '화면 모드 설정이 올바르지 않습니다.');
    assert(typeof raw.settings.notifications === 'boolean', '알림 설정이 올바르지 않습니다.');
    assert(raw.settings.theme === 'light' || raw.settings.theme === 'dark', '테마 설정이 올바르지 않습니다.');
    assert(raw.notifiedKey === null || (typeof raw.notifiedKey === 'string' && raw.notifiedKey.length <= 200), '알림 기록이 올바르지 않습니다.');
    const events = raw.events.map((event) => validateEvent(event, checkedNow));
    const seen = new Set();
    for (const event of events) { assert(!seen.has(event.id), '식사 기록 ID가 중복되었습니다.'); seen.add(event.id); }
    for (let i = 1; i < events.length; i += 1) assert(events[i - 1].at >= events[i].at, '식사 기록은 최신순이어야 합니다.');
    return { version: 1, events, settings: { goalHours: raw.settings.goalHours, goalEnabled, notifications: raw.settings.notifications, theme: raw.settings.theme, themeAuto }, notifiedKey: raw.notifiedKey };
  }
  function normalized(state, now) { return validateState(state, now); }
  function persistedNow(state, now) {
    const timestamps = state && Array.isArray(state.events) ? state.events.map((event) => event && event.at).filter(Number.isSafeInteger) : [];
    return timestamps.reduce((max, at) => (at > max ? at : max), now);
  }
  function normalizedPersisted(state, now) { return validateState(state, persistedNow(state, now)); }
  function sortEvents(events) { return events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)); }
  function mergeBackup(state, incoming, now) {
    const next = normalizedPersisted(state, now); const source = normalizedPersisted(incoming, now);
    const ids = new Set(next.events.map((event) => event.id));
    const meals = new Set(next.events.map((event) => `${event.type}:${event.at}`));
    let added = 0; let skipped = 0;
    for (const event of source.events) {
      const key = `${event.type}:${event.at}`;
      if (ids.has(event.id) || meals.has(key)) { skipped += 1; continue; }
      assert(next.events.length < MAX_EVENTS, '합치면 기록이 최대 개수(100,000건)를 넘어요.');
      next.events.push(event); ids.add(event.id); meals.add(key); added += 1;
    }
    sortEvents(next.events); return { state: normalizedPersisted(next, now), added, skipped };
  }
  function recordMeal(state, type, now, id) {
    assert(TYPES.includes(type), '식사 종류가 올바르지 않습니다.');
    assert(validTimestamp(now, now), '현재 시각이 올바르지 않습니다.');
    assert(typeof id === 'string' && id.length > 0, '식사 기록 ID가 필요합니다.');
    const next = normalizedPersisted(state, now);
    assert(!next.events.some((event) => event.id === id), '식사 기록 ID가 중복되었습니다.');
    next.events.push({ id, type, at: now, note: '' }); sortEvents(next.events); next.notifiedKey = null;
    return normalizedPersisted(next, now);
  }
  function updateMeal(state, id, patch, now) {
    const next = normalizedPersisted(state, now); const index = next.events.findIndex((event) => event.id === id);
    assert(index !== -1, '수정할 식사 기록을 찾을 수 없습니다.');
    assert(patch && typeof patch === 'object', '수정 내용이 올바르지 않습니다.');
    const existing = next.events[index]; const candidate = { ...existing, ...patch, id };
    // A record saved before the clock moved backward keeps its time; only a newly entered time must not be in the future.
    const keepsTime = patch.at === undefined || patch.at === existing.at;
    next.events[index] = validateEvent(candidate, keepsTime ? Math.max(now, existing.at) : now); sortEvents(next.events);
    return normalizedPersisted(next, now);
  }
  function deleteMeal(state, id, now) {
    const next = normalizedPersisted(state, now); const count = next.events.length;
    next.events = next.events.filter((event) => event.id !== id); assert(next.events.length !== count, '삭제할 식사 기록을 찾을 수 없습니다.');
    return normalizedPersisted(next, now);
  }
  function updateSettings(state, patch, now) {
    const next = normalizedPersisted(state, now); assert(patch && typeof patch === 'object', '설정 변경값이 올바르지 않습니다.');
    next.settings = { ...next.settings, ...patch }; return normalizedPersisted(next, now);
  }
  const validatedCache = new WeakMap();
  function readOnlyState(state, now) {
    if (state && typeof state === 'object' && Array.isArray(state.events) && state.settings && typeof state.settings === 'object') {
      const hit = validatedCache.get(state);
      const first = state.events[0];
      if (hit && hit.events === state.events && hit.length === state.events.length && hit.firstId === (first && first.id) && hit.firstAt === (first && first.at) && hit.settings === state.settings && hit.goalHours === state.settings.goalHours && hit.goalEnabled === state.settings.goalEnabled) {
        return hit.validated;
      }
    }
    const validated = normalizedPersisted(state, now);
    const first = state.events[0];
    validatedCache.set(state, {
      events: state.events, length: state.events.length,
      firstId: first && first.id, firstAt: first && first.at,
      settings: state.settings, goalHours: state.settings && state.settings.goalHours, goalEnabled: state.settings && state.settings.goalEnabled,
      validated
    });
    return validated;
  }
  const COLOR_THEMES = Object.freeze(['sage', 'ocean', 'terracotta', 'lavender', 'amber', 'slate']);
  function validColorTheme(value) { return COLOR_THEMES.includes(value); }
  const TIMEZONES = Object.freeze([
    'auto', 'America/Toronto', 'Asia/Seoul', 'America/Vancouver', 'America/New_York',
    'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris',
    'Asia/Tokyo', 'Australia/Sydney', 'UTC'
  ]);
  const dtfCache = new Map();
  function getDtf(timeZone) {
    let dtf = dtfCache.get(timeZone);
    if (!dtf) {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      });
      dtfCache.set(timeZone, dtf);
    }
    return dtf;
  }
  function validTimeZone(timeZone) {
    if (timeZone === 'auto') return true;
    if (typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 100) return false;
    try { getDtf(timeZone); return true; } catch { return false; }
  }
  function tzParts(at, timeZone) {
    if (!timeZone || timeZone === 'auto') {
      const d = new Date(at);
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
    }
    const map = {};
    for (const part of getDtf(timeZone).formatToParts(new Date(at))) {
      if (part.type !== 'literal') map[part.type] = Number(part.value);
    }
    return { year: map.year, month: map.month, day: map.day, hour: map.hour === 24 ? 0 : map.hour, minute: map.minute, second: map.second };
  }
  function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
    if (!timeZone || timeZone === 'auto') return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
    const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const offsetAt = (ts) => {
      const p = tzParts(ts, timeZone);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0) - Math.floor(ts / 1000) * 1000;
    };
    const first = guess - offsetAt(guess);
    return guess - offsetAt(first);
  }
  function formatLocalInput(at, timeZone) {
    const p = tzParts(at, timeZone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }
  function parseLocalInput(value, timeZone) {
    if (typeof value !== 'string') return NaN;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) return new Date(value).getTime();
    const [, y, m, d, H, M] = match.map(Number);
    return zonedTimeToUtc(y, m, d, H, M, timeZone);
  }
  const AUTOPHAGY_STAGES = Object.freeze([
    Object.freeze({ stage: 0, startHours: 0, nextHours: 12, rateFactor: 1.00, fatShare: 0.45, dots: '○ ○ ○ ○ ○', rangeKey: 'autophagy.range0', titleKey: 'autophagy.stage0' }),
    Object.freeze({ stage: 1, startHours: 12, nextHours: 16, rateFactor: 1.04, fatShare: 0.65, dots: '● ○ ○ ○ ○', rangeKey: 'autophagy.range1', titleKey: 'autophagy.stage1' }),
    Object.freeze({ stage: 2, startHours: 16, nextHours: 24, rateFactor: 1.07, fatShare: 0.78, dots: '● ● ○ ○ ○', rangeKey: 'autophagy.range2', titleKey: 'autophagy.stage2' }),
    Object.freeze({ stage: 3, startHours: 24, nextHours: 36, rateFactor: 1.09, fatShare: 0.88, dots: '● ● ● ○ ○', rangeKey: 'autophagy.range3', titleKey: 'autophagy.stage3' }),
    Object.freeze({ stage: 4, startHours: 36, nextHours: 48, rateFactor: 1.05, fatShare: 0.92, dots: '● ● ● ● ○', rangeKey: 'autophagy.range4', titleKey: 'autophagy.stage4' }),
    Object.freeze({ stage: 5, startHours: 48, nextHours: null, rateFactor: 0.97, fatShare: 0.95, dots: '● ● ● ● ●', rangeKey: 'autophagy.range5', titleKey: 'autophagy.stage5' })
  ]);
  const ACTIVITY_MULTIPLIERS = Object.freeze({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 });
  const DEFAULT_PROFILE = Object.freeze({ sex: 'male', age: 35, heightCm: 170, weightKg: 68, activityLevel: 'light' });
  function normalizeProfile(profile = {}) {
    const p = profile && typeof profile === 'object' ? profile : {};
    const sex = p.sex === 'female' ? 'female' : 'male';
    const age = Number.isFinite(Number(p.age)) && Number(p.age) >= 10 && Number(p.age) <= 120 ? Math.round(Number(p.age)) : DEFAULT_PROFILE.age;
    const heightCm = Number.isFinite(Number(p.heightCm)) && Number(p.heightCm) >= 100 && Number(p.heightCm) <= 250 ? Math.round(Number(p.heightCm) * 10) / 10 : DEFAULT_PROFILE.heightCm;
    const weightKg = Number.isFinite(Number(p.weightKg)) && Number(p.weightKg) >= 25 && Number(p.weightKg) <= 300 ? Math.round(Number(p.weightKg) * 10) / 10 : DEFAULT_PROFILE.weightKg;
    const activityLevel = Object.prototype.hasOwnProperty.call(ACTIVITY_MULTIPLIERS, p.activityLevel) ? p.activityLevel : DEFAULT_PROFILE.activityLevel;
    return { sex, age, heightCm, weightKg, activityLevel };
  }
  function calculateCalories(elapsedMs, profile) {
    const norm = normalizeProfile(profile);
    // Mifflin-St Jeor BMR equation (kcal/day)
    const bmr = Math.max(800, 10 * norm.weightKg + 6.25 * norm.heightCm - 5 * norm.age + (norm.sex === 'female' ? -161 : 5));
    const tdee = bmr * ACTIVITY_MULTIPLIERS[norm.activityLevel];
    const baseKcalPerHour = tdee / 24;
    if (elapsedMs === null || elapsedMs === undefined || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return { totalKcal: 0, fatGrams: 0, kcalPerHour: Math.round(baseKcalPerHour), bmr: Math.round(bmr), tdee: Math.round(tdee) };
    }
    const totalHours = elapsedMs / HOUR;
    let totalKcal = 0;
    let fatKcal = 0;
    let currentFactor = AUTOPHAGY_STAGES[0].rateFactor;
    for (const s of AUTOPHAGY_STAGES) {
      if (totalHours <= s.startHours) break;
      const endHours = s.nextHours === null ? totalHours : Math.min(totalHours, s.nextHours);
      const spanHours = Math.max(0, endHours - s.startHours);
      const stageKcal = spanHours * baseKcalPerHour * s.rateFactor;
      totalKcal += stageKcal;
      fatKcal += stageKcal * s.fatShare;
      currentFactor = s.rateFactor;
    }
    return {
      totalKcal: totalKcal < 100 ? Math.round(totalKcal * 10) / 10 : Math.round(totalKcal),
      fatGrams: Math.round((fatKcal / 7.7) * 10) / 10,
      kcalPerHour: Math.round(baseKcalPerHour * currentFactor),
      bmr: Math.round(bmr),
      tdee: Math.round(tdee)
    };
  }
  function getAutophagyStage(elapsedMs) {
    if (elapsedMs === null || elapsedMs === undefined || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return { active: false, stage: 0, dots: '○ ○ ○ ○ ○', current: AUTOPHAGY_STAGES[0], next: AUTOPHAGY_STAGES[1], stageProgress: 0, nextRemainingMs: null };
    }
    const hours = elapsedMs / HOUR;
    let idx = 0;
    for (let i = AUTOPHAGY_STAGES.length - 1; i >= 0; i -= 1) {
      if (hours >= AUTOPHAGY_STAGES[i].startHours) { idx = i; break; }
    }
    const current = AUTOPHAGY_STAGES[idx];
    const next = AUTOPHAGY_STAGES[idx + 1] || null;
    const startMs = current.startHours * HOUR;
    const endMs = next ? next.startHours * HOUR : 48 * HOUR;
    const stageProgress = next ? Math.min(1, Math.max(0, (elapsedMs - startMs) / (endMs - startMs))) : 1;
    const nextRemainingMs = next ? Math.max(0, endMs - elapsedMs) : 0;
    return { active: true, stage: current.stage, dots: current.dots, current, next, stageProgress, nextRemainingMs };
  }
  function latestMeal(state, now) { return readOnlyState(state, now).events[0] || null; }
  function getTimer(state, now, control) {
    const checkedNow = Number.isSafeInteger(now) ? now : Date.now();
    // A system clock can move backward after a saved meal. Validate persisted records
    // against their newest timestamp, then render a zero elapsed timer with clockSkew.
    const next = readOnlyState(state, checkedNow); const meal = next.events[0];
    if (!meal) return { elapsedMs: null, remainingMs: null, progress: 0, reached: false, goalAt: null, clockSkew: false, paused: false, reset: false };
    const active = control && control.timerMealId === meal.id ? control : null;
    if (active && active.timerReset) {
      return { elapsedMs: null, remainingMs: null, progress: 0, reached: false, goalAt: null, clockSkew: false, paused: false, reset: true };
    }
    const paused = Boolean(active && Number.isSafeInteger(active.timerPausedAt));
    const effectiveNow = paused ? active.timerPausedAt : checkedNow;
    const pausedMs = active && Number.isFinite(active.timerPausedMs) && active.timerPausedMs > 0 ? Math.floor(active.timerPausedMs) : 0;
    const effectiveStart = meal.at + pausedMs;
    const clockSkew = effectiveNow < effectiveStart; const elapsedMs = Math.max(0, effectiveNow - effectiveStart);
    if (!next.settings.goalEnabled) return { elapsedMs, remainingMs: null, progress: 0, reached: false, goalAt: null, clockSkew, paused, reset: false };
    const goalAt = effectiveStart + next.settings.goalHours * HOUR;
    return { elapsedMs, remainingMs: Math.max(0, goalAt - effectiveNow), progress: Math.min(1, elapsedMs / (next.settings.goalHours * HOUR)), reached: effectiveNow >= goalAt, goalAt, clockSkew, paused, reset: false };
  }
  function formatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  function localDay(at, timeZone) {
    const p = tzParts(at, timeZone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }
  function weeklyStats(state, now, timeZone) {
    const next = readOnlyState(state, now);
    const useTz = Boolean(timeZone && timeZone !== 'auto');
    let rangeStart;
    const daily = [];
    if (!useTz) {
      const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
      rangeStart = start.getTime();
      for (let i = 0; i < 7; i += 1) { const d = new Date(start); d.setDate(start.getDate() + i); daily.push({ date: localDay(d.getTime()), meals: 0, maxIntervalMs: 0, longestInterval: null, intervals: [] }); }
    } else {
      const today = tzParts(now, timeZone);
      const firstDay = new Date(Date.UTC(today.year, today.month - 1, today.day - 6));
      rangeStart = zonedTimeToUtc(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, firstDay.getUTCDate(), 0, 0, timeZone);
      for (let i = 0; i < 7; i += 1) {
        const u = new Date(Date.UTC(today.year, today.month - 1, today.day - 6 + i));
        daily.push({ date: `${String(u.getUTCFullYear()).padStart(4, '0')}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(u.getUTCDate()).padStart(2, '0')}`, meals: 0, maxIntervalMs: 0, longestInterval: null, intervals: [] });
      }
    }
    const byDate = new Map(daily.map((day) => [day.date, day]));
    next.events.filter((event) => event.at >= rangeStart && event.at <= now).forEach((event) => { const day = byDate.get(localDay(event.at, timeZone)); if (day) day.meals += 1; });
    const intervals = []; for (let i = 0; i < next.events.length - 1; i += 1) {
      const newer = next.events[i]; const older = next.events[i + 1];
      if (newer.at < rangeStart || newer.at > now) continue;
      const interval = { from: older.at, to: newer.at, durationMs: newer.at - older.at };
      intervals.push(interval);
      // Completed intervals belong to the date of the later meal. This avoids
      // inventing a still-running fast for days with no following meal record.
      const day = byDate.get(localDay(newer.at, timeZone));
      if (!day) continue;
      day.intervals.push(interval);
      if (day.longestInterval === null || interval.durationMs > day.maxIntervalMs) {
        day.maxIntervalMs = interval.durationMs;
        day.longestInterval = interval;
      }
    }
    return { rangeStart, rangeEnd: now, totalMeals: daily.reduce((sum, day) => sum + day.meals, 0), daily, mealIntervals: intervals };
  }
  function parseBackup(text) {
    assert(typeof text === 'string' && text.length > 0 && text.length <= MAX_BACKUP_CHARS, '백업 파일 크기가 올바르지 않습니다.');
    let raw; try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new TypeError('JSON 형식의 단식 기록 백업 파일이 아니에요.'); }
    return normalizedPersisted(raw, Date.now());
  }
  return { TYPES, COLOR_THEMES, TIMEZONES, AUTOPHAGY_STAGES, ACTIVITY_MULTIPLIERS, DEFAULT_PROFILE, MIN_DATE, MAX_DATE, MAX_EVENTS, MAX_FOODS_PER_MEAL, defaultState, normalizeFoods, foodKcalTotal, validateEvent, validateState, validColorTheme, validTimeZone, normalizeProfile, calculateCalories, tzParts, formatLocalInput, parseLocalInput, localDay, parseBackup, mergeBackup, recordMeal, updateMeal, deleteMeal, updateSettings, latestMeal, getTimer, getAutophagyStage, formatDuration, weeklyStats, clone };
});
