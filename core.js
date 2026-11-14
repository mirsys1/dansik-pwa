(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(commonJs ? require('./weight.js') : root.FastingWeight);
  if (commonJs) module.exports = api;
  if (root) root.FastingCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Weight) {
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
  // Time-restricted eating presets: fast hours first, then the eating window length.
  const FAST_PLANS = Object.freeze({
    '16:8': Object.freeze({ fastHours: 16, eatHours: 8 }),
    '18:6': Object.freeze({ fastHours: 18, eatHours: 6 }),
    '20:4': Object.freeze({ fastHours: 20, eatHours: 4 }),
    omad: Object.freeze({ fastHours: 23, eatHours: 1 })
  });
  const DEFAULT_WINDOW_START = '12:00';
  function validWindowStart(value) { return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value); }
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
  function foodCalorieSummary(events, from, until) {
    let kcal = 0;
    let logged = 0;
    let missing = 0;
    for (const meal of events) {
      if (meal.at < from) break; // Stored meals are sorted newest first.
      if (meal.at >= until) continue;
      if (meal.foods?.length) {
        kcal += foodKcalTotal(meal.foods);
        logged += 1;
      } else {
        missing += 1;
      }
    }
    return { kcal, logged, missing };
  }
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
    const plan = raw.settings.plan === undefined || raw.settings.plan === null ? null : raw.settings.plan;
    assert(plan === null || Object.prototype.hasOwnProperty.call(FAST_PLANS, plan), '단식 계획 설정이 올바르지 않습니다.');
    const windowStart = raw.settings.windowStart === undefined || raw.settings.windowStart === null ? null : raw.settings.windowStart;
    assert(windowStart === null || validWindowStart(windowStart), '식사 시간대 시작 시각이 올바르지 않습니다.');
    const settings = { goalHours: raw.settings.goalHours, goalEnabled, notifications: raw.settings.notifications, theme: raw.settings.theme, themeAuto };
    // ponytail: unset plan fields stay absent so older saves and backups round-trip byte-for-byte.
    if (plan) { settings.plan = plan; if (windowStart) settings.windowStart = windowStart; }
    const state = { version: 1, events, settings, notifiedKey: raw.notifiedKey };
    // An absent weight field is legacy. An explicit empty list is part of the backup.
    if (Object.prototype.hasOwnProperty.call(raw, 'weightMeasurements')) {
      assert(Array.isArray(raw.weightMeasurements), '입력 형식이 올바르지 않습니다.');
      state.weightMeasurements = weightApi().normalizeMeasurements(raw.weightMeasurements);
    }
    return state;
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
    const current = next.weightMeasurements?.length || 0;
    const incomingCount = source.weightMeasurements?.length ?? null;
    if (incomingCount !== null) {
      next.weightMeasurements = weightApi().merge(next.weightMeasurements || [], source.weightMeasurements);
    }
    const weightAdded = (next.weightMeasurements?.length || 0) - current;
    sortEvents(next.events);
    return {
      state: normalizedPersisted(next, now),
      added,
      skipped,
      weights: { current, incoming: incomingCount, added: weightAdded }
    };
  }
  function replaceBackup(state, incoming, now, restoreSettings) {
    const current = normalizedPersisted(state, now);
    const next = normalizedPersisted(incoming, now);
    next.settings = {
      ...(restoreSettings ? next.settings : current.settings),
      theme: current.settings.theme,
      themeAuto: current.settings.themeAuto
    };
    next.notifiedKey = null;
    if (next.weightMeasurements === undefined && current.weightMeasurements !== undefined) {
      next.weightMeasurements = current.weightMeasurements;
    }
    return next;
  }
  function weightApi() {
    if (!Weight) throw new TypeError('지원하지 않는 요청입니다.');
    return Weight;
  }
  function recordWeight(state, date, weightKg, now, timeZone, expectedWeightKg) {
    const next = normalizedPersisted(state, now);
    next.weightMeasurements = weightApi().record(next.weightMeasurements || [], date, weightKg, localDay(now, timeZone), expectedWeightKg);
    return next;
  }
  function deleteWeight(state, date, now, timeZone, expectedWeightKg) {
    const next = normalizedPersisted(state, now);
    next.weightMeasurements = weightApi().remove(next.weightMeasurements || [], date, localDay(now, timeZone), expectedWeightKg);
    return next;
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
    const merged = { ...next.settings, ...patch };
    // Setting a different goal length by hand ends the plan instead of contradicting it.
    if (!('plan' in patch) && 'goalHours' in patch && merged.plan && FAST_PLANS[merged.plan] && FAST_PLANS[merged.plan].fastHours !== patch.goalHours) { delete merged.plan; delete merged.windowStart; }
    if (merged.plan) {
      // A plan owns the goal: choosing one turns the goal on at its fast length.
      assert(Object.prototype.hasOwnProperty.call(FAST_PLANS, merged.plan), '단식 계획 설정이 올바르지 않습니다.');
      if ('plan' in patch || 'goalHours' in patch) { merged.goalHours = FAST_PLANS[merged.plan].fastHours; merged.goalEnabled = true; }
      if (!merged.windowStart) merged.windowStart = DEFAULT_WINDOW_START;
      if (!('plan' in patch) && patch.goalEnabled === false) { delete merged.plan; delete merged.windowStart; }
    }
    if ('plan' in patch && !patch.plan) { delete merged.plan; delete merged.windowStart; }
    next.settings = merged; return normalizedPersisted(next, now);
  }
  // The daily eating window for a plan: when it opens/closes around `now`, in the chosen time zone.
  function eatingWindow(settings, now, timeZone) {
    const plan = settings && settings.plan;
    if (!plan || !Object.prototype.hasOwnProperty.call(FAST_PLANS, plan)) return null;
    const startText = validWindowStart(settings.windowStart) ? settings.windowStart : DEFAULT_WINDOW_START;
    const hh = Number(startText.slice(0, 2)), mm = Number(startText.slice(3));
    const span = FAST_PLANS[plan].eatHours * HOUR;
    const today = tzParts(now, timeZone);
    const windows = [-2, -1, 0, 1].map((k) => {
      const base = new Date(Date.UTC(today.year, today.month - 1, today.day + k));
      const startAt = zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, timeZone);
      return { startAt, endAt: startAt + span };
    });
    const current = windows.find((w) => w.startAt <= now && now < w.endAt) || null;
    const starts = windows.map((w) => w.startAt), ends = windows.map((w) => w.endAt);
    const last = (list) => list.filter((at) => at <= now).pop() || null;
    const next = (list) => list.find((at) => at > now) || null;
    return { plan, open: Boolean(current), startAt: current && current.startAt, endAt: current && current.endAt,
      lastOpenAt: last(starts), lastCloseAt: last(ends), nextOpenAt: next(starts), nextCloseAt: next(ends), eatHours: FAST_PLANS[plan].eatHours, fastHours: FAST_PLANS[plan].fastHours, windowStart: startText };
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
  const TIMER_GRADIENTS = Object.freeze(['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08']);
  function validTimerGradient(value) { return TIMER_GRADIENTS.includes(value); }
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
    // Basal-only fallback. Recorded activity is added by FastingActivity;
    // elapsed time alone does not establish an activity or fasting-stage bonus.
    const duration = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
    const totalKcal = bmr * duration / (24 * HOUR);
    return {
      totalKcal: Math.round(totalKcal * 10) / 10,
      fatGrams: null,
      kcalPerHour: Math.round(bmr / 24),
      bmr: Math.round(bmr),
      tdee: null
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
  function selectedTimerMeal(state, control) {
    return (control && control.timerAnchorId && state.events.find(event => event.id === control.timerAnchorId)) || state.events[0] || null;
  }
  function timerMeal(state, now, control) { return selectedTimerMeal(readOnlyState(state, now), control); }
  function reconcileTimerAfterMealUpdate(before, next, control, now) {
    const previousMeal = selectedTimerMeal(before, control);
    if (!previousMeal || !control || control.timerMealId !== previousMeal.id) return null;
    const updatedMeal = next.events.find(event => event.id === previousMeal.id);
    if (!updatedMeal || updatedMeal.at === previousMeal.at) return null;
    // A corrected start invalidates offsets tied to the old timestamp. Keep the
    // selected meal and whether the user paused/reset; only rebase its controls.
    return {
      timerAnchorId: control.timerAnchorId || null,
      timerMealId: previousMeal.id,
      timerPausedAt: Number.isSafeInteger(control.timerPausedAt) ? now : null,
      timerPausedMs: 0,
      timerReset: Boolean(control.timerReset)
    };
  }
  function getTimer(state, now, control) {
    const checkedNow = Number.isSafeInteger(now) ? now : Date.now();
    // A system clock can move backward after a saved meal. Validate persisted records
    // against their newest timestamp, then render a zero elapsed timer with clockSkew.
    const next = readOnlyState(state, checkedNow); const meal = selectedTimerMeal(next, control);
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
  function mealTypeForTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    const hour = Number(match[1]);
    return hour >= 5 && hour < 11 ? 'breakfast' : hour >= 11 && hour < 17 ? 'lunch' : 'dinner';
  }
  function localDay(at, timeZone) {
    const p = tzParts(at, timeZone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }
  function dayRange(date, timeZone) {
    const next = new Date(date + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      from: parseLocalInput(date + 'T00:00', timeZone),
      until: parseLocalInput(next.toISOString().slice(0, 10) + 'T00:00', timeZone)
    };
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
  function periodFastingStats(state, now, timeZone, days) {
    assert(Number.isInteger(days) && days >= 1 && days <= 366, '통계 기간이 올바르지 않습니다.');
    const next = readOnlyState(state, now);
    const today = localDay(now, timeZone);
    const first = new Date(`${today}T00:00:00Z`);
    first.setUTCDate(first.getUTCDate() - (days - 1));
    const startDate = first.toISOString().slice(0, 10);
    // Each date contributes only the longest completed interval ending that day.
    const longestByDate = new Map();
    for (let i = 0; i < next.events.length - 1; i += 1) {
      const newer = next.events[i]; const older = next.events[i + 1];
      if (newer.at > now) continue;
      const date = localDay(newer.at, timeZone);
      if (date < startDate) break;
      const duration = newer.at - older.at;
      if (!longestByDate.has(date) || duration > longestByDate.get(date)) longestByDate.set(date, duration);
    }
    const durations = [...longestByDate.values()];
    const count = durations.length;
    return { startDate, endDate: today, count, averageMs: count ? durations.reduce((sum, duration) => sum + duration, 0) / count : null, longestMs: count ? Math.max(...durations) : null };
  }
  // Longest completed meal interval ending on each of the last `days` dates (oldest first); 0 means no data.
  function dailyLongest(state, now, timeZone, days) {
    assert(Number.isInteger(days) && days >= 1 && days <= 366, '통계 기간이 올바르지 않습니다.');
    const next = readOnlyState(state, now);
    const today = localDay(now, timeZone);
    const dates = [];
    for (let k = days - 1; k >= 0; k -= 1) { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - k); dates.push(d.toISOString().slice(0, 10)); }
    const longest = new Map(dates.map((date) => [date, 0]));
    for (let i = 0; i < next.events.length - 1; i += 1) {
      const newer = next.events[i]; const older = next.events[i + 1];
      if (newer.at > now) continue;
      const date = localDay(newer.at, timeZone);
      if (date < dates[0]) break;
      if (longest.has(date)) longest.set(date, Math.max(longest.get(date), newer.at - older.at));
    }
    return dates.map((date) => ({ date, longestMs: longest.get(date) }));
  }
  // Consecutive days whose longest completed fast reached the goal. Today only counts once it is met,
  // so an unfinished fast this morning never breaks yesterday's streak.
  function goalStreak(state, now, timeZone, goalHours) {
    assert(Number.isInteger(goalHours) && goalHours >= 8 && goalHours <= 24, '목표 시간은 8~24시간 정수여야 합니다.');
    const goalMs = goalHours * HOUR;
    const days = dailyLongest(state, now, timeZone, 366);
    let i = days.length - 1;
    if (days[i].longestMs < goalMs) i -= 1;
    let streak = 0;
    while (i >= 0 && days[i].longestMs >= goalMs) { streak += 1; i -= 1; }
    return streak;
  }
  function parseBackup(text) {
    assert(typeof text === 'string' && text.length > 0 && text.length <= MAX_BACKUP_CHARS, '백업 파일 크기가 올바르지 않습니다.');
    let raw; try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new TypeError('JSON 형식의 단식 기록 백업 파일이 아니에요.'); }
    return normalizedPersisted(raw, Date.now());
  }
  return { FAST_PLANS, DEFAULT_WINDOW_START, validWindowStart, eatingWindow, dailyLongest, goalStreak, TYPES, COLOR_THEMES, TIMER_GRADIENTS, TIMEZONES, AUTOPHAGY_STAGES, ACTIVITY_MULTIPLIERS, DEFAULT_PROFILE, MIN_DATE, MAX_DATE, MAX_EVENTS, MAX_FOODS_PER_MEAL, defaultState, normalizeFoods, foodKcalTotal, foodCalorieSummary, validateEvent, validateState, validColorTheme, validTimerGradient, validTimeZone, normalizeProfile, calculateCalories, tzParts, formatLocalInput, parseLocalInput, localDay, dayRange, parseBackup, mergeBackup, replaceBackup, recordMeal, updateMeal, deleteMeal, recordWeight, deleteWeight, updateSettings, latestMeal, timerMeal, reconcileTimerAfterMealUpdate, getTimer, getAutophagyStage, formatDuration, mealTypeForTime, weeklyStats, periodFastingStats, clone };
});
