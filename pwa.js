(function () {
  'use strict';
  // In Electron, preload.js already exposes window.desktop before deferred scripts run.
  if (typeof window === 'undefined' || window.desktop) return;

  const Core = window.FastingCore;
  const I18n = window.FastingI18n;
  const Csv = window.FastingCsv;
  const Activity = window.FastingActivity;
  if (!Core || !I18n || !Csv) return;

  const STATE_KEY = 'dansik:records:v1';
  const PREFS_KEY = 'dansik:prefs:v1';
  const PREF_KEYS = ['tray', 'autoStart', 'firstRunDone', 'language', 'timeZone', 'colorTheme', 'sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'activitySamples', 'activitySource', 'energyMode'];
  const BOOLEAN_PREFS = ['tray', 'autoStart', 'firstRunDone'];
  const LANGUAGE_SETTINGS = ['auto', ...I18n.LANGS];

  const THEME_COLORS = {
    sage: { light: '#f6f6f0', dark: '#1e2924' },
    ocean: { light: '#f2f6fa', dark: '#17222d' },
    terracotta: { light: '#faf4f0', dark: '#291e1a' },
    lavender: { light: '#f6f4fa', dark: '#211c2b' },
    amber: { light: '#f9f6ee', dark: '#262116' },
    slate: { light: '#f4f5f7', dark: '#1c2026' }
  };

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function loadPrefs() {
    const prefs = { tray: false, autoStart: false, firstRunDone: false, language: 'auto', timeZone: 'auto', colorTheme: 'sage', ...Core.DEFAULT_PROFILE, activitySamples: [], activitySource: '', energyMode: 'estimate', timerAnchorId: null, timerMealId: null, timerPausedAt: null, timerPausedMs: 0, timerReset: false };
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      for (const key of BOOLEAN_PREFS) if (typeof raw[key] === 'boolean') prefs[key] = raw[key];
      if (LANGUAGE_SETTINGS.includes(raw.language)) prefs[key_lang()] = raw.language;
      if (Core.validTimeZone(raw.timeZone)) prefs.timeZone = raw.timeZone;
      if (Core.validColorTheme(raw.colorTheme)) prefs.colorTheme = raw.colorTheme;
      if (typeof raw.timerAnchorId === 'string' && raw.timerAnchorId.length > 0 && raw.timerAnchorId.length <= 160) prefs.timerAnchorId = raw.timerAnchorId;
      if (typeof raw.timerMealId === 'string' && raw.timerMealId) prefs.timerMealId = raw.timerMealId;
      if (Number.isSafeInteger(raw.timerPausedAt) && raw.timerPausedAt > 0) prefs.timerPausedAt = raw.timerPausedAt;
      if (Number.isSafeInteger(raw.timerPausedMs) && raw.timerPausedMs >= 0) prefs.timerPausedMs = raw.timerPausedMs;
      if (typeof raw.timerReset === 'boolean') prefs.timerReset = raw.timerReset;
      Object.assign(prefs, Core.normalizeProfile(raw));
    } catch (_) { /* ignore unreadable storage */ }
    // Activity data is intentionally isolated from the older preference fields.
    // A malformed import must never reset the user's meal/timer/profile settings.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (Activity && Array.isArray(raw.activitySamples)) {
        try { prefs.activitySamples = Activity.normalizeSamples(raw.activitySamples); } catch (_) { /* keep empty samples */ }
      }
      if (typeof raw.activitySource === 'string' && raw.activitySource.length <= 200 && prefs.activitySamples.some(sample => sample.source === raw.activitySource)) prefs.activitySource = raw.activitySource;
      if (raw.energyMode === 'estimate' || (raw.energyMode === 'activity' && prefs.activitySource)) prefs.energyMode = raw.energyMode;
    }
    return prefs;
    function key_lang() { return 'language'; }
  }

  function savePrefs(next) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }

  function loadStoredState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return { state: Core.defaultState(), warning: null };
      return { state: Core.parseBackup(raw), warning: null };
    } catch (_) {
      return { state: Core.defaultState(), warning: '저장된 기록을 읽지 못해 새 기록으로 시작했어요.' };
    }
  }

  function saveStoredState(next) {
    const validated = Core.parseBackup(JSON.stringify(next));
    localStorage.setItem(STATE_KEY, JSON.stringify(validated));
    return validated;
  }

  const loaded = loadStoredState();
  let state = loaded.state;
  let warning = loaded.warning;
  const prefs = loadPrefs();
  const undoStack = [];
  let lastClick = 0;
  let mini = false;
  let pendingImport = null;
  const stateListeners = new Set();
  const modeListeners = new Set();
  const commandListeners = new Set();

  const mediaDark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function systemLocale() { return navigator.language || 'ko-KR'; }
  function activeI18n() { return I18n.create(I18n.resolve(prefs.language, systemLocale())); }
  function themeOf() { return state.settings.themeAuto ? (mediaDark && mediaDark.matches ? 'dark' : 'light') : state.settings.theme; }

  function syncMetaThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const palette = THEME_COLORS[prefs.colorTheme] || THEME_COLORS.sage;
    meta.setAttribute('content', palette[themeOf() === 'dark' ? 'dark' : 'light']);
  }

  function snapshot() {
    const I = activeI18n();
    syncMetaThemeColor();
    return {
      ok: true,
      state: Core.clone(state),
      theme: themeOf(),
      prefs: { ...prefs, canAutoStart: false, autoStartActive: false },
      app: { version: '1.0.24 (PWA-49)', build: 'PWA-49' },
      canUndo: undoStack.length > 0,
      warning: warning ? I.err(warning) : null,
      language: { setting: prefs.language, resolved: I.lang },
      window: { overlay: false, mini, pinned: false, alwaysOnTop: false }
    };
  }

  function broadcast() {
    const snap = snapshot();
    stateListeners.forEach(fn => fn(snap));
  }

  const timerSnap = () => ({ timerAnchorId: prefs.timerAnchorId, timerMealId: prefs.timerMealId, timerPausedAt: prefs.timerPausedAt, timerPausedMs: prefs.timerPausedMs, timerReset: prefs.timerReset });
  const resetTimerControl = () => ({ timerAnchorId: null, timerMealId: null, timerPausedAt: null, timerPausedMs: 0, timerReset: false });
  function persist(next, remember = true, nextTimer = null) {
    const previous = { state, timer: timerSnap() };
    if (!nextTimer && prefs.timerAnchorId && !next.events.some(event => event.id === prefs.timerAnchorId)) nextTimer = resetTimerControl();
    let saved;
    if (nextTimer) {
      const previousPrefs = localStorage.getItem(PREFS_KEY);
      savePrefs({ ...prefs, ...nextTimer });
      try { saved = saveStoredState(next); }
      catch (error) {
        try {
          if (previousPrefs === null) localStorage.removeItem(PREFS_KEY);
          else localStorage.setItem(PREFS_KEY, previousPrefs);
        } catch (_) { Object.assign(prefs, loadPrefs()); broadcast(); }
        throw error;
      }
      Object.assign(prefs, nextTimer);
    } else saved = saveStoredState(next);
    if (remember) {
      undoStack.push(previous);
      if (undoStack.length > 20) undoStack.shift();
    }
    state = saved;
    broadcast();
    return snapshot();
  }

  function checkPatch(patch, allowed) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.includes(key))) {
      throw new TypeError('입력 형식이 올바르지 않습니다.');
    }
    return patch;
  }

  function pickFileText() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.csv,application/json,text/csv';
      input.style.display = 'none';
      document.body.appendChild(input);
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return finish(null);
        try {
          if (file.size > 64 * 1024 * 1024) throw new Error('large');
          const text = await file.text();
          finish({ name: file.name, text });
        } catch (_) {
          finish({ error: true });
        }
      });
      input.addEventListener('cancel', () => finish(null));
      input.click();
    });
  }

  function triggerDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function handle(payload) {
    const I = activeI18n();
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('요청 형식이 올바르지 않습니다.');
      const now = Date.now();
      switch (payload.type) {
        case 'load': return snapshot();
        case 'record': {
          if (now - lastClick < 1200) return { ok: false, debounced: true, canUndo: undoStack.length > 0, error: I.err('방금 기록했어요. 잘못 누르셨다면 되돌리기를 눌러주세요.') };
          const result = persist(Core.recordMeal(state, payload.meal, now, newId()), true, resetTimerControl());
          lastClick = now;
          return result;
        }
        case 'add': {
          if (payload.startTimer !== undefined && typeof payload.startTimer !== 'boolean') throw new TypeError('입력 형식이 올바르지 않습니다.');
          const patch = checkPatch(payload.patch, ['type', 'at', 'note', 'foods']);
          const id = newId();
          const prevNewest = state.events[0];
          const next = Core.recordMeal(state, patch.type, now, id);
          const updated = Core.updateMeal(next, id, patch, now);
          const newestUnchanged = prevNewest && updated.events[0] && updated.events[0].id === prevNewest.id && updated.events[0].at === prevNewest.at;
          if (newestUnchanged && !payload.startTimer) {
            updated.notifiedKey = state.notifiedKey;
          }
          const nextTimer = payload.startTimer ? { ...resetTimerControl(), timerAnchorId: id } : newestUnchanged ? null : resetTimerControl();
          return persist(updated, true, nextTimer);
        }
        case 'update': return persist(Core.updateMeal(state, payload.id, checkPatch(payload.patch, ['type', 'at', 'note', 'foods']), now));
        case 'delete': return persist(Core.deleteMeal(state, payload.id, now));
        case 'settings': {
          const patch = checkPatch(payload.patch, ['goalHours', 'goalEnabled', 'notifications', 'theme', 'themeAuto']);
          if (patch.notifications && 'Notification' in window && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (_) {}
          }
          return persist(Core.updateSettings(state, patch, now));
        }
        case 'undo': {
          if (!undoStack.length) return { ok: false, error: I.err('되돌릴 기록이 없어요.') };
          const next = undoStack[undoStack.length - 1];
          persist(next.state || next, false, next.timer || null);
          undoStack.pop();
          lastClick = 0;
          return snapshot();
        }
        case 'timer-pause': {
          const meal = Core.timerMeal(state, now, prefs), cur = Core.getTimer(state, now, prefs);
          if (!meal || cur.reset) throw new TypeError('진행 중인 타이머가 없어요.');
          const prevTimer = timerSnap();
          const baseMs = prefs.timerMealId === meal.id && Number.isSafeInteger(prefs.timerPausedMs) && prefs.timerPausedMs > 0 ? prefs.timerPausedMs : 0;
          const nextTimer = cur.paused
            ? { timerMealId: meal.id, timerPausedAt: null, timerPausedMs: baseMs + Math.max(0, now - prefs.timerPausedAt), timerReset: false }
            : { timerMealId: meal.id, timerPausedAt: now, timerPausedMs: baseMs, timerReset: false };
          savePrefs({ ...prefs, ...nextTimer });
          Object.assign(prefs, nextTimer);
          undoStack.push({ state, timer: prevTimer });
          if (undoStack.length > 20) undoStack.shift();
          broadcast();
          return { ...snapshot(), paused: !cur.paused };
        }
        case 'timer-reset': {
          const meal = Core.timerMeal(state, now, prefs), cur = Core.getTimer(state, now, prefs);
          if (!meal || cur.reset) throw new TypeError('진행 중인 타이머가 없어요.');
          const prevTimer = timerSnap();
          const nextTimer = { timerMealId: meal.id, timerPausedAt: null, timerPausedMs: 0, timerReset: true };
          savePrefs({ ...prefs, ...nextTimer });
          Object.assign(prefs, nextTimer);
          undoStack.push({ state, timer: prevTimer });
          if (undoStack.length > 20) undoStack.shift();
          broadcast();
          return { ...snapshot(), reset: true };
        }
        case 'prefs': {
          const patch = checkPatch(payload.patch, PREF_KEYS);
          if (BOOLEAN_PREFS.some(key => key in patch && typeof patch[key] !== 'boolean')) throw new TypeError('설정 값이 올바르지 않습니다.');
          if ('language' in patch && !LANGUAGE_SETTINGS.includes(patch.language)) throw new TypeError('언어 설정이 올바르지 않습니다.');
          if ('timeZone' in patch && !Core.validTimeZone(patch.timeZone)) throw new TypeError('시간대 설정이 올바르지 않습니다.');
          if ('colorTheme' in patch && !Core.validColorTheme(patch.colorTheme)) throw new TypeError('색상 테마 설정이 올바르지 않습니다.');
          if ('sex' in patch && !['male', 'female'].includes(patch.sex)) throw new TypeError('신체 정보 설정이 올바르지 않습니다.');
          if ('age' in patch && (!Number.isInteger(patch.age) || patch.age < 10 || patch.age > 120)) throw new TypeError('신체 정보 설정이 올바르지 않습니다.');
          if ('heightCm' in patch && (!Number.isFinite(patch.heightCm) || patch.heightCm < 100 || patch.heightCm > 250)) throw new TypeError('신체 정보 설정이 올바르지 않습니다.');
          if ('weightKg' in patch && (!Number.isFinite(patch.weightKg) || patch.weightKg < 25 || patch.weightKg > 300)) throw new TypeError('신체 정보 설정이 올바르지 않습니다.');
          if ('activityLevel' in patch && !Object.prototype.hasOwnProperty.call(Core.ACTIVITY_MULTIPLIERS, patch.activityLevel)) throw new TypeError('신체 정보 설정이 올바르지 않습니다.');
          const hasActivityPatch = ['activitySamples', 'activitySource', 'energyMode'].some(key => key in patch);
          if (hasActivityPatch && !Activity) throw new TypeError('Activity data support is unavailable.');
          let nextActivitySamples = prefs.activitySamples;
          let nextActivitySource = prefs.activitySource;
          let nextEnergyMode = prefs.energyMode;
          if ('activitySamples' in patch) {
            nextActivitySamples = Activity.normalizeSamples(patch.activitySamples);
            patch.activitySamples = nextActivitySamples;
          }
          if ('activitySource' in patch) {
            if (typeof patch.activitySource !== 'string' || patch.activitySource.length > 200) throw new TypeError('Activity source must be a string of 200 characters or fewer.');
            nextActivitySource = patch.activitySource;
          }
          if ('energyMode' in patch) {
            if (!['estimate', 'activity'].includes(patch.energyMode)) throw new TypeError('Energy mode must be estimate or activity.');
            nextEnergyMode = patch.energyMode;
          }
          if (hasActivityPatch && nextActivitySource && !nextActivitySamples.some(sample => sample.source === nextActivitySource)) {
            throw new TypeError('Activity source must select one imported source.');
          }
          if (hasActivityPatch && nextEnergyMode === 'activity' && !nextActivitySource) throw new TypeError('Activity mode requires one selected activity source.');
          const nextPrefs = { ...prefs, ...patch };
          savePrefs(nextPrefs);
          Object.assign(prefs, nextPrefs);
          broadcast();
          return snapshot();
        }
        case 'mini': {
          mini = !mini;
          modeListeners.forEach(fn => fn(mini));
          broadcast();
          return { ok: true, mini };
        }
        case 'import-preview': {
          const picked = await pickFileText();
          if (!picked) { pendingImport = null; return { ok: true, picked: false }; }
          if (picked.error) throw new TypeError('백업 파일을 읽지 못했어요. 파일이 너무 크거나 다른 프로그램에서 열려 있을 수 있어요.');
          const isCsv = picked.name.toLowerCase().endsWith('.csv');
          const next = isCsv ? { ...Core.defaultState(), events: Csv.parseMealCsv(picked.text, now) } : Core.parseBackup(picked.text);
          const merged = Core.mergeBackup(state, next, now);
          pendingImport = { next, kind: isCsv ? 'csv' : 'json' };
          const times = next.events.map(event => event.at);
          return {
            ok: true,
            picked: true,
            preview: {
              name: picked.name,
              kind: pendingImport.kind,
              count: next.events.length,
              current: state.events.length,
              added: merged.added,
              skipped: merged.skipped,
              newestAt: times.length ? times[0] : null,
              oldestAt: times.length ? times[times.length - 1] : null
            }
          };
        }
        case 'import-commit': {
          if (!pendingImport) throw new TypeError('가져올 파일을 먼저 선택해 주세요.');
          if (!['merge', 'replace'].includes(payload.mode)) throw new TypeError('가져오기 방식이 올바르지 않습니다.');
          const { next, kind } = pendingImport;
          const merged = payload.mode === 'merge'
            ? Core.mergeBackup(state, next, now).state
            : { ...next, settings: { ...(kind === 'json' ? next.settings : state.settings), theme: state.settings.theme, themeAuto: state.settings.themeAuto }, notifiedKey: null };
          const result = persist(merged);
          pendingImport = null;
          return result;
        }
        case 'import-cancel': pendingImport = null; return { ok: true };
        case 'export': {
          const tz = prefs.timeZone && prefs.timeZone !== 'auto' ? { timeZone: prefs.timeZone } : {};
          const baseName = I.t('export.fileName', { date: new Date().toLocaleDateString('sv-SE', tz) });
          triggerDownload(`${baseName}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
          return { ok: true, exported: true };
        }
        default: throw new TypeError('지원하지 않는 요청입니다.');
      }
    } catch (error) {
      return { ok: false, error: I.err(error) };
    }
  }

  if (mediaDark && typeof mediaDark.addEventListener === 'function') {
    mediaDark.addEventListener('change', () => {
      if (state.settings.themeAuto) broadcast();
    });
  }

  setInterval(() => {
    if (!state.settings.goalEnabled || !state.settings.notifications || !state.events.length) return;
    const now = Date.now();
    const meal = Core.timerMeal(state, now, prefs);
    const timer = Core.getTimer(state, now, prefs);
    if (!meal || state.events[0].at > meal.at) return;
    const key = `${meal.id}:${meal.at}:${state.settings.goalHours}`;
    if (!timer.reached || state.notifiedKey === key) return;
    try {
      state = saveStoredState({ ...state, notifiedKey: key });
      if ('Notification' in window && Notification.permission === 'granted') {
        const I = activeI18n();
        new Notification(I.t('notify.title'), { body: I.t('notify.body', { h: state.settings.goalHours }), icon: 'app-icon.png', silent: true });
      }
    } catch (_) {}
  }, 15000);

  document.body.classList.add('is-pwa');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    if (typeof navigator.serviceWorker.addEventListener === 'function') {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !refreshing && typeof location.reload === 'function') {
          refreshing = true;
          location.reload();
        }
      });
    }
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
        if (reg && typeof reg.update === 'function') reg.update().catch(() => {});
      }).catch(() => {});
    });
  }

  window.desktop = {
    getState: () => handle({ type: 'load' }),
    action: payload => handle(payload),
    onState: callback => { stateListeners.add(callback); return () => stateListeners.delete(callback); },
    onMode: callback => { modeListeners.add(callback); return () => modeListeners.delete(callback); },
    onCommand: callback => { commandListeners.add(callback); return () => commandListeners.delete(callback); }
  };
})();
