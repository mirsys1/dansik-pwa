(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingSync = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // The sync code is 25 random symbols (125 bits). It never leaves the device: HKDF turns it into
  // (1) the record id, (2) a bearer token, (3) an AES-GCM key, so the server only ever sees ciphertext.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_LENGTH = 25;
  const SALT = 'dansik-sync-v1';
  const enc = new TextEncoder();

  function webCrypto() {
    const api = globalThis.crypto;
    if (!api || !api.subtle || !api.getRandomValues) throw new Error('SYNC_UNSUPPORTED');
    return api;
  }
  const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  function toBase64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }
  function fromBase64(text) {
    const raw = atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function generateCode() {
    const bytes = webCrypto().getRandomValues(new Uint8Array(CODE_LENGTH));
    return formatCode(Array.from(bytes, (b) => ALPHABET[b & 31]).join('')); // 256 is a multiple of 32: no modulo bias
  }
  function formatCode(symbols) { return symbols.match(/.{5}/g).join('-'); }
  // Accepts lowercase, spaces and hyphens; returns the 25 symbols or null.
  function normalizeCode(text) {
    if (typeof text !== 'string') return null;
    const symbols = text.toUpperCase().replace(/[\s-]/g, '');
    return symbols.length === CODE_LENGTH && [...symbols].every((c) => ALPHABET.includes(c)) ? symbols : null;
  }

  async function deriveKeys(code) {
    const symbols = normalizeCode(code);
    if (!symbols) throw new TypeError('SYNC_CODE');
    const { subtle } = webCrypto();
    const base = await subtle.importKey('raw', enc.encode(symbols), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT), info: enc.encode(info) });
    const id = hex(await subtle.deriveBits(params('id'), base, 128));
    const token = hex(await subtle.deriveBits(params('token'), base, 256));
    const key = await subtle.deriveKey(params('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { id, token, key };
  }

  async function encrypt(key, doc) {
    const api = webCrypto();
    const { subtle } = api;
    const iv = api.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(SALT) }, key, enc.encode(JSON.stringify(doc)));
    return JSON.stringify({ v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) });
  }
  async function decrypt(key, envelopeText) {
    try {
      const envelope = JSON.parse(envelopeText);
      if (envelope.v !== 1) throw new Error('version');
      const plain = await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: enc.encode(SALT) }, key, fromBase64(envelope.ct));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch { throw new Error('SYNC_DECRYPT'); }
  }

  // ───────── error messages (Korean; English lives in i18n.js errEn)
  const ERRORS = {
    SYNC_UNAVAILABLE: '이 환경에서는 동기화를 사용할 수 없어요.',
    SYNC_CODE: '동기화 코드를 확인해 주세요. 25자리 코드예요.',
    SYNC_AUTH: '동기화 코드가 맞지 않아요. 코드를 확인해 주세요.',
    SYNC_DECRYPT: '동기화 코드가 맞지 않아 데이터를 열 수 없어요.',
    SYNC_NOT_FOUND: '이 코드로 저장된 동기화 데이터가 없어요. 코드를 확인해 주세요.',
    SYNC_NETWORK: '동기화 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    SYNC_BUSY: '다른 변경과 겹쳐 동기화를 마치지 못했어요. 다시 시도해 주세요.',
    SYNC_FORMAT: '동기화 데이터 형식이 올바르지 않아요.',
    SYNC_STORAGE: '동기화 상태를 저장하지 못했어요. 저장 공간을 확인해 주세요.',
    SYNC_BLOCKED: '저장된 기록이나 설정을 읽을 수 없어 동기화할 수 없어요. 먼저 복구해 주세요.',
    SYNC_OFF: '동기화가 꺼져 있어요.',
    SYNC_ON: '이미 동기화가 켜져 있어요.'
  };
  const error = (code) => new Error(ERRORS[code] || ERRORS.SYNC_NETWORK);
  // Internal SYNC_* codes become readable messages; anything else (validation, storage) passes through.
  function mapError(failure) {
    const code = String(failure && failure.message);
    return /^SYNC_[A-Z_]+$/.test(code) ? error(code) : failure;
  }

  // ───────── the synced document
  // Meals by id, weights by date, activity samples by source+id, and two small groups kept whole.
  // Device preferences (language, time zone, colors, tray, timer pause) stay on the device.
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value === undefined ? null : value);
  }
  const equal = (a, b) => stable(a) === stable(b);

  function pick(source, keys) {
    const out = {};
    for (const key of keys) if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
    return out;
  }
  const SETTING_KEYS = ['goalHours', 'goalEnabled', 'plan', 'windowStart'];
  const BODY_KEYS = ['sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'activitySource', 'energyMode'];

  function snapshot(state, prefs) {
    const doc = { v: 1, meals: {}, weights: {}, activity: {}, groups: { settings: pick(state.settings, SETTING_KEYS), body: pick(prefs, BODY_KEYS) } };
    for (const event of state.events) doc.meals[event.id] = event;
    for (const item of state.weightMeasurements || []) doc.weights[item.date] = { weightKg: item.weightKg };
    for (const sample of prefs.activitySamples || []) doc.activity[sample.source + '\u0000' + sample.id] = sample;
    return doc;
  }
  function emptyDoc() { return { v: 1, meals: {}, weights: {}, activity: {}, groups: {} }; }
  function checkDoc(doc) {
    const ok = doc && typeof doc === 'object' && doc.v === 1 && ['meals', 'weights', 'activity', 'groups'].every((k) => doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k]));
    if (!ok) throw new Error('SYNC_FORMAT');
    return doc;
  }

  // Three-way merge by key. `base` is the document both sides agreed on after the last sync (empty on the first sync).
  // A side that did not change an item takes the other side's version (including its deletion); an item
  // edited on one side and deleted on the other is kept; two different edits keep this device's.
  function mergeMap(base, local, remote, stats, firstSyncRemoteWins) {
    const out = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const b = base[key], l = local[key], r = remote[key];
      let value;
      if (equal(l, r)) value = l;
      else if (equal(l, b)) { value = r; stats[r === undefined ? 'removed' : l === undefined ? 'added' : 'updated'] += 1; }
      else if (equal(r, b)) { value = l; stats.sent += 1; }
      else if (l === undefined) { value = r; stats.updated += 1; }
      else if (r === undefined) { value = l; stats.sent += 1; }
      else { value = firstSyncRemoteWins ? r : l; stats.conflicts += 1; if (firstSyncRemoteWins) stats.updated += 1; }
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  function merge(baseDoc, localDoc, remoteDoc) {
    const base = baseDoc ? checkDoc(baseDoc) : emptyDoc(), local = checkDoc(localDoc), remote = checkDoc(remoteDoc);
    const first = !baseDoc;
    const stats = { added: 0, updated: 0, removed: 0, sent: 0, conflicts: 0 };
    const doc = { v: 1 };
    for (const part of ['meals', 'weights', 'activity']) doc[part] = mergeMap(base[part], local[part], remote[part], stats, false);
    // On a device's first sync the group from the other device wins, so a fresh phone does not overwrite your goal with defaults.
    doc.groups = mergeMap(base.groups, local.groups, remote.groups, stats, first);
    return { doc, stats, changedLocal: !equal(doc, local), changedRemote: !equal(doc, remote) };
  }

  // Builds the next state/prefs from a merged document. Callers validate the result with their own writers.
  function apply(state, prefs, doc, helpers) {
    const { Core, Activity } = helpers;
    checkDoc(doc);
    const next = Core.clone(state);
    next.events = Object.values(doc.meals).sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : 1));
    if (Object.keys(doc.weights).length || state.weightMeasurements !== undefined) {
      next.weightMeasurements = Object.entries(doc.weights).map(([date, value]) => ({ date, weightKg: value.weightKg }));
    }
    const settings = doc.groups.settings;
    if (settings) {
      for (const key of SETTING_KEYS) delete next.settings[key];
      Object.assign(next.settings, pick(settings, SETTING_KEYS));
      if (next.settings.goalHours === undefined) next.settings.goalHours = state.settings.goalHours;
      if (next.settings.goalEnabled === undefined) next.settings.goalEnabled = state.settings.goalEnabled;
    }
    const nextPrefs = { ...prefs };
    const samples = Object.values(doc.activity);
    nextPrefs.activitySamples = Activity ? Activity.normalizeSamples(samples) : [];
    if (doc.groups.body) {
      const body = pick(doc.groups.body, BODY_KEYS);
      Object.assign(nextPrefs, Core.normalizeProfile({ ...prefs, ...body }));
      nextPrefs.activitySource = body.activitySource || '';
      nextPrefs.energyMode = body.energyMode === 'activity' ? 'activity' : 'estimate';
    }
    // Energy from activity needs one selected source that still has data.
    if (nextPrefs.energyMode === 'activity' && !nextPrefs.activitySamples.some((s) => s.source === nextPrefs.activitySource)) {
      nextPrefs.energyMode = 'estimate'; nextPrefs.activitySource = '';
    }
    if (nextPrefs.activitySource && !nextPrefs.activitySamples.some((s) => s.source === nextPrefs.activitySource)) nextPrefs.activitySource = '';
    // The running timer follows a meal; if that meal was removed elsewhere, restart the timer control.
    if (nextPrefs.timerAnchorId && !next.events.some((e) => e.id === nextPrefs.timerAnchorId)) {
      Object.assign(nextPrefs, { timerAnchorId: null, timerMealId: null, timerPausedAt: null, timerPausedMs: 0, timerReset: false });
    }
    return { state: next, prefs: nextPrefs };
  }

  // One sync round. The caller supplies I/O so the same loop runs in the browser and in Electron.
  //   io.readLocal() -> { doc, token }       token changes whenever local data changes (compared before applying)
  //   io.applyLocal(mergedDoc, token) -> Promise<boolean>   false when local data changed meanwhile
  //   io.loadBase() / io.saveBase({ doc, rev }) / io.fetch(path, init)
  async function syncOnce(keys, io, options = {}) {
    const attempts = options.attempts || 4;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const local = await io.readLocal();
      const stored = await io.loadBase();
      const response = await io.fetch('GET');
      let remoteDoc = null, rev = 0;
      if (response.status === 200) {
        const body = await response.json();
        remoteDoc = await decrypt(keys.key, body.blob);
        rev = body.rev;
      } else if (response.status === 404) { if (options.requireRemote) throw new Error('SYNC_NOT_FOUND'); remoteDoc = null; }
      else if (response.status === 401) throw new Error('SYNC_AUTH');
      else throw new Error('SYNC_NETWORK');
      const baseDoc = stored && stored.doc ? stored.doc : null;
      const result = remoteDoc ? merge(baseDoc, local.doc, remoteDoc) : { doc: local.doc, stats: { added: 0, updated: 0, removed: 0, sent: 0, conflicts: 0 }, changedLocal: false, changedRemote: true };
      if (result.changedLocal) {
        const applied = await io.applyLocal(result.doc, local.token);
        if (!applied) { lastError = new Error('SYNC_BUSY'); continue; }
      }
      if (result.changedRemote) {
        const put = await io.fetch('PUT', { rev, blob: await encrypt(keys.key, result.doc) });
        if (put.status === 412) { lastError = new Error('SYNC_CONFLICT'); continue; }
        if (put.status === 401) throw new Error('SYNC_AUTH');
        if (put.status !== 200 && put.status !== 201) throw new Error('SYNC_NETWORK');
        rev = (await put.json()).rev;
      }
      await io.saveBase({ doc: result.doc, rev, at: Date.now() });
      return { ...result, rev, pushed: result.changedRemote };
    }
    throw lastError || new Error('SYNC_BUSY');
  }

  return { ERRORS, error, mapError, ALPHABET, CODE_LENGTH, generateCode, normalizeCode, formatCode, deriveKeys, encrypt, decrypt, snapshot, emptyDoc, merge, apply, syncOnce, equal };
});
