(function () {
  'use strict';
  // In Electron, preload.js already exposes window.desktop before deferred scripts run.
  if (typeof window === 'undefined' || window.desktop) return;

  const Core = window.FastingCore;
  const I18n = window.FastingI18n;
  const Csv = window.FastingCsv;
  const Activity = window.FastingActivity;
  const Sync = window.FastingSync;
  const Portable = window.FastingPortableBackup;
  if (!Core || !I18n || !Csv) return;

  const STATE_KEY = 'dansik:records:v1';
  // Older PWA tabs strip unrecognized settings from version 1. Version 2
  // makes them refuse ordinary writes while a plan is stored. Exports use v1.
  const PLAN_STORAGE_VERSION = 2;
  const PREFS_KEY = 'dansik:prefs:v1';
  const LAST_BACKUP_KEY = 'dansik:last-backup-at:v1';
  const RESTORE_JOURNAL_KEY = 'dansik:restore-journal:v1';
  const STORAGE_LOCK = 'dansik:storage-lock:v1';
  const MUTATIONS = new Set(['record', 'add', 'update', 'delete', 'settings', 'undo', 'timer-pause', 'timer-reset', 'prefs', 'activity-add', 'activity-remove', 'weight-record', 'weight-delete', 'import-commit']);
  const RECORDS_UNREADABLE = '저장된 식사 기록을 읽지 못했어요. 원본은 그대로 보관했어요. 기록 백업에서 복구해 주세요.';
  const PREFS_UNREADABLE = '저장된 설정을 읽지 못했어요. 설정을 덮어쓰지 않았어요.';
  const STORAGE_UNAVAILABLE = '저장소를 사용할 수 없어요. 브라우저의 사이트 데이터 설정을 확인한 뒤 다시 시도해 주세요.';
  const PREF_KEYS = ['tray', 'autoStart', 'firstRunDone', 'backupReminder', 'profileConfirmed', 'backupReminderStartedAt', 'language', 'timeZone', 'colorTheme', 'timerGradient', 'sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'activitySamples', 'activitySource', 'energyMode'];
  const PORTABLE_PREF_KEYS = Portable.PORTABLE_PREF_KEYS;
  const SETTINGS_KEYS = ['goalHours', 'goalEnabled', 'notifications', 'theme', 'themeAuto', 'plan', 'windowStart'];
  const BOOLEAN_PREFS = ['tray', 'autoStart', 'firstRunDone', 'backupReminder', 'profileConfirmed'];
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
    const prefs = { tray: false, autoStart: false, firstRunDone: false, backupReminder: false, profileConfirmed: false, backupReminderStartedAt: null, language: 'auto', timeZone: 'auto', colorTheme: 'sage', timerGradient: 'p05', ...Core.DEFAULT_PROFILE, activitySamples: [], activitySource: '', energyMode: 'estimate', timerAnchorId: null, timerMealId: null, timerPausedAt: null, timerPausedMs: 0, timerReset: false };
    if (raw) {
      for (const key of BOOLEAN_PREFS) if (typeof raw[key] === 'boolean') prefs[key] = raw[key];
      if (Number.isSafeInteger(raw.backupReminderStartedAt) && raw.backupReminderStartedAt > 0) prefs.backupReminderStartedAt = raw.backupReminderStartedAt;
      if (LANGUAGE_SETTINGS.includes(raw.language)) prefs.language = raw.language;
      if (Core.validTimeZone(raw.timeZone)) prefs.timeZone = raw.timeZone;
      if (Core.validColorTheme(raw.colorTheme)) prefs.colorTheme = raw.colorTheme;
      if (Core.validTimerGradient(raw.timerGradient)) prefs.timerGradient = raw.timerGradient;
      if (typeof raw.timerAnchorId === 'string' && raw.timerAnchorId.length > 0 && raw.timerAnchorId.length <= 160) prefs.timerAnchorId = raw.timerAnchorId;
      if (typeof raw.timerMealId === 'string' && raw.timerMealId) prefs.timerMealId = raw.timerMealId;
      if (Number.isSafeInteger(raw.timerPausedAt) && raw.timerPausedAt > 0) prefs.timerPausedAt = raw.timerPausedAt;
      if (Number.isSafeInteger(raw.timerPausedMs) && raw.timerPausedMs >= 0) prefs.timerPausedMs = raw.timerPausedMs;
      if (typeof raw.timerReset === 'boolean') prefs.timerReset = raw.timerReset;
      Object.assign(prefs, Core.normalizeProfile(raw));
      // A malformed activity import must never reset older preference fields.
      if (raw.activitySamples !== undefined) {
        try {
          if (!Array.isArray(raw.activitySamples) || (!Activity && raw.activitySamples.length)) throw new Error('Invalid activity samples');
          if (Activity) prefs.activitySamples = Activity.normalizeSamples(raw.activitySamples);
        } catch (_) {
          // Keep the independently validated language, theme and profile in
          // memory while refusing every write that could overwrite the original
          // malformed activity bytes. Activity-derived choices remain empty.
          const error = new Error(PREFS_UNREADABLE);
          error.code = 'ACTIVITY_UNREADABLE';
          error.partialPrefs = prefs;
          throw error;
        }
      }
      if (typeof raw.activitySource === 'string' && raw.activitySource.length <= 200 && prefs.activitySamples.some(sample => sample.source === raw.activitySource)) prefs.activitySource = raw.activitySource;
      if (raw.energyMode === 'estimate' || (raw.energyMode === 'activity' && prefs.activitySource)) prefs.energyMode = raw.energyMode;
    }
    return prefs;
  }

  function lastBackupAt() {
    try {
      const value = Number(localStorage.getItem(LAST_BACKUP_KEY));
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    } catch (_) { return null; }
  }

  // A portable backup contains only the explicit data/settings allowlist, never
  // pairing codes, authentication data or the per-device timer state.
  function portablePrefs(source) {
    return Portable.portablePrefs(source, Core.clone);
  }

  function parsePortableBackup(raw) {
    return Portable.parsePortableBackup(raw, { Core, Activity, languages: LANGUAGE_SETTINGS });
  }

  function savePrefs(next) {
    if (prefsUnreadable) throw new Error(PREFS_UNREADABLE);
    const bytes = JSON.stringify(next);
    localStorage.setItem(PREFS_KEY, bytes);
    storedPrefs = bytes;
  }

  function normalizeStoredVersion(raw) {
    if (raw?.version === PLAN_STORAGE_VERSION && typeof raw.settings?.plan === 'string') {
      return { ...raw, version: 1 };
    }
    return raw;
  }

  function serializeStoredState(validated) {
    return JSON.stringify(validated.settings.plan
      ? { ...validated, version: PLAN_STORAGE_VERSION }
      : validated);
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
        state = records === null ? Core.defaultState()
          : Core.parseBackup(JSON.stringify(normalizeStoredVersion(JSON.parse(records.replace(/^\uFEFF/, '')))));
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
        activityUnreadable = false;
      } catch (error) {
        prefsUnreadable = true;
        activityUnreadable = error?.code === 'ACTIVITY_UNREADABLE';
        if (activityUnreadable && error.partialPrefs) Object.assign(prefs, error.partialPrefs);
      }
    }
    // Undo restores snapshots. An external write can make those snapshots stale.
    if (recordsChanged || prefsUnreadable || (prefsChanged && undoStack.some(entry => entry.prefs)) || Object.entries(previousTimer).some(([key, value]) => prefs[key] !== value)) {
      undoStack.length = 0;
      lastClick = 0;
    }
    return recordsChanged || prefsChanged || regainedAccess;
  }

  function saveStoredState(next) {
    const validated = Core.parseBackup(JSON.stringify(next));
    const bytes = serializeStoredState(validated);
    localStorage.setItem(STATE_KEY, bytes);
    storedState = bytes;
    return validated;
  }

  let storedState, storedPrefs;
  let storageUnavailable = false;
  let stateUnreadable = false;
  let prefsUnreadable = false;
  let activityUnreadable = false;
  let restoreRecoveryNeeded = false;
  let state = Core.defaultState();
  const prefs = loadPrefs();
  const undoStack = [];
  function invalidatePortableUndoOnPreferenceChange(nextPrefs) {
    if (JSON.stringify(prefs) === JSON.stringify(nextPrefs)) return;
    let lastPortable = -1;
    for (let i = 0; i < undoStack.length; i += 1) if (undoStack[i].prefs) lastPortable = i;
    // Older state snapshots also precede the import and cannot safely be
    // replayed. Preserve later meal-only undo entries, which restore timer
    // fields without replacing the user's newer profile/activity data.
    if (lastPortable >= 0) undoStack.splice(0, lastPortable + 1);
  }
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
    const warning = storageUnavailable || restoreRecoveryNeeded ? STORAGE_UNAVAILABLE : stateUnreadable ? RECORDS_UNREADABLE : prefsUnreadable ? PREFS_UNREADABLE : null;
    syncMetaThemeColor();
    return {
      ok: true,
      state: Core.clone(state),
      theme: themeOf(),
      prefs: { ...prefs, canAutoStart: false, autoStartActive: false },
      app: { version: '1.0.37 (PWA-107)', build: 'PWA-107' },
      lastBackupAt: lastBackupAt(),
      activityRecoveryNeeded: activityUnreadable,
      settingsRecoveryNeeded: prefsUnreadable,
      restoreRecoveryNeeded,
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
  try {
    // Do not publish a half-restored pair before the first locked recovery.
    if (localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) restoreRecoveryNeeded = true;
    else refreshStorage();
  } catch (_) { storageUnavailable = true; }

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

  // Records and portable preferences are separate localStorage entries. Write
  // them under the existing cross-tab lock and roll the first write back if the
  // second fails; preserve unreadable originals before an explicit replacement.
  function persistWithPrefs(next, nextPrefs, remember = true, recover = false) {
    if ((stateUnreadable || prefsUnreadable) && !recover) throw new Error(stateUnreadable ? RECORDS_UNREADABLE : PREFS_UNREADABLE);
    const previous = { state, timer: timerSnap(), prefs: Core.clone(prefs) };
    const oldPrefs = storedPrefs;
    const oldState = storedState;
    const validated = Core.parseBackup(JSON.stringify(next));
    const prefsBytes = JSON.stringify(nextPrefs);
    const stateBytes = serializeStoredState(validated);
    if (recover && prefsUnreadable) localStorage.setItem(PREFS_KEY + ':recovery:' + newId(), oldPrefs);
    if (recover && stateUnreadable) localStorage.setItem(STATE_KEY + ':recovery:' + newId(), oldState);
    const journal = { version: 2, phase: 'prepared', prefs: oldPrefs, state: oldState, nextPrefs: prefsBytes, nextState: stateBytes };
    // If there is not enough space for the journal, fail before changing data.
    localStorage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify(journal));
    try {
      localStorage.setItem(PREFS_KEY, prefsBytes);
      localStorage.setItem(STATE_KEY, stateBytes);
      localStorage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify({ ...journal, phase: 'committed' }));
    }
    catch (error) {
      try { recoverRestoreJournal(); }
      catch (_) { storedPrefs = undefined; storedState = undefined; }
      throw error;
    }
    try { localStorage.removeItem(RESTORE_JOURNAL_KEY); } catch (_) { /* committed journal is safe to clean later */ }
    storedPrefs = prefsBytes; storedState = stateBytes;
    Object.assign(prefs, nextPrefs); state = validated;
    prefsUnreadable = false; activityUnreadable = false; stateUnreadable = false;
    if (remember) { undoStack.push(previous); if (undoStack.length > 20) undoStack.shift(); }
    else if (recover) undoStack.length = 0;
    broadcast();
    return snapshot();
  }

  // Called only under the same exclusive lock used for writes, so a second tab
  // cannot roll back an active restore. Prepared means completion was never
  // acknowledged; committed means both records and preferences were saved.
  function recoverRestoreJournal() {
    const bytes = localStorage.getItem(RESTORE_JOURNAL_KEY);
    if (bytes === null) return;
    let journal;
    try { journal = JSON.parse(bytes); } catch (_) { throw new Error(STORAGE_UNAVAILABLE); }
    if (!journal || ![1, 2].includes(journal.version) || !['prepared', 'committed'].includes(journal.phase) || !(journal.prefs === null || typeof journal.prefs === 'string') || !(journal.state === null || typeof journal.state === 'string')) throw new Error(STORAGE_UNAVAILABLE);
    if (journal.phase === 'prepared') {
      const currentPrefs = localStorage.getItem(PREFS_KEY), currentState = localStorage.getItem(STATE_KEY);
      // Legacy prepared journals lack post-write values: only a no-op cleanup is
      // safe. Version 2 permits rollback only when neither key has a third value
      // that could have been written by an older tab after an interrupted restore.
      if (journal.version === 1) {
        if (currentPrefs !== journal.prefs || currentState !== journal.state) throw new Error(STORAGE_UNAVAILABLE);
      } else {
        if (typeof journal.nextPrefs !== 'string' || typeof journal.nextState !== 'string') throw new Error(STORAGE_UNAVAILABLE);
        if (![journal.prefs, journal.nextPrefs].includes(currentPrefs) || ![journal.state, journal.nextState].includes(currentState)) throw new Error(STORAGE_UNAVAILABLE);
      }
      if (journal.prefs === null) localStorage.removeItem(PREFS_KEY); else localStorage.setItem(PREFS_KEY, journal.prefs);
      if (journal.state === null) localStorage.removeItem(STATE_KEY); else localStorage.setItem(STATE_KEY, journal.state);
      storedPrefs = undefined; storedState = undefined;
    }
    localStorage.removeItem(RESTORE_JOURNAL_KEY);
  }

  function checkRestoreJournal(locked) {
    const wasBlocked = restoreRecoveryNeeded;
    try {
      if (locked) recoverRestoreJournal();
      else if (localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) throw new Error(STORAGE_UNAVAILABLE);
      restoreRecoveryNeeded = false;
      return wasBlocked;
    } catch (error) {
      restoreRecoveryNeeded = true;
      throw error;
    }
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
        return run(true);
      });
    } catch (error) {
      if (started) throw error;
      return run(false); // Reads may proceed without a lock only when no restore needs recovery.
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
          const id = newId();
          const result = persist(Core.recordMeal(state, payload.meal, now, id), true, resetTimerControl());
          lastClick = now;
          return { ...result, recordedMealId: id };
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
          try { if (next.prefs) persistWithPrefs(next.state, next.prefs, false); else persist(next.state, false, next.timer); }
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
          if ('timerGradient' in patch && !Core.validTimerGradient(patch.timerGradient)) throw new TypeError('타이머 진행 색상 설정이 올바르지 않습니다.');
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
          if ('backupReminderStartedAt' in patch && patch.backupReminderStartedAt !== null && (!Number.isSafeInteger(patch.backupReminderStartedAt) || patch.backupReminderStartedAt <= 0 || patch.backupReminderStartedAt > now)) throw new TypeError('Invalid backup reminder date.');
          if (patch.backupReminder === true && !prefs.backupReminderStartedAt) patch.backupReminderStartedAt = state.events.reduce((earliest, event) => Math.min(earliest, event.at), now);
          const nextPrefs = { ...prefs, ...patch };
          savePrefs(nextPrefs);
          invalidatePortableUndoOnPreferenceChange(nextPrefs);
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
          invalidatePortableUndoOnPreferenceChange(next);
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
          invalidatePortableUndoOnPreferenceChange(next);
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
          let next, portable = null;
          if (isCsv) next = { ...Core.defaultState(), events: Csv.parseMealCsv(picked.text, now) };
          else {
            if (!picked.text || picked.text.length > 64 * 1024 * 1024) throw new TypeError('백업 파일 크기가 올바르지 않습니다.');
            let raw;
            try { raw = JSON.parse(picked.text.replace(/^\uFEFF/, '')); }
            catch (_) { throw new TypeError('JSON 형식의 단식 기록 백업 파일이 아니에요.'); }
            const validateAt = Array.isArray(raw?.events) ? raw.events.reduce((max, event) => Number.isSafeInteger(event?.at) && event.at > max ? event.at : max, now) : now;
            next = Core.validateState(normalizeStoredVersion(raw), validateAt);
            portable = parsePortableBackup(raw);
            // Full backups describe the whole portable state. An older full
            // backup without a weight property means no weight records, unlike
            // a legacy meal-only backup whose omission means "keep current".
            if (portable && next.weightMeasurements === undefined) next.weightMeasurements = [];
          }
          const merged = Core.mergeBackup(state, next, now);
          pendingImport = { next, portable, kind: isCsv ? 'csv' : 'json', base: storedState, basePrefs: storedPrefs };
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
              hasPortablePrefs: Boolean(portable),
              activityCurrent: prefsUnreadable ? null : prefs.activitySamples.length,
              activityIncoming: portable ? portable.activitySamples.length : null,
              activityFuture: portable ? portable.activitySamples.filter(sample => sample.end > now).length : null,
              newestAt: times.length ? times[0] : null,
              oldestAt: times.length ? times[times.length - 1] : null
            }
          };
        }
        case 'import-commit': {
          if (!pendingImport) throw new TypeError('가져올 파일을 먼저 선택해 주세요.');
          if (!['merge', 'replace'].includes(payload.mode)) throw new TypeError('가져오기 방식이 올바르지 않습니다.');
          const { next, kind, base, basePrefs, portable } = pendingImport;
          if (payload.mode === 'replace' && (base !== storedState || (portable && basePrefs !== storedPrefs))) {
            throw new Error('다른 창에서 식사 기록이 바뀌었어요. 가져오기 미리보기를 다시 열어 주세요.');
          }
          if (stateUnreadable && payload.mode !== 'replace') throw new Error(RECORDS_UNREADABLE);
          const recovery = stateUnreadable;
          const merged = payload.mode === 'merge'
            ? Core.mergeBackup(state, next, now).state
            : Core.replaceBackup(state, next, now, kind === 'json');
          if (portable) {
            if (prefsUnreadable && payload.mode !== 'replace') throw new Error(PREFS_UNREADABLE);
            if (payload.mode === 'replace') {
              const restoredPrefs = { ...prefs, ...portable, ...resetTimerControl() };
              merged.settings.theme = next.settings.theme;
              merged.settings.themeAuto = next.settings.themeAuto;
              const result = persistWithPrefs(merged, restoredPrefs, !recovery && !prefsUnreadable, recovery || prefsUnreadable);
              pendingImport = null;
              return result;
            }
            if (!Activity && portable.activitySamples.length) throw new TypeError('지원하지 않는 요청입니다.');
            const samples = Activity ? Activity.mergeSamples(portable.activitySamples, prefs.activitySamples) : [];
            const result = persistWithPrefs(merged, { ...prefs, activitySamples: samples }, true);
            pendingImport = null;
            return result;
          }
          if (recovery) localStorage.setItem(STATE_KEY + ':recovery:' + newId(), storedState);
          const result = persist(merged, !recovery, recovery ? resetTimerControl() : null, recovery);
          pendingImport = null;
          return result;
        }
        case 'import-cancel': pendingImport = null; return { ok: true };
        case 'export-settings-recovery': {
          if (!prefsUnreadable || typeof storedPrefs !== 'string') throw new Error(PREFS_UNREADABLE);
          const date = new Date().toLocaleDateString('sv-SE');
          triggerDownload(`dansik-settings-recovery-${date}.json`, storedPrefs, 'application/json;charset=utf-8');
          return { ok: true, exported: true, backupScope: 'settings-recovery' };
        }
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
          } else if (prefsUnreadable) {
            // The original settings are never replaced or presented as valid.
            // Offer a usable records-only file, with a distinct result for UI.
            triggerDownload(`${baseName}-records-only.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
            return { ok: true, exported: true, backupScope: 'records-only', lastBackupAt: lastBackupAt() };
          } else {
            const backup = { ...state, weightMeasurements: state.weightMeasurements || [], portableBackup: { format: 'dansik-full', version: 1, prefs: portablePrefs(prefs) } };
            triggerDownload(`${baseName}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
            try { localStorage.setItem(LAST_BACKUP_KEY, String(now)); } catch (_) { /* download was already initiated */ }
          }
          return { ok: true, exported: true, backupScope: stateUnreadable ? 'records-recovery' : format === 'csv' ? 'csv' : 'full', lastBackupAt: lastBackupAt() };
        }
        default: throw new TypeError('지원하지 않는 요청입니다.');
      }
  }

  // ───────── optional device sync (off by default; see sync.js and worker/sync)
  const SYNC_CODE_KEY = 'dansik:sync-code:v1';
  const SYNC_BASE_KEY = 'dansik:sync-base:v1';
  const syncState = { busy: false, error: null, lastAttemptAt: 0, syncedToken: null, failedAt: 0 };
  // The app must keep working when sync.js is missing (for example an older cached page), so every use is guarded.
  const syncError = (code) => (Sync ? Sync.error(code) : new Error(String(code)));
  function syncEndpoint() {
    const raw = document.querySelector('meta[name="dansik-sync-endpoint"]')?.content;
    if (!Sync || !raw || !/^https?:$/.test(location.protocol) || !globalThis.crypto?.subtle) return null;
    try {
      const url = new URL(raw, location.href);
      const local = url.origin === location.origin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const worker = url.protocol === 'https:' && !url.port && url.hostname.endsWith('.workers.dev');
      return (local || worker) && !url.search && !url.hash && !url.username && !url.password ? new URL('/v1/s/', url).href : null;
    } catch (_) { return null; }
  }
  function readSyncCode() { try { return localStorage.getItem(SYNC_CODE_KEY); } catch (_) { return null; } }
  function readSyncBase() { try { return JSON.parse(localStorage.getItem(SYNC_BASE_KEY)); } catch (_) { return null; } }
  const syncBlocked = () => storageUnavailable || stateUnreadable || prefsUnreadable || restoreRecoveryNeeded;
  const syncToken = () => String(storedState) + '|' + String(storedPrefs);
  function syncIo(keys, endpoint) {
    return {
      readLocal: () => runExclusive(() => {
        refreshStorage();
        if (syncBlocked()) throw syncError('SYNC_BLOCKED');
        return { doc: Sync.snapshot(state, prefs), token: syncToken() };
      }),
      applyLocal: (doc, token) => runExclusive(() => {
        refreshStorage();
        if (syncBlocked()) throw syncError('SYNC_BLOCKED');
        if (syncToken() !== token) return false; // something was edited while the network call ran
        const next = Sync.apply(state, prefs, doc, { Core, Activity });
        persistWithPrefs(next.state, next.prefs, false);
        undoStack.length = 0; // an old undo step would restore data that sync just replaced
        broadcast();
        return true;
      }),
      loadBase: async () => readSyncBase(),
      saveBase: async value => { try { localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(value)); } catch (_) { throw new Error('SYNC_STORAGE'); } },
      fetch: async (method, body) => {
        const headers = { Authorization: 'Bearer ' + keys.token };
        const init = { method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error' };
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(20000);
        if (method === 'PUT') { headers['If-Match'] = String(body.rev); headers['Content-Type'] = 'application/json'; init.body = JSON.stringify({ blob: body.blob }); }
        try { return await fetch(endpoint + keys.id, init); } catch (_) { throw new Error('SYNC_NETWORK'); }
      }
    };
  }
  async function runSync(code, endpoint, options = {}) {
    if (syncState.busy) throw syncError('SYNC_BUSY');
    syncState.busy = true;
    syncState.lastAttemptAt = Date.now();
    try {
      const keys = await Sync.deriveKeys(code);
      const io = syncIo(keys, endpoint);
      const fetchRemote = io.fetch;
      io.fetch = (method, body) => { if (method === 'PUT') options.onRemoteWriteAttempt?.(); return fetchRemote(method, body); };
      const result = await Sync.syncOnce(keys, io, options);
      syncState.error = null; syncState.failedAt = 0;
      syncState.syncedToken = syncToken();
      return result;
    } catch (error) {
      syncState.error = String(error && error.message); syncState.failedAt = Date.now();
      throw Sync.mapError(error);
    } finally { syncState.busy = false; }
  }
  function syncSummary(endpoint) {
    const base = readSyncBase();
    return { available: Boolean(endpoint), enabled: Boolean(readSyncCode()), busy: syncState.busy, lastSyncAt: base && base.at || null, failed: Boolean(syncState.failedAt), serviceReady: syncHealth.at ? syncHealth.ready : null };
  }
  let syncHealth = { at: 0, ready: false };
  async function checkSyncHealth(endpoint, force = false) {
    if (!endpoint) return false;
    if (!force && syncHealth.at && Date.now() - syncHealth.at < 30000) return syncHealth.ready;
    let ready = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(new URL('/health', endpoint).href, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      const health = response.ok ? await response.json() : null;
      ready = health?.service === 'dansik-sync' && health.status === 'ok';
    } catch (_) { /* Settings explicitly reports unavailable and offers a fresh check. */ }
    finally { clearTimeout(timeout); }
    syncHealth = { at: Date.now(), ready };
    return ready;
  }
  async function handleSync(payload) {
    const endpoint = syncEndpoint();
    const code = readSyncCode();
    switch (payload.type) {
      case 'sync-status': return { ok: true, sync: syncSummary(endpoint) };
      case 'sync-check-service': await checkSyncHealth(endpoint, true); return { ok: true, sync: syncSummary(endpoint) };
      case 'sync-enable': {
        if (!endpoint) throw syncError('SYNC_UNAVAILABLE');
        if (code) throw syncError('SYNC_ON');
        if (!await checkSyncHealth(endpoint)) throw syncError('SYNC_UNAVAILABLE');
        const join = payload.mode === 'join';
        if (!join && payload.mode !== 'create') throw new TypeError('요청 형식이 올바르지 않습니다.');
        const entered = join ? Sync.normalizeCode(payload.code) : null;
        if (join && !entered) throw syncError('SYNC_CODE');
        const fresh = join ? Sync.formatCode(entered) : Sync.generateCode();
        // Persist the recoverable key before any remote write. If the network fails,
        // retain it so retry/delete can still authenticate to a possibly-created copy.
        try { localStorage.setItem(SYNC_CODE_KEY, fresh); localStorage.removeItem(SYNC_BASE_KEY); }
        catch (_) { throw syncError('SYNC_STORAGE'); }
        let remoteWriteAttempted = false;
        try { await runSync(fresh, endpoint, { requireRemote: join, onRemoteWriteAttempt: () => { remoteWriteAttempted = true; } }); }
        catch (error) {
          if (!remoteWriteAttempted) { try { localStorage.removeItem(SYNC_CODE_KEY); localStorage.removeItem(SYNC_BASE_KEY); } catch (_) { /* stored key remains recoverable */ } }
          throw error;
        }
        return { ok: true, code: fresh, sync: syncSummary(endpoint) };
      }
      case 'sync-now': {
        if (!code) throw syncError('SYNC_OFF');
        if (!endpoint) throw syncError('SYNC_UNAVAILABLE');
        const result = await runSync(code, endpoint);
        return { ok: true, changes: result.stats, sync: syncSummary(endpoint) };
      }
      case 'sync-show-code':
        if (!code) throw syncError('SYNC_OFF');
        return { ok: true, code };
      case 'sync-disable': {
        if (!code) return { ok: true, sync: syncSummary(endpoint) };
        if (payload.deleteServer === true && endpoint) {
          const keys = await Sync.deriveKeys(code);
          let response;
          try { response = await fetch(endpoint + keys.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + keys.token }, credentials: 'omit', cache: 'no-store', redirect: 'error' }); }
          catch (_) { throw syncError('SYNC_NETWORK'); }
          if (response.status !== 204 && response.status !== 404) throw syncError(response.status === 401 ? 'SYNC_AUTH' : 'SYNC_NETWORK');
        }
        try { localStorage.removeItem(SYNC_CODE_KEY); localStorage.removeItem(SYNC_BASE_KEY); } catch (_) { throw syncError('SYNC_STORAGE'); }
        syncState.syncedToken = null; syncState.error = null; syncState.failedAt = 0;
        return { ok: true, sync: syncSummary(endpoint) };
      }
      default: throw new TypeError('지원하지 않는 요청입니다.');
    }
  }
  function autoSyncDue(force = false) {
    const code = readSyncCode(), endpoint = syncEndpoint();
    if (!code || !endpoint || syncState.busy || syncBlocked() || navigator.onLine === false) return;
    const now = Date.now();
    if (syncState.failedAt && now - syncState.failedAt < 60000) return; // back off after a failure
    const changed = syncToken() !== syncState.syncedToken;
    if (!force && !changed && now - syncState.lastAttemptAt < 5 * 60 * 1000) return;
    runSync(code, endpoint).catch(() => { /* shown in Settings the next time it is opened */ });
  }
  // Started after the goal-notification interval below so the existing timer order is unchanged.
  function startAutoSync() {
    if (!Sync) return;
    setInterval(() => { if (!document.hidden) autoSyncDue(); }, 30000);
    setTimeout(() => autoSyncDue(true), 4000);
    if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (!document.hidden) autoSyncDue(true); });
    window.addEventListener('online', () => autoSyncDue(true));
  }

  async function handle(payload) {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('요청 형식이 올바르지 않습니다.');
      if (typeof payload.type === 'string' && payload.type.startsWith('sync-')) return await handleSync(payload);
      if (payload.type === 'export-restore-recovery') {
        return await runExclusive(() => {
          const journalRaw = localStorage.getItem(RESTORE_JOURNAL_KEY);
          if (journalRaw === null) throw new Error(STORAGE_UNAVAILABLE);
          // Raw bytes may include private data. This is an explicit user action,
          // not part of normal backups or analytics.
          const bundle = { format: 'dansik-restore-recovery', version: 1, recordsRaw: localStorage.getItem(STATE_KEY), prefsRaw: localStorage.getItem(PREFS_KEY), journalRaw };
          triggerDownload(`dansik-restore-recovery-${new Date().toLocaleDateString('sv-SE')}.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8');
          return { ok: true, exported: true, backupScope: 'restore-recovery' };
        });
      }
      if (payload.type === 'resolve-restore-conflict') {
        if (payload.confirm !== true) throw new TypeError('입력 형식이 올바르지 않습니다.');
        return await runExclusive(() => {
          const journalRaw = localStorage.getItem(RESTORE_JOURNAL_KEY);
          if (journalRaw === null) throw new Error(STORAGE_UNAVAILABLE);
          // The explicit choice keeps both current data entries unchanged and
          // archives the original journal before removing the write barrier.
          localStorage.setItem(RESTORE_JOURNAL_KEY + ':recovery:' + newId(), journalRaw);
          localStorage.removeItem(RESTORE_JOURNAL_KEY);
          restoreRecoveryNeeded = false;
          storedPrefs = undefined; storedState = undefined;
          refreshStorage(); broadcast();
          return snapshot();
        });
      }
      if (payload.type === 'apply-update') {
        if (pendingWrites > 0 || document.querySelector('dialog[open]')) return { ok: false, error: I.lang === 'en' ? 'Save or close the open form first.' : '열린 창을 저장하거나 닫은 뒤 적용해 주세요.' };
        if (document.body.dataset.pwaUpdateReady !== 'true') return { ok: false, error: I.lang === 'en' ? 'No update is ready.' : '준비된 업데이트가 없어요.' };
        location.reload();
        return { ok: true };
      }
      if (payload.type === 'settings' && checkPatch(payload.patch, SETTINGS_KEYS).notifications === true
          && 'Notification' in window && Notification.permission === 'default') {
        // Don't hold the storage lock while waiting for a user to answer a browser prompt.
        try { await Notification.requestPermission(); } catch (_) {}
      }
      const picked = payload.type === 'import-preview' ? await pickFileText() : null;
      const run = locked => {
        let recovered;
        try {
          recovered = checkRestoreJournal(locked);
        } catch (error) {
          broadcast();
          if (payload.type !== 'load') throw error;
          return snapshot();
        }
        if (refreshStorage() || recovered) broadcast();
        if (storageUnavailable && MUTATIONS.has(payload.type)) throw new Error(STORAGE_UNAVAILABLE);
        return execute(payload, picked);
      };
      if (MUTATIONS.has(payload.type)) {
        pendingWrites += 1;
        try { return await runExclusive(() => run(true)); }
        finally { pendingWrites -= 1; }
      }
      if (['load', 'import-preview', 'export', 'export-settings-recovery'].includes(payload.type)) return await runRead(run);
      return run(false);
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
    runRead(locked => {
      try {
        const recovered = checkRestoreJournal(locked);
        if (refreshStorage() || recovered) broadcast();
      } catch (_) { broadcast(); }
    }).catch(() => {
      try { if (localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) { restoreRecoveryNeeded = true; broadcast(); } } catch (_) { /* storage is unavailable */ }
    });
  }
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === STATE_KEY || event.key === PREFS_KEY || event.key === RESTORE_JOURNAL_KEY) syncExternalStorage();
  });
  window.addEventListener('focus', syncExternalStorage);
  window.addEventListener('pageshow', syncExternalStorage);

  const WINDOW_NOTICE_KEY = 'dansik:window-notified:v1';
  const WINDOW_NOTICE_GRACE_MS = 10 * 60 * 1000; // a resumed phone must not announce a window that ended long ago
  const noticeFailures = new Map();
  // Android Chrome rejects new Notification(); the service worker registration works there and in iOS home-screen apps.
  async function showNotice(title, body, tag) {
    const options = { body, icon: 'app-icon.png', tag, silent: true };
    try {
      const registration = navigator.serviceWorker && await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(reject, 1500))]);
      if (registration && registration.showNotification) { await registration.showNotification(title, options); return true; }
    } catch (_) { /* try the page API below */ }
    try { new Notification(title, options); return true; } catch (_) { return false; }
  }
  function readWindowNotified() { try { return JSON.parse(localStorage.getItem(WINDOW_NOTICE_KEY)) || {}; } catch (_) { return {}; } }
  function clockText(at) { const p = Core.tzParts(at, prefs.timeZone); return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0'); }
  // Runs inside the storage lock, so it only reads and writes synchronously; showing happens afterwards.
  function dueNotices(now) {
    const notices = [];
    if (storageUnavailable || stateUnreadable || !state.settings.notifications) return notices;
    const permitted = 'Notification' in window && Notification.permission === 'granted';
    const I = activeI18n();
    const meal = state.settings.goalEnabled && state.events.length ? Core.timerMeal(state, now, prefs) : null;
    if (meal && state.events[0].at <= meal.at) {
      const key = `${meal.id}:${meal.at}:${state.settings.goalHours}`;
      if (Core.getTimer(state, now, prefs).reached && state.notifiedKey !== key) {
        const previous = state.notifiedKey;
        state = saveStoredState({ ...state, notifiedKey: key });
        // The key stays only when the notice was shown or could not be shown at all (no permission).
        if (permitted) notices.push({ tag: 'goal:' + key, title: I.t('notify.title'), body: I.t('notify.body', { h: state.settings.goalHours }),
          undo: () => { if (state.notifiedKey === key) state = saveStoredState({ ...state, notifiedKey: previous }); } });
      }
    }
    const eating = Core.eatingWindow(state.settings, now, prefs.timeZone);
    if (eating) {
      const done = readWindowNotified();
      const first = !done.open && !done.close; // enabling a plan must not fire a notice by itself
      const before = JSON.stringify(done);
      for (const [kind, at] of [['open', eating.lastOpenAt], ['close', eating.lastCloseAt]]) {
        if (!at || done[kind] === String(at)) continue;
        const previous = done[kind];
        done[kind] = String(at);
        if (first || !permitted || now - at > WINDOW_NOTICE_GRACE_MS) continue;
        const open = kind === 'open';
        notices.push({ tag: 'window:' + kind + ':' + at,
          title: I.t(open ? 'notify.windowOpenTitle' : 'notify.windowCloseTitle'),
          body: open ? I.t('notify.windowOpenBody', { start: clockText(eating.lastOpenAt), end: clockText(eating.lastOpenAt + eating.eatHours * 3600000) }) : I.t('notify.windowCloseBody', { next: clockText(eating.nextOpenAt) }),
          undo: () => { const latest = readWindowNotified(); if (latest[kind] === String(at)) { if (previous === undefined) delete latest[kind]; else latest[kind] = previous; localStorage.setItem(WINDOW_NOTICE_KEY, JSON.stringify(latest)); } } });
      }
      if (JSON.stringify(done) !== before) localStorage.setItem(WINDOW_NOTICE_KEY, JSON.stringify(done));
    }
    return notices;
  }
  setInterval(() => {
    runExclusive(() => {
      let recovered;
      try { recovered = checkRestoreJournal(true); }
      catch (_) { broadcast(); return []; }
      if (refreshStorage() || recovered) broadcast();
      return dueNotices(Date.now());
    }).then(async notices => {
      for (const notice of notices || []) {
        if (await showNotice(notice.title, notice.body, notice.tag)) continue;
        // Retry a failed notice three more times before settling for "missed".
        const failures = noticeFailures.get(notice.tag) || 0;
        noticeFailures.set(notice.tag, failures + 1);
        if (failures < 3) await runExclusive(notice.undo).catch(() => {});
      }
    }).catch(() => {
      try { if (localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) { restoreRecoveryNeeded = true; broadcast(); } } catch (_) { /* storage is unavailable */ }
    });
  }, 15000);

  startAutoSync();
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
            window.dispatchEvent(new Event('dansik:update-ready'));
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
