'use strict';

// Shared portable-backup contract.  Device controls (tray, autostart and the
// timer) and credentials intentionally never appear here.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingPortableBackup = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function () {
  const REQUIRED_PREF_KEYS = ['firstRunDone', 'language', 'timeZone', 'colorTheme', 'timerGradient', 'sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'activitySamples', 'activitySource', 'energyMode'];
  // These were added after the first full-backup format.  Their absence must
  // preserve the current setting when restoring an older portable file.
  const OPTIONAL_PREF_KEYS = ['backupReminder', 'profileConfirmed', 'backupReminderStartedAt'];
  const PORTABLE_PREF_KEYS = [...REQUIRED_PREF_KEYS, ...OPTIONAL_PREF_KEYS];

  function portablePrefs(source, clone = value => value) {
    const result = {};
    for (const key of REQUIRED_PREF_KEYS) if (source[key] !== undefined) result[key] = clone(source[key]);
    for (const key of OPTIONAL_PREF_KEYS) if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) result[key] = clone(source[key]);
    return result;
  }

  function parsePortableBackup(raw, { Core, Activity, languages }) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('입력 형식이 올바르지 않습니다.');
    if (!Object.prototype.hasOwnProperty.call(raw, 'portableBackup')) return null;
    const portable = raw.portableBackup;
    const invalid = () => { throw new TypeError('입력 형식이 올바르지 않습니다.'); };
    if (!portable || portable.format !== 'dansik-full' || portable.version !== 1 || !portable.prefs || typeof portable.prefs !== 'object' || Array.isArray(portable.prefs)) invalid();
    const incoming = portable.prefs;
    if (REQUIRED_PREF_KEYS.some(key => !Object.prototype.hasOwnProperty.call(incoming, key))) invalid();
    if (typeof incoming.firstRunDone !== 'boolean' || !languages.includes(incoming.language) || !Core.validTimeZone(incoming.timeZone) || !Core.validColorTheme(incoming.colorTheme) || !Core.validTimerGradient(incoming.timerGradient)) invalid();
    if (!['male', 'female'].includes(incoming.sex) || !Number.isInteger(incoming.age) || incoming.age < 10 || incoming.age > 120 || !Number.isFinite(incoming.heightCm) || incoming.heightCm < 100 || incoming.heightCm > 250 || !Number.isFinite(incoming.weightKg) || incoming.weightKg < 25 || incoming.weightKg > 300 || !Object.prototype.hasOwnProperty.call(Core.ACTIVITY_MULTIPLIERS, incoming.activityLevel)) invalid();
    if (!Array.isArray(incoming.activitySamples) || (!Activity && incoming.activitySamples.length)) invalid();
    let samples;
    try { samples = Activity ? Activity.normalizeSamples(incoming.activitySamples) : []; } catch (_) { invalid(); }
    if (typeof incoming.activitySource !== 'string' || incoming.activitySource.length > 200 || (incoming.activitySource && !samples.some(sample => sample.source === incoming.activitySource)) || !['estimate', 'activity'].includes(incoming.energyMode) || (incoming.energyMode === 'activity' && !incoming.activitySource)) invalid();
    if ('backupReminder' in incoming && typeof incoming.backupReminder !== 'boolean') invalid();
    if ('profileConfirmed' in incoming && typeof incoming.profileConfirmed !== 'boolean') invalid();
    if ('backupReminderStartedAt' in incoming && incoming.backupReminderStartedAt !== null && (!Number.isSafeInteger(incoming.backupReminderStartedAt) || incoming.backupReminderStartedAt <= 0)) invalid();
    return { ...portablePrefs(incoming, Core.clone), profileConfirmed: incoming.profileConfirmed === true, activitySamples: samples };
  }

  return { REQUIRED_PREF_KEYS, OPTIONAL_PREF_KEYS, PORTABLE_PREF_KEYS, portablePrefs, parsePortableBackup };
});
