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
  const STORAGE_LOCK = 'dansik:storage-lock:v1';
  const MUTATIONS = new Set(['record', 'add', 'update', 'delete', 'settings', 'undo', 'timer-pause', 'timer-reset', 'prefs', 'activity-add', 'activity-remove', 'weight-record', 'weight-delete', 'import-commit']);
  const RECORDS_UNREADABLE = '저장된 식사 기록을 읽지 못했어요. 원본은 그대로 보관했어요. 기록 백업에서 복구해 주세요.';
  const PREFS_UNREADABLE = '저장된 설정을 읽지 못했어요. 설정을 덮어쓰지 않았어요.';
  const STORAGE_UNAVAILABLE = '저장소를 사용할 수 없어요. 브라우저의 사이트 데이터 설정을 확인한 뒤 다시 시도해 주세요.';
  const PREF_KEYS = ['tray', 'autoStart', 'firstRunDone', 'language', 'timeZone', 'colorTheme', 'sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'activitySamples', 'activitySource', 'energyMode'];
  const SETTINGS_KEYS = ['goalHours', 'goalEnabled', 'notifications', 'theme', 'themeAuto'];
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

  function loadPrefs(raw) {
    const prefs = { tray: false, autoStart: false, firstRunDone: false, language: 'auto', timeZone: 'auto', colorTheme: 'sage', ...Core.DEFAULT_PROFILE, activitySamples: [], activitySource: '', energyMode: 'estimate', timerAnchorId: null, timerMealId: null, timerPausedAt: null, timerPausedMs: 0, timerReset: false };
    if (raw) {
      for (const key of BOOLEAN_PREFS) if (typeof raw[key] === 'boolean') prefs[key] = raw[key];
      if (LANGUAGE_SETTINGS.includes(raw.language)) prefs.language = raw.language;
      if (Core.validTimeZone(raw.timeZone)) prefs.timeZone = raw.timeZone;
      if (Core.validColorTheme(raw.colorTheme)) prefs.colorTheme = raw.colorTheme;
      if (typeof raw.timerAnchorId === 'string' && raw.timerAnchorId.length > 0 && raw.timerAnchorId.length <= 160) prefs.timerAnchorId = raw.timerAnchorId;
      if (typeof raw.timerMealId === 'string' && raw.timerMealId) prefs.timerMealId = raw.timerMealId;
      if (Number.isSafeInteger(raw.timerPausedAt) && raw.timerPausedAt > 0) prefs.timerPausedAt = raw.timerPausedAt;
      if (Number.isSafeInteger(raw.timerPausedMs) && raw.timerPausedMs >= 0) prefs.timerPausedMs = raw.timerPausedMs;
      if (typeof raw.timerReset === 'boolean') prefs.timerReset = raw.timerReset;
      Object.assign(prefs, Core.normalizeProfile(raw));
      // A malformed activity import must never reset older preference fields.
      if (Activity && Array.isArray(raw.activitySamples)) {
        try { prefs.activitySamples = Activity.normalizeSamples(raw.activitySamples); } catch (_) { /* keep empty samples */ }
      }
      if (typeof raw.activitySource === 'string' && raw.activitySource.length <= 200 && prefs.activitySamples.some(sample => sample.source === raw.activitySource)) prefs.activitySource = raw.activitySource;
      if (raw.energyMode === 'estimate' || (raw.energyMode === 'activity' && prefs.activitySource)) prefs.energyMode = raw.energyMode;
    }
    return prefs;
  }

  function savePrefs(next) {
    if (prefsUnreadable) throw new Error(PREFS_UNREADABLE);
    const bytes = JSON.stringify(next);
    localStorage.setItem(PREFS_KEY, bytes);
    storedPrefs = bytes;
  }

  function refreshStorage() {
    let records, settings;
    try {
      records = localStorage.getItem(STATE_KEY);
      settings = localStorage.getItem(PREFS_KEY);
    } catch (_) {
      const changed = !storageUnavailable;
      storageUnavailable = true;
      return changed;
    }
    const regainedAccess = storageUnavailable;
    storageUnavailable = false;
    const recordsChanged = records !== storedState;
    const prefsChanged = settings !== storedPrefs;
    if (recordsChanged) {
      storedState = records;
      try {
        state = records === null ? Core.defaultState() : Core.parseBackup(records);
        stateUnreadable = false;
      } catch (_) {
        // Keep the last readable snapshot and leave the original bytes untouched.
        stateUnreadable = true;
      }
    }
    const previousTimer = timerSnap();
    if (prefsChanged) {
      storedPrefs = settings;
      try {
        const parsed = settings === null ? {} : JSON.parse(settings);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid settings');
        Object.assign(prefs, loadPrefs(parsed));
        prefsUnreadable = false;
      } catch (_) { prefsUnreadable = true; }
    }
    // Undo restores snapshots. An external write can make those snapshots stale.
    if (recordsChanged || prefsUnreadable || Object.entries(previousTimer).some(([key, value]) => prefs[key] !== value)) {
      undoStack.length = 0;
      lastClick = 0;
    }
    return recordsChanged || prefsChanged || regainedAccess;
  }

  function saveStoredState(next) {
    const validated = Core.parseBackup(JSON.stringify(next));
    const bytes = JSON.stringify(validated);
    localStorage.setItem(STATE_KEY, bytes);
    storedState = bytes;
    return validated;
  }

  let storedState, storedPrefs;
  let storageUnavailable = false;
  let stateUnreadable = false;
  let prefsUnreadable = false;
  let state = Core.defaultState();
  const prefs = loadPrefs();
  const undoStack = [];
  let lastClick = 0;
  let mini = false;
  let pendingImport = null;
  let pendingWrites = 0;
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
    const warning = storageUnavailable ? STORAGE_UNAVAILABLE : stateUnreadable ? RECORDS_UNREADABLE : prefsUnreadable ? PREFS_UNREADABLE : null;
    syncMetaThemeColor();
    return {
      ok: true,
      state: Core.clone(state),
      theme: themeOf(),
      prefs: { ...prefs, canAutoStart: false, autoStartActive: false },
      app: { version: '1.0.31 (PWA-61)', build: 'PWA-61' },
      canUndo: undoStack.length > 0,
      warning: warning ? I.err(warning) : null,
      language: { setting: prefs.language, resolved: I.lang },
      window: { overlay: false, mini, pinned: false, alwaysOnTop: false }
    };
  }

  function broadcast() {
    const snap = snapshot();
    stateListeners.forEach(fn => {
      // A failed view update must not make a completed storage write look unsaved.
      try { fn(snap); }
      catch (error) { console.error(error); }
    });
  }

  const timerSnap = () => ({ timerAnchorId: prefs.timerAnchorId, timerMealId: prefs.timerMealId, timerPausedAt: prefs.timerPausedAt, timerPausedMs: prefs.timerPausedMs, timerReset: prefs.timerReset });
  const resetTimerControl = () => ({ timerAnchorId: null, timerMealId: null, timerPausedAt: null, timerPausedMs: 0, timerReset: false });
  refreshStorage();

  function persist(next, remember = true, nextTimer = null, recovery = false) {
    if (stateUnreadable && !recovery) throw new Error(RECORDS_UNREADABLE);
    const previous = { state, timer: timerSnap() };
    if (!nextTimer && prefs.timerAnchorId && !next.events.some(event => event.id === prefs.timerAnchorId)) nextTimer = resetTimerControl();
    let saved;
    if (nextTimer) {
      const previousPrefs = storedPrefs;
      savePrefs({ ...prefs, ...nextTimer });
      try { saved = saveStoredState(next); }
      catch (error) {
        try {
          if (previousPrefs === null) localStorage.removeItem(PREFS_KEY);
          else localStorage.setItem(PREFS_KEY, previousPrefs);
          storedPrefs = previousPrefs;
        } catch (_) { storedPrefs = undefined; refreshStorage(); broadcast(); }
        throw error;
      }
      Object.assign(prefs, nextTimer);
    } else saved = saveStoredState(next);
    if (remember) {
      undoStack.push(previous);
      if (undoStack.length > 20) undoStack.shift();
    }
    state = saved;
    stateUnreadable = false;
    broadcast();
    return snapshot();
  }

  let lockDb;
  function openLockDatabase() {
    if (!lockDb) {
      lockDb = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(STORAGE_LOCK, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('lock');
        request.onblocked = request.onerror = () => reject(new Error(STORAGE_UNAVAILABLE));
        request.onsuccess = () => {
          request.result.onversionchange = () => { request.result.close(); lockDb = null; };
          resolve(request.result);
        };
      }).catch(error => { lockDb = null; throw error; });
    }
    return lockDb;
  }

  function runExclusive(run) {
    // Older browsers serialize same-origin read/write transactions on this store.
    // The callback must do its localStorage reads and writes synchronously.
    const runIndexed = () => openLockDatabase().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction('lock', 'readwrite');
      const request = transaction.objectStore('lock').get('turn');
      request.onsuccess = () => {
        try { resolve(run()); } catch (error) { reject(error); }
      };
      request.onerror = transaction.onabort = () => reject(new Error(STORAGE_UNAVAILABLE));
    }));
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      // Also acquire the shared IndexedDB lock when available so clients using
      // the fallback coordinate with clients using Web Locks.
      return navigator.locks.request(STORAGE_LOCK, window.indexedDB ? runIndexed : run);
    }
    if (!window.indexedDB) return Promise.reject(new Error(STORAGE_UNAVAILABLE));
    return runIndexed();
  }

  async function runRead(run) {
    let started = false;
    try {
      return await runExclusive(() => {
        started = true;
        return run();
      });
    } catch (error) {
      if (started) throw error;
      return run(); // The locking API may be blocked even when storage is readable.
    }
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

  function execute(payload, picked) {
    const I = activeI18n();
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
        case 'update':
        case 'delete': {
          if (payload.expectedMeal !== undefined) {
            const current = state.events.find(meal => meal.id === payload.id);
            if (JSON.stringify(current) !== JSON.stringify(payload.expectedMeal)) {
              throw new Error('다른 창에서 이 식사 기록을 변경했어요. 기록을 다시 열어 주세요.');
            }
          }
          return persist(payload.type === 'update'
            ? Core.updateMeal(state, payload.id, checkPatch(payload.patch, ['type', 'at', 'note', 'foods']), now)
            : Core.deleteMeal(state, payload.id, now));
        }
        case 'settings': {
          const patch = checkPatch(payload.patch, SETTINGS_KEYS);
          return persist(Core.updateSettings(state, patch, now));
        }
        case 'weight-record':
          return persist(Core.recordWeight(state, payload.date, payload.weightKg, now, prefs.timeZone, payload.expectedWeightKg));
        case 'weight-delete':
          return persist(Core.deleteWeight(state, payload.date, now, prefs.timeZone, payload.expectedWeightKg));
        case 'undo': {
          if (!undoStack.length) return { ok: false, error: I.err('되돌릴 기록이 없어요.') };
          const next = undoStack.pop();
          try { persist(next.state, false, next.timer); }
          catch (error) { undoStack.push(next); throw error; }
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
          const patch = { ...checkPatch(payload.patch, PREF_KEYS) };
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
        case 'activity-add': {
          if (!Activity?.addRecordedSamples) throw new TypeError('Activity data support is unavailable.');
          if (payload.manual !== undefined && typeof payload.manual !== 'boolean') throw new TypeError('입력 형식이 올바르지 않습니다.');
          const samples = Activity.addRecordedSamples(prefs.activitySamples, payload.samples, now, payload.manual);
          const next = { ...prefs, activitySamples: samples, activitySource: prefs.activitySource || payload.samples[0].source };
          savePrefs(next);
          Object.assign(prefs, next);
          broadcast();
          return snapshot();
        }
        case 'activity-remove': {
          if (!Activity) throw new TypeError('Activity data support is unavailable.');
          const source = payload.source;
          if (typeof source !== 'string' || !source.trim() || source.length > 200) throw new TypeError('입력 형식이 올바르지 않습니다.');
          const next = { ...prefs, activitySamples: prefs.activitySamples.filter(sample => sample.source !== source) };
          if (prefs.activitySource === source) {
            next.activitySource = '';
            next.energyMode = 'estimate';
          }
          savePrefs(next);
          Object.assign(prefs, next);
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
          pendingImport = null;
          if (!picked) { pendingImport = null; return { ok: true, picked: false }; }
          if (picked.error) throw new TypeError('백업 파일을 읽지 못했어요. 파일이 너무 크거나 다른 프로그램에서 열려 있을 수 있어요.');
          const isCsv = picked.name.toLowerCase().endsWith('.csv');
          const next = isCsv ? { ...Core.defaultState(), events: Csv.parseMealCsv(picked.text, now) } : Core.parseBackup(picked.text);
          const merged = Core.mergeBackup(state, next, now);
          pendingImport = { next, kind: isCsv ? 'csv' : 'json', base: storedState };
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
              weights: merged.weights,
              newestAt: times.length ? times[0] : null,
              oldestAt: times.length ? times[times.length - 1] : null
            }
          };
        }
        case 'import-commit': {
          if (!pendingImport) throw new TypeError('가져올 파일을 먼저 선택해 주세요.');
          if (!['merge', 'replace'].includes(payload.mode)) throw new TypeError('가져오기 방식이 올바르지 않습니다.');
          const { next, kind, base } = pendingImport;
          if (payload.mode === 'replace' && base !== storedState) {
            throw new Error('다른 창에서 식사 기록이 바뀌었어요. 가져오기 미리보기를 다시 열어 주세요.');
          }
          if (stateUnreadable && payload.mode !== 'replace') throw new Error(RECORDS_UNREADABLE);
          const recovery = stateUnreadable;
          const merged = payload.mode === 'merge'
            ? Core.mergeBackup(state, next, now).state
            : Core.replaceBackup(state, next, now, kind === 'json');
          if (recovery) localStorage.setItem(STATE_KEY + ':recovery:' + newId(), storedState);
          const result = persist(merged, !recovery, recovery ? resetTimerControl() : null, recovery);
          pendingImport = null;
          return result;
        }
        case 'import-cancel': pendingImport = null; return { ok: true };
        case 'export': {
          const format = payload.format ?? 'json';
          if (!['json', 'csv'].includes(format)) throw new TypeError('입력 형식이 올바르지 않습니다.');
          if (storageUnavailable) throw new Error(STORAGE_UNAVAILABLE);
          const tz = prefs.timeZone && prefs.timeZone !== 'auto' ? { timeZone: prefs.timeZone } : {};
          const baseName = I.t('export.fileName', { date: new Date().toLocaleDateString('sv-SE', tz) });
          if (stateUnreadable) {
            if (format !== 'json') throw new Error(RECORDS_UNREADABLE);
            triggerDownload(`${baseName}-recovery.json`, storedState, 'application/json;charset=utf-8');
          } else if (format === 'csv') {
            triggerDownload(`${baseName}.csv`, Csv.toCsv(state, I), 'text/csv;charset=utf-8');
          } else {
            triggerDownload(`${baseName}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
          }
          return { ok: true, exported: true };
        }
        default: throw new TypeError('지원하지 않는 요청입니다.');
      }
  }

  async function handle(payload) {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('요청 형식이 올바르지 않습니다.');
      if (payload.type === 'settings' && checkPatch(payload.patch, SETTINGS_KEYS).notifications === true
          && 'Notification' in window && Notification.permission === 'default') {
        // Don't hold the storage lock while waiting for a user to answer a browser prompt.
        try { await Notification.requestPermission(); } catch (_) {}
      }
      const picked = payload.type === 'import-preview' ? await pickFileText() : null;
      const run = () => {
        if (refreshStorage()) broadcast();
        if (storageUnavailable && MUTATIONS.has(payload.type)) throw new Error(STORAGE_UNAVAILABLE);
        return execute(payload, picked);
      };
      if (MUTATIONS.has(payload.type)) {
        pendingWrites += 1;
        try { return await runExclusive(run); }
        finally { pendingWrites -= 1; }
      }
      if (payload.type === 'load' || payload.type === 'import-preview') return await runRead(run);
      return run();
    } catch (error) {
      return { ok: false, error: activeI18n().err(error) };
    }
  }

  if (mediaDark && typeof mediaDark.addEventListener === 'function') {
    mediaDark.addEventListener('change', () => {
      if (state.settings.themeAuto) broadcast();
    });
  }

  function syncExternalStorage() {
    runRead(() => { if (refreshStorage()) broadcast(); }).catch(() => {});
  }
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === STATE_KEY || event.key === PREFS_KEY) syncExternalStorage();
  });
  window.addEventListener('focus', syncExternalStorage);
  window.addEventListener('pageshow', syncExternalStorage);

  setInterval(() => {
    if (!state.settings.goalEnabled || !state.settings.notifications || !state.events.length) return;
    runExclusive(() => {
      if (refreshStorage()) broadcast();
      if (storageUnavailable || stateUnreadable || !state.settings.goalEnabled || !state.settings.notifications || !state.events.length) return;
      const now = Date.now();
      const meal = Core.timerMeal(state, now, prefs);
      const timer = Core.getTimer(state, now, prefs);
      if (!meal || state.events[0].at > meal.at) return;
      const key = `${meal.id}:${meal.at}:${state.settings.goalHours}`;
      if (!timer.reached || state.notifiedKey === key) return;
      state = saveStoredState({ ...state, notifiedKey: key });
      if ('Notification' in window && Notification.permission === 'granted') {
        const I = activeI18n();
        new Notification(I.t('notify.title'), { body: I.t('notify.body', { h: state.settings.goalHours }), icon: 'app-icon.png', silent: true });
      }
    }).catch(() => {});
  }, 15000);

  document.body.classList.add('is-pwa');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    if (typeof navigator.serviceWorker.addEventListener === 'function') {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !refreshing && typeof location.reload === 'function') {
          // Keep an unfinished form or queued write intact. Reopening the app applies the update.
          if (pendingWrites > 0 || document.querySelector('dialog[open]')) {
            document.body.dataset.pwaUpdateReady = 'true';
            return;
          }
          if (document.body.dataset.pwaUpdateReady === 'true') return;
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
