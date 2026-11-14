'use strict';
const C = window.FastingCore;
const I18N = window.FastingI18n;
const $ = id => document.getElementById(id);
// iOS can emit compatibility mouse events after touch and retain :focus-visible
// when a dialog restores focus. Keep touch mode until real keyboard navigation.
let lastTouchInput = -Infinity;
document.addEventListener('touchstart', () => {
  lastTouchInput = performance.now();
  document.body.classList.add('touch-focus');
}, { capture: true, passive: true });
document.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    lastTouchInput = performance.now();
    document.body.classList.add('touch-focus');
  } else if (!(event.pointerType === 'mouse' && document.body.classList.contains('touch-focus') &&
      (event.sourceCapabilities?.firesTouchEvents || performance.now() - lastTouchInput < 1000))) {
    document.body.classList.remove('touch-focus');
  }
}, true);
document.addEventListener('keydown', event => {
  const editing = event.target instanceof Element && event.target.matches('input, textarea, select, [contenteditable="true"]');
  const navigationKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key);
  if (event.key === 'Tab' || (!editing && navigationKey) || event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(event.key)) {
    document.body.classList.remove('touch-focus');
  }
}, true);
const MEALS = { breakfast: { icon: 'sunrise' }, lunch: { icon: 'sun' }, dinner: { icon: 'moon' }, snack: { icon: 'cup' } };
// Korean until the first snapshot says otherwise; translateDom() swaps the static text.
let L = I18N.create('ko');
const t = (key, params) => L.t(key, params);
const mealName = type => t(`meal.${type}`);
const paths = {
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3M18 5l2-2"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2"/>',
  chart: '<path d="M4 3v17h17M8 16v-5M13 16V7M18 16V4"/>',
  pin: '<path d="M8 3h8l-1 4v4l3 3v2H6v-2l3-3V7L8 3ZM12 16v5"/>',
  settings: '<polygon points="10.222,4.868 10.706,2.791 13.294,2.791 13.778,4.868 15.786,5.700 17.597,4.573 19.427,6.403 18.300,8.214 19.132,10.222 21.209,10.706 21.209,13.294 19.132,13.778 18.300,15.786 19.427,17.597 17.597,19.427 15.786,18.300 13.778,19.132 13.294,21.209 10.706,21.209 10.222,19.132 8.214,18.300 6.403,19.427 4.573,17.597 5.700,15.786 4.868,13.778 2.791,13.294 2.791,10.706 4.868,10.222 5.700,8.214 4.573,6.403 6.403,4.573 8.214,5.700"/><circle cx="12" cy="12" r="3.1"/>',
  moon: '<path d="M8.940 3.753 A8.5 8.5 0 1 0 19.247 14.060 A7.4 7.4 0 0 1 8.940 3.753 Z"/>',
  sunrise: '<path d="M3 17h18M4 21h16M7 17a5 5 0 0 1 10 0M12 2v3M4 7l2 2M20 7l-2 2M2 12h2M20 12h2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  cup: '<path d="M5 8h12v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM17 9h2a3 3 0 1 1 0 6h-2M8 2v3M12 1v4M16 2v3"/>',
  leaf: '<path d="M20 3c-8-1-16 2-16 10a6 6 0 0 0 6 6c8 0 11-8 10-16ZM4 21 15 10M7 17v-5M10 14h5"/>',
  mini: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M11 11h7v6h-7z"/>',
  expand: '<path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`; }
function icons(scope = document) { scope.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
function esc(text) { return String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function tz() { return prefs && prefs.timeZone && prefs.timeZone !== 'auto' ? prefs.timeZone : undefined; }
function tzOpt() { const z = tz(); return z ? { timeZone: z } : {}; }
function time(at) { return new Date(at).toLocaleTimeString(L.locale, { hour: '2-digit', minute: '2-digit', hour12: L.lang === 'en', ...tzOpt() }); }
function day(at) { return new Date(at).toLocaleDateString(L.locale, { month: 'long', day: 'numeric', weekday: 'short', ...tzOpt() }); }
function dateTime(at) { return `${day(at)} ${time(at)}`; }
function intervalTime(at) {

  const p = C.tzParts(at, tz()), nowP = C.tzParts(Date.now(), tz());
  const year = p.year === nowP.year ? '' : `${p.year}.`;
  return `${year}${p.month}.${String(p.day).padStart(2, '0')} ${time(at)}`;
}
function intervalPoint(at) {

  const full = t('date.year', { y: C.tzParts(at, tz()).year, rest: dateTime(at) });
  return `<time datetime="${new Date(at).toISOString()}" title="${esc(full)}" aria-label="${esc(full)}">${esc(intervalTime(at))}</time>`;
}
function localInput(at) { return C.formatLocalInput(at, tz()); }
function shortDuration(ms) { const minutes = Math.floor(ms / 60000); return t('dur.hm', { h: Math.floor(minutes / 60), m: minutes % 60 }); }
function kcalText(value, compact = false) { return t('timer.kcalValue', { kcal: new Intl.NumberFormat(L.locale, { maximumFractionDigits: compact ? 0 : 1, notation: compact && value >= 10000 ? 'compact' : 'standard' }).format(value) }); }
function fatTrendKey(elapsedMs) {
  const stage = C.getAutophagyStage(elapsedMs);
  return !stage.active ? 'effects.trendEmpty' : stage.stage > 0 ? 'effects.trendFat' : 'effects.trendMixed';
}
let state = C.defaultState();
let busy = false;
let editingId = null;
let editingSnapshot = null;
let settingsBaseline = null;
let providerDraftCommitted = false;
let mealStartsTimer = false;
let mealUseSaveTime = false;
const pendingMealEntries = [];
let drainingMealEntry = false;
let returnToMealAfterSettings = false;
let mealAutoType = false;
let mealDateDay = '';
let mealLastKey = '';
let mealExactPreset = null;
let mealBaseline = null;
let mealOpener = null;
let mealReturnIndex = 0;
let helpOpener = null;
let toastTimeout;
let historyLimit = 60;
let ready = false;
let lastActionError = '';
let windowInfo = null;
let theme = 'light';
let prefs = { tray: false, autoStart: false, firstRunDone: true, canAutoStart: false, autoStartActive: false, language: 'auto', timeZone: 'auto', colorTheme: 'sage', timerGradient: 'p05', sex: 'male', age: 35, heightCm: 170, weightKg: 68, activityLevel: 'light' };
function applyColorTheme(name) { document.body.dataset.colorTheme = C.validColorTheme(name) ? name : 'sage'; }
function applyTimerGradient(name) { document.body.dataset.timerGradient = C.validTimerGradient(name) ? name : 'p05'; }
let appInfo = { version: '' };
let pinBusy = false;
let effectOpener = null;
let fastingSelection = null;
let dailyCaloriesView = null;
let lastBackupAt = null;
function backupReminderBase() {
  if (lastBackupAt) return lastBackupAt;
  if (prefs.backupReminderStartedAt) return prefs.backupReminderStartedAt;
  return state.events.length ? state.events.reduce((earliest, event) => Math.min(earliest, event.at), state.events[0].at) : null;
}
let activityRecoveryNeeded = false;
let restoreRecoveryNeeded = false;
let backupReminderShown = false;

// Static text carries data-i18n (text), data-i18n-html (trusted catalog markup), data-i18n-text (first text node only)
// and data-i18n-attr ("attr=key;attr=key"). Dynamic text is written by render()/tick() through t().
function translateDom() {
  document.documentElement.lang = L.lang;
  document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-text]').forEach(el => {
    const node = [...el.childNodes].find(child => child.nodeType === 3 && child.nodeValue.trim());
    const text = t(el.dataset.i18nText);
    if (node) { const [, lead, , tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.nodeValue); node.nodeValue = lead + text + tail; } else el.prepend(text);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(pair => { const [attr, key] = pair.split('='); el.setAttribute(attr, t(key)); }));
  document.querySelectorAll('[data-goal]').forEach(el => { el.textContent = t('goal.hours', { h: el.dataset.goal }); });
  document.querySelectorAll('[data-goal-preset]').forEach(el => { el.textContent = t('goal.hours', { h: el.dataset.goalPreset }); });
  document.querySelectorAll('[data-meal]').forEach(button => { const key = Object.keys(MEAL_KEYS).find(k => MEAL_KEYS[k] === button.dataset.meal); button.title = t('meal.hint', { meal: mealName(button.dataset.meal), key }); });
  if (windowInfo) applyWindowInfo(windowInfo);
  window.dispatchEvent(new Event('dansik:language-changed'));
}
function placeToast(page = document.body.dataset.page || 'timer') {
  const element = $('toast');
  const mini = document.body.classList.contains('mini');
  const parent = mini ? document.querySelector('.mini-content') : page === 'timer' ? document.querySelector('#page-timer .meal-panel') : $(`page-${page}`);
  if (parent && element.parentElement !== parent) {
    if (mini) parent.querySelector(':scope > small').before(element);
    else parent.querySelector('.page-heading, .panel-header').after(element);
  }
  document.body.classList.toggle('has-toast', !element.hidden);
  fitMiniToast();
}
let miniToastFrame = 0;
function fitMiniToast() {
  cancelAnimationFrame(miniToastFrame);
  if (!document.body.classList.contains('mini') || document.body.classList.contains('is-pwa')) return;
  miniToastFrame = requestAnimationFrame(() => {
    const panel = document.querySelector('.mini-content');
    const height = $('toast').hidden ? 0 : Math.ceil(panel.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).paddingBottom || 0));
    window.desktop.action({ type: 'mini-content-height', height }).catch(() => {});
  });
}
function hideToast() { $('toast').hidden = true; document.body.classList.remove('has-toast'); fitMiniToast(); }
function toast(message, undo = false) { $('toast-message').textContent = message; $('undo-button').hidden = !undo; $('toast').hidden = false; placeToast(); clearTimeout(toastTimeout); toastTimeout = setTimeout(hideToast, undo ? 15000 : 5000); }
function showWarning(message) { $('warning').textContent = message || ''; $('warning').hidden = !message; }
function applyWindowInfo(info) {
  if(!info)return;
  windowInfo=info;
  document.body.classList.toggle('has-window-chrome',!!info.overlay);
  document.body.classList.toggle('mini',!!info.mini);
  placeToast();
  const button=$('pin-window');
  button.disabled=!ready||pinBusy||info.mini;
  button.setAttribute('aria-pressed',String(!!info.alwaysOnTop));
  button.setAttribute('aria-label',info.mini?t('pin.mini'):t('pin.label'));
  button.title=info.mini?t('pin.mini'):info.alwaysOnTop?t('pin.titleOff'):t('pin.titleOn');
}
function applySnapshot(snapshot) {
  state = snapshot.state;
  ready = true;
  if (snapshot.language && snapshot.language.resolved !== L.lang) { L = I18N.create(snapshot.language.resolved); translateDom(); }
  applyWindowInfo(snapshot.window);
  theme = snapshot.theme || state.settings.theme;
  if (snapshot.prefs) prefs = snapshot.prefs;
  if (Object.hasOwn(snapshot, 'lastBackupAt')) lastBackupAt = snapshot.lastBackupAt;
  activityRecoveryNeeded = Boolean(snapshot.settingsRecoveryNeeded || snapshot.activityRecoveryNeeded);
  restoreRecoveryNeeded = Boolean(snapshot.restoreRecoveryNeeded);
  $('restore-recovery-shortcut').hidden = !restoreRecoveryNeeded;
  if (snapshot.app) appInfo = snapshot.app;
  document.body.dataset.theme = theme;
  applyColorTheme(prefs.colorTheme);
  applyTimerGradient(prefs.timerGradient);
  $('theme-button').setAttribute('aria-label', theme === 'light' ? t('theme.toDark') : t('theme.toLight'));
  $('save-status').textContent = t('footer.saved', { time: time(Date.now()) });
  if (snapshot.warning || document.body.classList.contains('is-pwa')) showWarning(snapshot.warning);
  if (snapshot.canUndo === false) $('undo-button').hidden = true;
  if ($('meal-dialog').open) updateMealDateControls();
  render();
  maybeWelcome();
  if (pendingMealEntries.length && !drainingMealEntry) setTimeout(drainPendingMealEntry, 0);
  if (!backupReminderShown && document.body.classList.contains('is-pwa') && prefs.backupReminder && backupReminderBase() && Date.now() - backupReminderBase() >= 30 * 86400000) {
    backupReminderShown = true;
    toast(t('settings.backupDue'));
  }
}
let welcomeStep = 1, welcomePlan = '16:8', welcomeShown = false;
function maybeWelcome() {
  // ponytail: web app only; the Windows app keeps its current first launch (its smoke tests drive an empty profile).
  if (welcomeShown || !ready || prefs.firstRunDone !== false || state.events.length || !document.body.classList.contains('is-pwa') || document.querySelector('dialog[open]')) return;
  welcomeShown = true;
  const profile = C.normalizeProfile(prefs);
  $('welcome-sex').value = profile.sex; $('welcome-activity').value = profile.activityLevel;
  ['age', 'height', 'weight'].forEach(id => { $(`welcome-${id}`).value = ''; });
  $('welcome-age').placeholder = profile.age; $('welcome-height').placeholder = profile.heightCm; $('welcome-weight').placeholder = profile.weightKg;
  showWelcomeStep(1);
  $('welcome-dialog').showModal();
}
function showWelcomeStep(step) {
  welcomeStep = step;
  document.querySelectorAll('#welcome-dialog .welcome-step').forEach(section => { section.hidden = Number(section.dataset.step) !== step; });
  document.querySelectorAll('[data-welcome-plan]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.welcomePlan === welcomePlan)));
  $('welcome-window').hidden = !welcomePlan;
  $('welcome-progress').textContent = t('welcome.step', { n: step });
  $('welcome-back').hidden = step === 1;
  $('welcome-next').textContent = step === 3 ? t('welcome.done') : step === 2 && !welcomeBodyEntered() ? t('welcome.skipBody') : t('welcome.next');
  $('welcome-error').textContent = '';
}
function welcomeBodyEntered() { return ['age', 'height', 'weight'].some(id => $(`welcome-${id}`).value !== ''); }
async function finishWelcome(save) {
  $('welcome-dialog').close();
  const prefsPatch = { firstRunDone: true };
  if (save) {
    if (welcomeBodyEntered()) {
      const profile = C.normalizeProfile(prefs);
      Object.assign(prefsPatch, { sex: $('welcome-sex').value, activityLevel: $('welcome-activity').value,
        age: $('welcome-age').value ? $('welcome-age').valueAsNumber : profile.age,
        heightCm: $('welcome-height').value ? $('welcome-height').valueAsNumber : profile.heightCm,
        weightKg: $('welcome-weight').value ? $('welcome-weight').valueAsNumber : profile.weightKg,
        profileConfirmed: ['age', 'height', 'weight'].every(id => $(`welcome-${id}`).value !== '') });
    }
    prefsPatch.backupReminder = $('welcome-backup').checked;
    if (welcomePlan) await action({ type: 'settings', patch: { plan: welcomePlan, windowStart: C.validWindowStart($('welcome-start').value) ? $('welcome-start').value : C.DEFAULT_WINDOW_START } }, null, false);
  }
  await action({ type: 'prefs', patch: prefsPatch }, save ? t('welcome.saved') : null, false);
}
async function action(payload, message, undo = true) {
  if (busy) return null;
  busy = true;
  lastActionError = '';
  document.querySelectorAll('[data-meal],#save-meal,#confirm-delete').forEach(button => { button.disabled = true; });
  try {
    const result = await window.desktop.action(payload);
    if (!result.ok) {
      if (result.debounced) { toast(result.error, undo && result.canUndo); return null; }
      throw new Error(result.error || t('error.saveFallback'));
    }
    if (result.state) applySnapshot(result);
    if (message) toast(message, undo && result.canUndo);
    return result;
  } catch (error) {
    lastActionError = L.err(error);
    $('save-status').textContent = t('footer.notSaved');
    toast(lastActionError, false);
    return null;
  } finally {
    busy = false;
    document.querySelectorAll('[data-meal],#save-meal,#confirm-delete').forEach(button => { button.disabled = !ready; });
    if (pendingMealEntries.length && !drainingMealEntry) setTimeout(drainPendingMealEntry, 0);
  }
}
async function openMealForType(meal) {
  if (!ready || busy || !C.TYPES.includes(meal) || document.querySelector('dialog[open]')) return null;
  if (document.body.classList.contains('mini')) {
    const expanded = await action({ type: 'mini' }, null, false);
    const mini = expanded?.window?.mini ?? expanded?.mini;
    if (mini !== false) return null;
    document.body.classList.remove('mini');
  }
  if (document.querySelector('dialog[open]')) return null;
  openMeal(null, false, true);
  mealAutoType = false;
  mealUseSaveTime = true;
  $('meal-type').value = meal;
  $('meal-auto-hint').hidden = true;
  $('meal-when').open = false;
  updateMealWhenSummary();
  mealBaseline = mealDraftSignature();
  return true;
}
async function drainPendingMealEntry() {
  if (drainingMealEntry || !pendingMealEntries.length || !ready || busy || document.querySelector('dialog[open]')) return;
  drainingMealEntry = true;
  try {
    if (await openMealForType(pendingMealEntries[0])) pendingMealEntries.shift();
  } finally {
    // Failed window expansion keeps this request for the next safe drain.
    drainingMealEntry = false;
  }
}
const DIAL_MS = 24 * 3600000;
const TIMER_GRADIENTS = Object.freeze({
  p01: ['#a8cc91', '#38b76d', '#137d83'], p02: ['#a8cc91', '#2dcdb6', '#55ade4'],
  p03: ['#79b942', '#ffd34e', '#d8881c'], p04: ['#abc896', '#ff967b', '#bb5d48'],
  p05: ['#176b5a', '#26c6b4', '#314c93'], p06: ['#55b7b5', '#3b76d8', '#8759d9'],
  p07: ['#a7cb98', '#f481a6', '#a775d6'], p08: ['#236943', '#19cc69', '#efd27d']
});
// One-degree slices keep an angular gradient visually continuous while the DOM is rebuilt only when a palette changes.
const DIAL_SEGMENTS = 360;
const DIAL_SEGMENT_OVERLAP = Math.PI / 720;
let dialGradientName = '';
let dialGradientVisible = 0;
let timerGradientPreview = null;
let dialGradientProgress = 0;
let dialGradientActive = false;
const rgb = hex => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
function gradientColor(name, progress) {
  const colors = TIMER_GRADIENTS[name] || TIMER_GRADIENTS.p05;
  const scaled = Math.max(0, Math.min(1, progress)) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const fraction = scaled - index, from = rgb(colors[index]), to = rgb(colors[index + 1]);
  return `rgb(${from.map((value, position) => Math.round(value + (to[position] - value) * fraction)).join(',')})`;
}
function dialArc(start, end) {
  const point = angle => [180 + 170 * Math.cos(angle), 180 + 170 * Math.sin(angle)];
  const [x1, y1] = point(start), [x2, y2] = point(end);
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A 170 170 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}
function prepareDialGradient(name) {
  const selected = TIMER_GRADIENTS[name] ? name : 'p05';
  if (dialGradientName === selected) return;
  const group = $('dial-progress-gradient');
  group.innerHTML = Array.from({ length: DIAL_SEGMENTS }, (_, index) => {
    const start = index / DIAL_SEGMENTS * Math.PI * 2 - Math.PI / 2;
    // A slight forward overlap prevents anti-alias seams between adjacent SVG strokes (notably in WebKit).
    const end = (index + 1) / DIAL_SEGMENTS * Math.PI * 2 - Math.PI / 2 + DIAL_SEGMENT_OVERLAP;
    return `<path class="dial-progress-segment" data-dial-segment="${index}" d="${dialArc(start, end)}" stroke="${gradientColor(selected, (index + .5) / DIAL_SEGMENTS)}" hidden/>`;
  }).join('');
  dialGradientName = selected;
  dialGradientVisible = 0;
}
function selectedTimerGradient() {
  const value = timerGradientPreview || prefs.timerGradient;
  return C.validTimerGradient(value) ? value : 'p05';
}
function renderTimerGradientPreview(name = selectedTimerGradient()) {
  const colors = TIMER_GRADIENTS[name] || TIMER_GRADIENTS.p05;
  const preview = $('timer-gradient-preview');
  if (preview) preview.style.background = `linear-gradient(90deg, ${colors.join(', ')})`;
}
function discardTimerGradientPreview() {
  timerGradientPreview = null;
  applyTimerGradient(prefs.timerGradient);
  renderDialGradient(dialGradientProgress, dialGradientActive);
}
function renderDialGradient(progress, active) {
  dialGradientProgress = progress;
  dialGradientActive = active;
  const selected = selectedTimerGradient();
  prepareDialGradient(selected);
  const full = active ? Math.floor(Math.max(0, Math.min(1, progress)) * DIAL_SEGMENTS) : 0;
  const group = $('dial-progress-gradient');
  if (full > dialGradientVisible) for (let index = dialGradientVisible; index < full; index += 1) group.children[index].removeAttribute('hidden');
  if (full < dialGradientVisible) for (let index = full; index < dialGradientVisible; index += 1) group.children[index].setAttribute('hidden', '');
  dialGradientVisible = full;
  const partial = $('dial-progress-partial');
  const remainder = active ? progress * DIAL_SEGMENTS - full : 0;
  if (remainder > 0 && full < DIAL_SEGMENTS) {
    const start = full / DIAL_SEGMENTS * Math.PI * 2 - Math.PI / 2;
    const end = progress * Math.PI * 2 - Math.PI / 2;
    partial.setAttribute('d', dialArc(start, end));
    partial.setAttribute('stroke', gradientColor(selected, (full + remainder / 2) / DIAL_SEGMENTS));
    partial.removeAttribute('hidden');
  } else partial.setAttribute('hidden', '');
  const current = gradientColor(selected, active ? progress : 0);
  document.querySelector('.dial-wrap').style.setProperty('--timer-gradient-current', current);
}
const STAGE_COLORS = [[0, [127, 157, 107]], [12, [95, 160, 138]], [16, [63, 155, 176]], [24, [79, 127, 208]], [36, [122, 98, 200]], [48, [176, 72, 159]]];
function stageColor(elapsedMs) {
  const h = elapsedMs == null ? 0 : elapsedMs / 3600000;
  let i = STAGE_COLORS.length - 1;
  while (i > 0 && h < STAGE_COLORS[i][0]) i--;
  const a = STAGE_COLORS[i], b = STAGE_COLORS[Math.min(i + 1, STAGE_COLORS.length - 1)];
  const f = b[0] === a[0] ? 0 : Math.min(1, (h - a[0]) / (b[0] - a[0]));
  return `rgb(${a[1].map((v, k) => Math.round(v + (b[1][k] - v) * f)).join(',')})`;
}
function dailyEnergySnapshot(date, now) {
  const burned = window.FastingEnergy.forDay(date, prefs, now);
  const intake = C.foodCalorieSummary(state.events, burned.from, Math.min(burned.until, burned.to + 1));
  return { burned, intake, conflict: burned.calculationStatus === 'overlap-detected' };
}
function renderDailyCalories(now) {
  const minute = Math.floor(now / 60000);
  if (dailyCaloriesView?.minute === minute && dailyCaloriesView.prefs === prefs && dailyCaloriesView.events === state.events) return dailyCaloriesView;

  const snapshot = dailyEnergySnapshot(C.localDay(now, tz()), now);
  const { burned, intake, conflict } = snapshot;
  const intakeButton = $('intake-summary');
  const energyButton = $('energy-summary');
  const intakeAmount = intake.logged ? kcalText(intake.kcal) : t('dayEnergy.noIntake');
  const partialIntake = intake.logged > 0 && intake.missing > 0;
  const partialBurned = !conflict && burned.activeKcal != null && burned.activity?.excludedBoundary > 0;
  intakeButton.querySelector('.energy-label').textContent = t(partialIntake ? 'dayEnergy.homePartialIntake' : 'intake.label');
  $('intake-value').textContent = intake.logged ? kcalText(intake.kcal, true) : t('dayEnergy.noAmount');
  intakeButton.setAttribute('aria-label', t('intake.aria', { amount: partialIntake ? t('dayEnergy.partial', { kcal: intakeAmount }) : intakeAmount }));
  const burnedLabel = partialBurned ? 'dayEnergy.homePartialBurned'
    : !conflict && burned.activeKcal == null ? 'dayEnergy.homeBasal' : 'dayEnergy.burned';
  energyButton.querySelector('.energy-label').textContent = t(prefs.profileConfirmed === true ? burnedLabel : 'energy.homeDefault');
  $('goal-time').textContent = conflict ? t('dayEnergy.noAmount') : kcalText(burned.totalKcal, true);
  const burnedAmount = conflict ? t('dayEnergy.activityConflict') : kcalText(burned.totalKcal);
  energyButton.setAttribute('aria-label', t('energy.homeAria', { amount: burnedAmount }) + ' · ' + window.FastingEnergy.activityNote(burned, prefs));
  intakeButton.disabled = energyButton.disabled = false;
  dailyCaloriesView = { ...snapshot, minute, prefs, events: state.events };
  return dailyCaloriesView;
}
let goalWasReached = null; // null until the first tick, so an already-reached goal does not celebrate on load
function pulse(element, className, ms) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth; // restart the animation when it fires twice in a row
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), ms);
}
function tick() {
  if (!ready) return;
  const now = Date.now();
  if (mealUseSaveTime && $('meal-dialog').open && mealLocalValue() !== localInput(now)) setMealDateTime(now);
  if ($('meal-dialog').open && (mealDateDay !== C.localDay(now, tz()) || mealLastKey !== mealLastStateKey(now))) updateMealDateControls();
  const meal = C.timerMeal(state, now, prefs);
  const timer = C.getTimer(state, now, prefs);
  const active = Boolean(meal) && !timer.reset;
  const laterMeal = active && state.events[0] && state.events[0].at > meal.at;
  const anchorNote = $('timer-anchor-note');
  const showAnchor = !active || (active && prefs.timerAnchorId === meal.id);
  const anchorText = !active ? t('timer.startGuide') : t('timer.startAt', { when: intervalTime(meal.at) }) + (laterMeal ? ` · ${t('timer.mealAfter')}` : '');
  if (anchorNote.textContent !== anchorText) anchorNote.textContent = anchorText;
  if (anchorNote.hidden === showAnchor) anchorNote.hidden = !showAnchor;
  const autophagy = C.getAutophagyStage(active && !timer.clockSkew && !laterMeal ? timer.elapsedMs : null);
  $('autophagy-dial').classList.toggle('is-active', autophagy.active);
  $('autophagy-dial').hidden = !autophagy.active;
  $('autophagy-dial-dots').textContent = autophagy.dots;
  $('autophagy-dial-label').textContent = t(autophagy.current.titleKey);
  document.querySelectorAll('#autophagy-stages .autophagy-stage').forEach(el => { const s = Number(el.dataset.stage), cur = autophagy.active && s === autophagy.stage; el.hidden = !autophagy.active || laterMeal || s !== autophagy.stage; el.classList.toggle('is-current', cur); el.classList.toggle('is-done', autophagy.active && s < autophagy.stage); if (cur) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
  const pauseBtn = $('timer-pause'), resetBtn = $('timer-reset');
  if (pauseBtn) { pauseBtn.disabled = busy || !active; pauseBtn.textContent = timer.paused ? t('timer.resume') : t('timer.pause'); pauseBtn.setAttribute('aria-label', timer.paused ? t('timer.resumeAria') : t('timer.pauseAria')); pauseBtn.setAttribute('aria-pressed', String(Boolean(timer.paused))); }
  if (resetBtn) resetBtn.disabled = busy || !active;
  const duration = C.formatDuration(timer.elapsedMs);
  const parts = duration.split(':');
  // Keep the touched clock elements stable while seconds advance.
  $('elapsed').firstChild.nodeValue = `${parts[0]}:${parts[1]}`;
  $('elapsed').querySelector('span').textContent = `:${parts[2]}`;
  $('elapsed').classList.toggle('long-duration', parts[0].length > 2);
  $('elapsed').classList.toggle('extra-long-duration', parts[0].length > 4);
  $('elapsed').setAttribute('aria-label', active ? t('timer.elapsedAria', { h: Number(parts[0]), m: Number(parts[1]), s: Number(parts[2]) }) : t('timer.noRecordAria'));
  $('mini-elapsed').textContent = duration;
  $('mini-elapsed').classList.toggle('long-duration', parts[0].length > 2);
  $('mini-elapsed').classList.toggle('extra-long-duration', parts[0].length > 4);
  const sub = !active ? '' : timer.paused ? t('timer.paused') : timer.clockSkew ? t('mini.checkTime') : laterMeal ? t('timer.mealAfter') : !state.settings.goalEnabled ? t('mini.ownRhythm') : timer.reached ? t('mini.reached') : t('mini.untilGoal', { d: shortDuration(timer.remainingMs) });
  $('mini-remaining').textContent = sub;
  $('mini-remaining').hidden = !sub;
  $('clock-warning').hidden = !timer.clockSkew;
  const dialProgress = active && !timer.clockSkew ? (timer.elapsedMs % DIAL_MS) / DIAL_MS : 0;
  document.querySelector('.dial-wrap').style.setProperty('--stage-color', stageColor(active && !timer.clockSkew && !laterMeal ? timer.elapsedMs : null));
  $('dial-progress').setAttribute('stroke-dasharray', `${dialProgress * 100} 100`);
  renderDialGradient(dialProgress, active && !timer.clockSkew && !laterMeal);
  const angle = dialProgress * Math.PI * 2 - Math.PI / 2;
  $('dial-tip').setAttribute('cx', 180 + 170 * Math.cos(angle));
  $('dial-tip').setAttribute('cy', 180 + 170 * Math.sin(angle));
  $('mini-progress-bar').style.width = `${laterMeal ? 0 : timer.progress * 100}%`;
  renderDailyCalories(now);
  if (C.localDay(now, tz()) !== todayDay) renderToday(); // a new day starts the list over
  const eating = C.eatingWindow(state.settings, now, tz());
  // With a plan the home line shows the eating window; the dial and stage text already show goal progress.
  const reachedNow = Boolean(active && !timer.clockSkew && !laterMeal && state.settings.goalEnabled && timer.reached);
  if (reachedNow && goalWasReached === false) pulse(document.querySelector('.dial-wrap'), 'goal-celebrate', 2600);
  goalWasReached = reachedNow;
  const remaining = eating
    ? (eating.open ? t('plan.homeOpen', { end: clockText(eating.endAt), d: shortDuration(eating.endAt - now) }) : t('plan.homeClosed', { start: clockText(eating.nextOpenAt), d: shortDuration(eating.nextOpenAt - now) }))
    : !active || timer.clockSkew || laterMeal ? '' : timer.paused ? t('timer.paused') : state.settings.goalEnabled ? (timer.reached ? t('mini.reached') : t('mini.remaining', { d: shortDuration(timer.remainingMs) })) : '';
  $('goal-remaining').textContent = remaining;
  $('goal-remaining').hidden = !remaining;
  const nowP = C.tzParts(now, tz()), nowW = new Date(now).toLocaleDateString(L.locale, { weekday: 'long', ...tzOpt() });
  $('today-label').textContent = nowW.toUpperCase() + ' · MY LITTLE PAUSE';
  $('date-stamp').innerHTML = `<strong>${nowP.month}.${String(nowP.day).padStart(2,'0')}</strong>${nowW}`;
}
function row(event) {
  const meal = MEALS[event.type], name = mealName(event.type);
  const symbol = `<span class="row-icon ${event.type}">${icon(meal.icon)}</span>`;
  const description = mealDescription(event);
  const editAria = esc(t('history.editAria', { when: dateTime(event.at), meal: name }));
  return `<div class="history-row">${symbol}<button type="button" class="history-edit-copy" data-edit="${esc(event.id)}" aria-label="${editAria}"><strong>${name}</strong><span>${esc(description || t('history.noNote'))}</span></button><time datetime="${new Date(event.at).toISOString()}">${time(event.at)}</time><button class="icon-button" data-edit="${esc(event.id)}" aria-label="${editAria}">${icon('edit')}</button></div>`;
}
function normalizeDescriptionText(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(L.locale);
}
function mealDescription(event) {
  const foodNames = event.foods?.map(food => food.name).filter(Boolean).join(', ') || '';
  // Only suppress a note when it repeats the entire visible food description after
  // harmless whitespace/case normalization. Distinct notes and stored values stay intact.
  const note = normalizeDescriptionText(event.note) && normalizeDescriptionText(event.note) !== normalizeDescriptionText(foodNames) ? event.note : '';
  return [foodNames, note, event.foods?.length ? kcalText(C.foodKcalTotal(event.foods)) : t('history.noCalories')].filter(Boolean).join(' · ');
}
function renderHistory() {
  const query = $('history-search').value.trim().toLocaleLowerCase(L.locale);
  const type = $('history-type-filter').value;
  const selectedDate = $('history-date-filter').value;
  const filtered = state.events.filter(event => (!type || event.type === type) && (!selectedDate || C.localDay(event.at, tz()) === selectedDate) && (!query || [mealName(event.type), event.note, ...(event.foods || []).map(food => food.name)].some(value => String(value || '').toLocaleLowerCase(L.locale).includes(query))));
  const filtering = Boolean(query || type || selectedDate);
  $('history-count').textContent = t(filtering ? 'history.filteredCount' : 'history.count', { n: filtered.length });
  if (!state.events.length) {
    $('history-list').innerHTML = `<div class="history-empty">${icon('history')}<h2>${t('history.emptyTitle')}</h2><p>${t('history.emptyText')}</p><button class="primary-button" data-add>${t('history.emptyAction')}</button></div>`;
  } else if (!filtered.length) {
    $('history-list').innerHTML = `<div class="history-empty"><p>${esc(t('history.noResults'))}</p></div>`;
  } else {
    let currentDay = '';
    $('history-list').innerHTML = filtered.slice(0, historyLimit).map(event => {
      const d = day(event.at); const header = currentDay !== d ? `<div class="history-group-label">${esc(t('date.year', { y: C.tzParts(event.at, tz()).year, rest: d }))}</div>` : '';
      currentDay = d; return header + row(event);
    }).join('');
  }
  $('load-more').hidden = filtered.length <= historyLimit;
}
function renderStats() {
  const now = Date.now();
  const stats = C.weeklyStats(state, now, tz());
  $('stat-meals').innerHTML = `${stats.totalMeals}<small>${t('stats.unitTimes')}</small>`;
  $('stat-days').innerHTML = `${stats.daily.filter(d => d.meals > 0).length}<small>${t('stats.unitDays')}</small>`;
  const longest = stats.mealIntervals.reduce((m, x) => Math.max(m, x.durationMs), 0);
  $('stat-gap').textContent = stats.mealIntervals.length ? shortDuration(longest) : t('stats.none');
  const week = C.periodFastingStats(state, now, tz(), 7);
  if ($('stat-average')) $('stat-average').textContent = week.count ? shortDuration(week.averageMs) : '—';
  for (const [key, days] of [['week', 7], ['month', 30]]) {
    const period = C.periodFastingStats(state, now, tz(), days);
    $(`period-${key}-average`).textContent = period.count ? shortDuration(period.averageMs) : '—';
    $(`period-${key}-count`).textContent = period.count ? t('stats.periodCount', { n: period.count, longest: shortDuration(period.longestMs) }) : t('stats.periodEmpty');
  }
  const goalMs = state.settings.goalEnabled ? state.settings.goalHours * 3600000 : 0;
  const max = Math.max(3600000, goalMs * 1.1, ...stats.daily.map(d => d.maxIntervalMs));
  const metDay = d => Boolean(goalMs && d.longestInterval && d.maxIntervalMs >= goalMs);
  $('weekly-chart').innerHTML = stats.daily.map((d,i) => {
    const duration = d.longestInterval ? shortDuration(d.maxIntervalMs) : t('stats.dayNoData');
    const hours = d.maxIntervalMs / 3600000;
    const value = d.longestInterval ? new Intl.NumberFormat(L.locale, { maximumFractionDigits: 1, notation: hours >= 1000 ? 'compact' : 'standard' }).format(hours) : '—';
    const date = d.date.split('-').slice(1).map(Number).join('.');
    return `<button type="button" class="chart-day ${i===6?'today':''}" data-effect-date="${d.date}" aria-haspopup="dialog" aria-controls="fasting-dialog" aria-label="${esc(t('stats.dayAria', { date: d.date, duration }))}"><span class="chart-value">${metDay(d) ? '✓ ' : ''}${esc(value)}</span><span class="chart-track" aria-hidden="true">${goalMs ? `<span class="chart-goal" style="bottom:${(goalMs / max * 52).toFixed(1)}px"></span>` : ''}<span class="chart-bar${goalMs ? (metDay(d) ? ' met' : ' unmet') : ''}" style="height:${Math.max(2,d.maxIntervalMs/max*52)}px"></span></span><span class="chart-label">${date}</span></button>`;
  }).join('');
  $('weekly-chart').setAttribute('aria-label', t('stats.weekAria', { list: stats.daily.map(d => t('stats.weekItem', { date: d.date, duration: d.longestInterval ? shortDuration(d.maxIntervalMs) : t('stats.dayNoData') })).join(', ') }));
  renderGoalInsights(stats, goalMs, metDay, now);
  $('interval-list').innerHTML = stats.mealIntervals.length ? stats.mealIntervals.slice(0,7).map(interval => `<button type="button" class="interval-row" data-effect-from="${interval.from}" data-effect-to="${interval.to}" aria-haspopup="dialog" aria-controls="fasting-dialog" aria-label="${esc(t('effects.intervalAria', { from: intervalTime(interval.from), to: intervalTime(interval.to), duration: shortDuration(interval.durationMs) }))}"><span>${intervalPoint(interval.from)} → ${intervalPoint(interval.to)}</span><strong>${shortDuration(interval.durationMs)} <span aria-hidden="true">›</span></strong></button>`).join('') : `<p class="empty-recent">${t('stats.intervalsEmpty')}</p>`;
}
let todayDay = null;
// Today's meals for the wide-screen card and the tall-phone strip. CSS decides which one is shown,
// so the phone layout that pwa-fit measures is unchanged on ordinary screens.
function renderToday() {
  const card = $('today-card'), strip = $('today-strip');
  if (!card || !strip || !ready) return;
  const now = Date.now(), day = C.localDay(now, tz());
  todayDay = day;
  const meals = state.events.filter(event => C.localDay(event.at, tz()) === day).sort((a, b) => a.at - b.at);
  $('today-list').innerHTML = meals.length ? meals.map(event => {
    const detail = mealDescription(event);
    return `<li><button type="button" class="today-row" data-edit="${esc(event.id)}" aria-label="${esc(t('history.editAria', { when: dateTime(event.at), meal: mealName(event.type) }))}"><span class="row-icon ${event.type}">${icon(MEALS[event.type].icon)}</span><span class="today-copy"><strong>${time(event.at)} · ${mealName(event.type)}</strong><small>${esc(detail)}</small></span></button></li>`;
  }).join('') : `<li class="today-empty">${t('today.empty')}</li>`;
  const week = C.periodFastingStats(state, now, tz(), 7);
  const parts = [];
  if (week.count) parts.push(t('today.week', { avg: shortDuration(week.averageMs) }));
  const streak = state.settings.goalEnabled ? C.goalStreak(state, now, tz(), state.settings.goalHours) : 0;
  if (streak > 1) parts.push(t('today.streak', { n: streak }));
  $('today-week').textContent = parts.join(' · ');
  $('today-week').hidden = !parts.length;
  $('today-chips').innerHTML = meals.length
    ? meals.slice(-4).map(event => `<span class="today-chip"><b>${time(event.at)}</b> ${mealName(event.type)}</span>`).join('') + (meals.length > 4 ? `<span class="today-chip">+${meals.length - 4}</span>` : '')
    : t('today.stripEmpty');
}
function renderGoalInsights(stats, goalMs, metDay, now) {
  const summary = $('goal-summary');
  summary.hidden = !goalMs;
  if (goalMs) summary.textContent = t('stats.goalSummary', { h: state.settings.goalHours, met: stats.daily.filter(metDay).length, streak: C.goalStreak(state, now, tz(), state.settings.goalHours) });
  const month = C.dailyLongest(state, now, tz(), 30);
  const kind = d => !d.longestMs ? 'empty' : goalMs && d.longestMs >= goalMs ? 'met' : 'logged';
  $('month-strip').innerHTML = month.map(d => {
    const label = `${d.date} · ${d.longestMs ? shortDuration(d.longestMs) : t('stats.dayNoData')}`;
    return `<span class="month-cell ${kind(d)}" title="${esc(label)}">${kind(d) === 'met' ? '✓' : ''}</span>`;
  }).join('');
  $('month-strip').setAttribute('aria-label', t('stats.monthAria', { met: month.filter(d => kind(d) === 'met').length, logged: month.filter(d => d.longestMs).length }));
  document.querySelector('.month-legend .legend-met').hidden = !goalMs;
  const weights = (state.weightMeasurements || []).slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  $('weight-trend').hidden = weights.length < 2;
  if (weights.length < 2) return;
  const values = weights.map(w => w.weightKg), low = Math.min(...values), span = Math.max(0.5, Math.max(...values) - low);
  const points = weights.map((w, i) => [4 + i / (weights.length - 1) * 292, 74 - (w.weightKg - low) / span * 66].map(n => n.toFixed(1)));
  $('weight-chart').innerHTML = `<polyline class="weight-line" points="${points.map(p => p.join(',')).join(' ')}"/>` + points.map(([x, y]) => `<circle class="weight-dot" cx="${x}" cy="${y}" r="3"/>`).join('');
  const first = weights[0], last = weights[weights.length - 1], diff = Math.round((last.weightKg - first.weightKg) * 10) / 10;
  const kg = value => new Intl.NumberFormat(L.locale, { maximumFractionDigits: 1 }).format(value);
  $('weight-summary').textContent = t('stats.weightSummary', { from: first.date.slice(5).replace('-', '.'), to: last.date.slice(5).replace('-', '.'), start: kg(first.weightKg), end: kg(last.weightKg), diff: (diff > 0 ? '+' : diff < 0 ? '−' : '±') + kg(Math.abs(diff)) });
}
function renderEnergyBreakdown(show, now) {
  const section = $('energy-today');
  section.hidden = $('energy-actions').hidden = !show;
  if (!show) return;
  const { burned: daily, intake, conflict } = renderDailyCalories(now);
  const activity = conflict ? t('dayEnergy.activityConflict') : daily.activeKcal == null ? t('energy.noActivity') : kcalText(daily.activeKcal);
  const intakeText = !intake.logged ? t('dayEnergy.noIntake') : intake.missing
    ? t('dayEnergy.partial', { kcal: kcalText(intake.kcal) }) : kcalText(intake.kcal);
  const balance = !conflict && intake.logged && !intake.missing
    ? Math.round((intake.kcal - daily.totalKcal) * 10) / 10 : null;
  const signed = balance > 0 ? '+' : balance < 0 ? '−' : '';
  const balanceText = balance === null ? '—' : signed + kcalText(Math.abs(balance));
  section.innerHTML = `<p class="effect-caption">${t('energy.todayRange', { time: time(daily.to) })}</p>
    <dl>
      <dt>${t('intake.label')}</dt><dd data-energy-intake>${esc(intakeText)}</dd>
      <dt>${t('energy.basal')}</dt><dd data-energy-basal>${kcalText(daily.basalKcal)}</dd>
      <dt>${t('energy.activity')}</dt><dd data-energy-activity>${activity}</dd>
      <dt class="energy-total">${t('energy.todayTotal')}</dt><dd class="energy-total" data-energy-total>${conflict ? '—' : kcalText(daily.totalKcal)}</dd>
    </dl>
    <div class="day-energy-balance" data-energy-balance-row><span>${t('dayEnergy.todayBalance')}</span><strong data-energy-balance>${balanceText}</strong>${balance !== null && (daily.activeKcal == null || daily.activity?.excludedBoundary) ? `<small>${t('dayEnergy.incompleteActivity')}</small>` : ''}</div>
    ${!conflict && balance === null ? `<p class="field-help">${t('dayEnergy.missing')}</p>` : ''}
    <p class="field-help">${esc(window.FastingEnergy.activityNote(daily, prefs))}</p><p class="field-help">${t('dayEnergy.profileBasis')}</p>`;
}
function setEnergyDetailView(view, live, interval) {
  const tabs = $('energy-view-tabs');
  const todayTab = $('energy-view-today');
  const fastTab = $('energy-view-fast');
  // The two views describe different periods. Historical interval details retain
  // their existing single-period presentation instead of calling a past date “today”.
  if (!tabs || !todayTab || !fastTab) return;
  tabs.hidden = !live;
  const today = live && view !== 'fast';
  for (const [button, selected] of [[todayTab, today], [fastTab, !today]]) {
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  $('energy-today').hidden = !today;
  $('fasting-detail').hidden = live && today;
  $('energy-fasting-note').hidden = !live || today || !interval;
  const estimate = $('fasting-estimate-note');
  const model = $('fasting-dialog').querySelector('.effect-model');
  if (estimate) estimate.hidden = live && today;
  if (model) model.hidden = live && today;
  const todayPanel = $('energy-today');
  const fastPanel = $('fasting-detail');
  if (live) {
    todayPanel.setAttribute('role', 'tabpanel'); todayPanel.setAttribute('aria-labelledby', 'energy-view-today');
    fastPanel.setAttribute('role', 'tabpanel'); fastPanel.setAttribute('aria-labelledby', 'energy-view-fast');
  } else {
    todayPanel.removeAttribute('role'); todayPanel.removeAttribute('aria-labelledby');
    fastPanel.removeAttribute('role'); fastPanel.removeAttribute('aria-labelledby');
  }
}
function weightDateLabel(date) {
  return new Intl.DateTimeFormat(L.locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}
function weightValue(weightKg, signed = false) {
  const value = new Intl.NumberFormat(L.locale, { maximumFractionDigits: 1, signDisplay: signed ? 'exceptZero' : 'auto' }).format(weightKg);
  return t('weight.value', { value });
}
function renderDayCalories(date, now) {
  const section = $('energy-day');
  if (!section) return;
  section.hidden = !date || !window.FastingEnergy.forDay || !C.dayRange || !C.foodCalorieSummary;
  if (section.hidden) return;

  const currentDay = date === C.localDay(now, tz());
  const { burned, intake, conflict } = currentDay ? renderDailyCalories(now) : dailyEnergySnapshot(date, now);
  const intakeKcal = Math.round(intake.kcal * 10) / 10;
  const balance = !conflict && intake.logged && !intake.missing
    ? Math.round((intakeKcal - burned.totalKcal) * 10) / 10 : null;
  const signed = balance > 0 ? '+' : balance < 0 ? '−' : '';
  const balanceText = balance === null ? '—' : signed + kcalText(Math.abs(balance));
  const intakeText = !intake.logged ? t('dayEnergy.noIntake') : intake.missing
    ? t('dayEnergy.partial', { kcal: kcalText(intakeKcal) }) : kcalText(intakeKcal);
  const weight = window.FastingWeight?.compare(state.weightMeasurements, date);
  const measured = weight?.current ? weightValue(weight.current.weightKg) : t('dayEnergy.measureWeight');
  const weightChange = weight?.previous ? `<dt>${t('weight.change')}</dt><dd data-day-weight-change>
    <strong>${esc(weight.changeKg === 0 ? t('weight.unchanged') : weightValue(weight.changeKg, true))}</strong>
    <br><small>${esc(t('weight.previous', { date: weightDateLabel(weight.previous.date) }))}</small></dd>` : '';
  section.innerHTML = `<h3>${t('dayEnergy.title')}</h3>
    <p class="effect-caption">${t(currentDay ? 'energy.todayRange' : 'dayEnergy.fullDay', { time: time(burned.to) })}</p>
    <dl>
      <dt>${t('intake.label')}</dt><dd data-day-intake>${esc(intakeText)}</dd>
      <dt>${t('dayEnergy.burned')}</dt><dd data-day-burned>${conflict ? t('dayEnergy.activityConflict') : kcalText(burned.totalKcal)}</dd>
      <dt>${t('dayEnergy.weight')}</dt><dd data-day-weight>${esc(measured)}</dd>
      ${weightChange}
    </dl>
    <div class="day-energy-balance" data-day-balance-row>
      <span>${t('dayEnergy.balance')}</span><strong data-day-balance>${balanceText}</strong>${balance !== null && (burned.activeKcal == null || burned.activity?.excludedBoundary) ? `<small>${t('dayEnergy.incompleteActivity')}</small>` : ''}
    </div>
    <p class="field-help">${esc(window.FastingEnergy.activityNote(burned, prefs))} ${!currentDay ? esc(t('dayEnergy.currentProfile')) : ''}</p>
    ${!conflict && balance === null ? `<p class="field-help">${t('dayEnergy.missing')}</p>` : ''}
    <details class="day-energy-reference"><summary>${t('effects.modelTitle')}</summary><p>${t('dayEnergy.reference')}</p></details>
    ${weight && $('weight-dialog') ? `<div class="food-media-actions"><button type="button" class="outline-button" aria-haspopup="dialog" aria-controls="weight-dialog" data-weight-date="${esc(date)}">${t(weight.current ? 'weight.edit' : 'weight.title')}</button></div>` : ''}`;
}
function bindWeightEditor() {
  const dialog = $('weight-dialog');
  const card = $('energy-day');
  if (!dialog || !card) return;
  const form = $('weight-form');
  const input = $('weight-measurement');
  const deleteButton = $('weight-delete');
  const error = $('weight-error');
  const prompt = $('weight-delete-prompt');
  let edit = null;
  let saving = false;

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }
  function resetDelete() {
    prompt.hidden = true;
    deleteButton.textContent = t('weight.delete');
  }
  card.addEventListener('click', event => {
    const date = event.target.closest('[data-weight-date]')?.dataset.weightDate;
    if (!window.FastingWeight?.validDate(date) || dialog.open) return;
    const current = window.FastingWeight.compare(state.weightMeasurements, date).current;
    edit = { date, expectedWeightKg: current?.weightKg ?? null };
    $('weight-date').textContent = weightDateLabel(date);
    input.value = current ? String(current.weightKg) : '';
    deleteButton.hidden = !current;
    resetDelete();
    showError();
    dialog.showModal();
    input.focus({ preventScroll: true });
  });

  async function saveWeight(type, fields, message) {
    if (!edit || saving) return;
    saving = true;
    const controls = [...form.querySelectorAll('button, input')];
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    showError();
    try {
      const result = await window.desktop.action({ type, ...edit, ...fields });
      if (!result.ok) { showError(L.err(result.error || t('error.saveFallback'))); return; }
      applySnapshot(result);
      dialog.close();
      toast(t(message), result.canUndo);
    } catch (err) {
      showError(L.err(err));
    } finally {
      saving = false;
      controls.forEach(control => { control.disabled = false; });
      form.removeAttribute('aria-busy');
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    saveWeight('weight-record', { weightKg: input.valueAsNumber }, 'weight.saved');
  });
  input.addEventListener('input', () => { showError(); resetDelete(); });
  deleteButton.addEventListener('click', () => {
    if (!prompt.hidden) { saveWeight('weight-delete', {}, 'weight.deleted'); return; }
    prompt.hidden = false;
    deleteButton.textContent = t('weight.deleteConfirm');
  });
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    const date = edit?.date;
    edit = null;
    if (!$('fasting-dialog').open || fastingSelection?.date !== date) return;
    renderDayCalories(date, Date.now());
    card.querySelector('[data-weight-date]')?.focus({ preventScroll: true });
  });
}
bindWeightEditor();
function openFastingDetail(selection = {}, opener = null) {
  fastingSelection = selection;
  if (!$('fasting-dialog').open) effectOpener = opener || document.activeElement;
  const now = Date.now();
  const stats = selection.live ? null : C.weeklyStats(state, now, tz());
  let interval, date, selectedDay, records = [], laterMeal = false;
  if (selection.live) {
    const meal = C.timerMeal(state, now, prefs);
    const timer = C.getTimer(state, now, prefs);
    laterMeal = Boolean(meal && state.events[0] && state.events[0].at > meal.at);
    if (meal && !timer.reset && !timer.clockSkew && !laterMeal) interval = { from: meal.at, to: timer.paused ? prefs.timerPausedAt : now, durationMs: timer.elapsedMs };
    date = C.localDay(now, tz());
  } else if (selection.date) {
    date = selection.date;
    selectedDay = stats.daily.find(d => d.date === date);
    records = selectedDay?.intervals || [];
    interval = records.find(x => x.from === selection.from && x.to === selection.to) || selectedDay?.longestInterval;
  } else {
    interval = stats.mealIntervals.find(x => x.from === selection.from && x.to === selection.to);
    date = interval ? C.localDay(interval.to, tz()) : '';
    records = stats.daily.find(d => d.date === date)?.intervals || [];
  }
  const detailView = selection.live && selection.view === 'fast' ? 'fast' : 'today';
  $('fasting-title').textContent = selection.live ? t('timer.goalArrival') : t('effects.dayTitle', { date: date ? new Date(date+'T12:00:00Z').toLocaleDateString(L.locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '' });
  renderDayCalories(selectedDay?.date, now);
  renderEnergyBreakdown(selection.live, now);
  $('energy-fasting-note').hidden = !selection.live || !interval;
  if (!interval) {
    $('fasting-detail').innerHTML = `<div class="effect-empty">${icon('leaf')}<strong>${t(laterMeal ? 'effects.mealAfterTitle' : 'effects.emptyTitle')}</strong><p>${t(laterMeal ? 'effects.mealAfter' : selection.live ? 'effects.emptyLive' : 'effects.emptyDay')}</p></div>`;
  } else {
    const trend = fatTrendKey(interval.durationMs);
    const rising = trend === 'effects.trendFat';
    const kcal = window.FastingEnergy.estimate(interval, prefs, !selection.live || !(prefs.timerPausedMs > 0));
    const history = records.length > 1 ? `<section class="effect-records">
      <h3>${t('effects.otherRecords', { n: records.length })}</h3>
      <div class="effect-record-list">${records.map(x => `<button type="button" data-effect-from="${x.from}" data-effect-to="${x.to}" aria-pressed="${x.from === interval.from && x.to === interval.to}">
        <span>${time(x.from)} → ${time(x.to)}</span><strong>${shortDuration(x.durationMs)}</strong>
      </button>`).join('')}</div></section>` : '';
    $('fasting-detail').innerHTML = `<p class="effect-caption">${t(selection.live ? 'effects.atOpen' : 'effects.recordedInterval')}</p>
      <strong class="effect-duration">${shortDuration(interval.durationMs)}</strong>
      <p class="effect-period">${intervalPoint(interval.from)} → ${intervalPoint(interval.to)}</p>
      <section class="effect-state" data-fat-trend="${rising ? 'rising' : 'mixed'}">
        <div>${icon('leaf')}<strong>${t(rising ? 'effects.fatTitle' : 'effects.mixedTitle')}</strong></div>
        <div class="effect-flow" aria-hidden="true"><span class="${rising ? '' : 'is-current'}">${t('effects.mixedLabel')}</span><b>→</b><span class="${rising ? 'is-current' : ''}">${t('effects.fatLabel')}</span></div>
        <p>${t(rising ? 'effects.fatDescription' : 'effects.mixedDescription')}</p>
      </section>
      <div class="effect-energy"><span>${t(selection.live ? 'energy.fasting' : 'effects.energyTitle')}</span><strong>${kcalText(kcal.totalKcal)}</strong></div>${prefs.profileConfirmed === true ? '' : `<p class="effect-note">${t('energy.profileDefault')}</p>`}${history}`;
    {
      const note = document.createElement('p');
      note.className = 'effect-note';
      note.textContent = window.FastingEnergy.describe(kcal, prefs);
      $('fasting-detail').append(note);
    }
  }
  setEnergyDetailView(detailView, Boolean(selection.live), interval);
  if (!$('fasting-dialog').open) $('fasting-dialog').showModal();
  else if (interval) $('fasting-detail').querySelector('.effect-record-list [aria-pressed="true"]')?.focus({ preventScroll: true });
}
function render() {




  renderHistory(); renderStats(); renderToday(); tick();
}
function goPage(page) {
  document.body.dataset.page = page;
  placeToast(page);
  $('sr-status').textContent = { timer: t('sr.timer'), history: t('sr.history'), insights: t('sr.insights') }[page] || '';
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${page}`; });
  document.querySelectorAll('.nav-item[data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page===page); if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
  const main = document.querySelector('main');
  // The web app scrolls inside main; Windows scrolls the document under its title bar.
  main.scrollTop = 0;
  if (!document.body.classList.contains('is-pwa')) window.scrollTo({ top: 0, behavior: 'instant' });
}

(function enableTouchPaging() {
  const surface = $('main-content');
  const pages = ['timer', 'history', 'insights'];
  let gesture = null;
  let suppressClickUntil = 0;
  const controls = 'input,select,textarea,label,[role="slider"],[contenteditable],[data-swipe-ignore]';
  const status = (kind, value) => { document.body.dataset.swipeStatus = `${kind}: ${value}`; };
  function hasSelection() {
    const selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    const bounds = surface.getBoundingClientRect();
    return Array.from(selection.getRangeAt(0).getClientRects()).some(r => r.width > 0 && r.height > 0 && r.bottom > bounds.top && r.top < bounds.bottom && r.right > bounds.left && r.left < bounds.right);
  }
  function begin(kind, id, x, y, target) {
    gesture = null;
    suppressClickUntil = 0; // A fresh touch is an intentional new action.
    if (!ready || document.body.classList.contains('mini') || document.querySelector('dialog[open]')) return;
    if (x < 16 || x > innerWidth - 16) { status(kind, 'edge'); return; }
    if (hasSelection()) { status(kind, 'selection'); return; }
    gesture = { kind, id, x, y, started: performance.now(), axis: '', blocked: Boolean(target.closest(controls)) };
    status(kind, 'start');
  }
  function move(kind, id, x, y, event) {
    if (!gesture || gesture.kind !== kind || gesture.id !== id) return;
    const dx = Math.abs(x - gesture.x), dy = Math.abs(y - gesture.y);
    if (!gesture.axis) {
      if (dx > 8 && dx > dy * 1.35) gesture.axis = 'x';
      else if (dy > 14 && dy > dx * 1.2) gesture.axis = 'y';
    }
    if (gesture.axis === 'x' && event.cancelable) event.preventDefault();
  }
  function end(kind, id, x, y) {
    if (!gesture || gesture.kind !== kind || gesture.id !== id) return;
    const current = gesture;
    gesture = null;
    const dx = x - current.x, dy = y - current.y;
    // A drag across an action must never turn into a meal-recording tap.
    if (Math.hypot(dx, dy) > 12) suppressClickUntil = performance.now() + 450;
    if (current.axis === 'y' || Math.abs(dx) <= Math.abs(dy) * 1.5) { status(kind, 'vertical'); return; }
    const threshold = Math.max(36, Math.min(64, surface.clientWidth * .14));
    if (Math.abs(dx) < threshold || performance.now() - current.started > 1200 || current.blocked) { status(kind, 'short or editing'); return; }
    if (document.querySelector('dialog[open]') || hasSelection()) return;
    const active = document.querySelector('.nav-item.active');
    const index = pages.indexOf(active && active.dataset.page);
    const next = index + (dx < 0 ? 1 : -1);
    if (index >= 0 && next >= 0 && next < pages.length) {
      status(kind, `${pages[index]} -> ${pages[next]}`);
      goPage(pages[next]);
    } else status(kind, 'end page');
  }
  surface.addEventListener('click', event => {
    if (event.detail && performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  if (window.PointerEvent) {
    // A second finger cancels paging so the browser can handle pinch zoom.
    document.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' && event.isPrimary === false) gesture = null;
    }, true);
    surface.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || event.isPrimary === false) return;
      if (gesture && gesture.kind === 'touch') return;
      begin('pointer', event.pointerId, event.clientX, event.clientY, event.target);
    });
    surface.addEventListener('pointermove', event => {
      move('pointer', event.pointerId, event.clientX, event.clientY, event);
      if (gesture && gesture.kind === 'pointer' && gesture.axis === 'x' && surface.setPointerCapture) {
        try { surface.setPointerCapture(event.pointerId); } catch (_) {}
      }
    }, { passive: false });
    surface.addEventListener('pointerup', event => {
      try { if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); } catch (_) {}
      end('pointer', event.pointerId, event.clientX, event.clientY);
    });
    surface.addEventListener('pointercancel', event => {
      if (gesture && gesture.kind === 'pointer' && gesture.id === event.pointerId) { gesture = null; status('pointer', 'native cancel'); }
    });
  }
  // Real touch events take ownership when both event streams are emitted.
  // WebKit may cancel its pointer stream while touch events continue.
  surface.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = event.touches[0];
    begin('touch', touch.identifier, touch.clientX, touch.clientY, event.target);
  }, { passive: true });
  surface.addEventListener('touchmove', event => {
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = event.touches[0];
    move('touch', touch.identifier, touch.clientX, touch.clientY, event);
  }, { passive: false });
  surface.addEventListener('touchend', event => {
    const touch = event.changedTouches[0];
    if (touch) end('touch', touch.identifier, touch.clientX, touch.clientY);
  });
  surface.addEventListener('touchcancel', event => {
    if (gesture && gesture.kind === 'touch' && (!event.changedTouches || Array.from(event.changedTouches).some(touch => touch.identifier === gesture.id))) gesture = null;
  });
})();
function mealDayOptions(now = Date.now()) {
  const today = C.localDay(now, tz());
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return { today, yesterday: previous.toISOString().slice(0, 10) };
}
function mealLastStateKey(now = Date.now()) {
  const last = state.events[0];
  return last ? `${last.id}|${last.at}|${last.at <= now}` : '';
}
function mealLocalValue() {
  const clock = $('meal-clock').value;
  const minute = /^\d{2}:\d{2}:00(?:\.0+)?$/.test(clock) ? clock.slice(0, 5) : clock;
  return `${$('meal-date').value}T${minute}`;
}
function clearChangedMealPreset() {
  const last = state.events[0];
  if (mealExactPreset && (!last || last.id !== mealExactPreset.id || last.at !== mealExactPreset.at || localInput(last.at) !== mealExactPreset.local || mealLocalValue() !== mealExactPreset.local)) mealExactPreset = null;
}
function showOtherMealDate(show) {
  $('meal-other-date').hidden = !show;
  $('meal-date').disabled = !show;
  $('meal-other-toggle').setAttribute('aria-expanded', String(show));
}
function setMealFieldError(field, message = '') {
  const error = $(`meal-${field}-error`);
  const input = $(`meal-${field === 'clock' ? 'clock' : 'date'}`);
  if (error) error.textContent = message;
  if (input) input.setAttribute('aria-invalid', String(Boolean(message)));
}
function showMealFieldValidation(field, message) {
  $('meal-when').open = true;
  $('meal-error').textContent = '';
  setMealFieldError(field, message);
  const input = $(`meal-${field === 'clock' ? 'clock' : 'date'}`);
  input?.scrollIntoView({ block: 'center', behavior: 'instant' });
  input?.focus({ preventScroll: true });
}
function clearMealFieldErrors() { setMealFieldError('date'); setMealFieldError('clock'); }
function updateMealDateControls() {
  const days = mealDayOptions();
  mealDateDay = days.today;
  mealLastKey = mealLastStateKey();
  const selected = $('meal-date').value;
  $('meal-today-date').textContent = days.today.slice(5).replace('-', '.');
  $('meal-yesterday-date').textContent = days.yesterday.slice(5).replace('-', '.');
  document.querySelectorAll('[data-meal-day]').forEach(button => button.setAttribute('aria-pressed', String(selected === days[button.dataset.mealDay])));
  $('meal-other-current').textContent = selected && selected !== days.today && selected !== days.yesterday ? ` · ${selected}` : '';
  const original = editingId ? state.events.find(item => item.id === editingId) : null;
  $('meal-date').max = localInput(Math.max(Date.now(), original?.at || 0)).slice(0, 10);
  const last = state.events[0];
  const available = !!last && last.at <= Date.now();
  const button = $('meal-last-time');
  button.disabled = !available;
  $('meal-last-value').textContent = available ? time(last.at) : last ? t('meal.lastFutureShort') : t('meal.lastNone');
  const label = available ? t('meal.lastUseAria', { when: dateTime(last.at) }) : last ? t('meal.lastFutureAria') : t('meal.lastNoneAria');
  button.setAttribute('aria-label', label);
  button.title = label;
  clearChangedMealPreset();
  updateMealWhenSummary();
}
function setMealDateTime(at, exactMeal = null) {
  const local = localInput(at);
  mealExactPreset = exactMeal ? { id: exactMeal.id, at: exactMeal.at, local } : null;
  $('meal-date').value = local.slice(0, 10);
  $('meal-clock').value = local.slice(11, 16);
  syncMealTypeFromClock();
  const days = mealDayOptions();
  showOtherMealDate($('meal-date').value !== days.today && $('meal-date').value !== days.yesterday);
  updateMealDateControls();
  updateMealWhenSummary();
}
function syncMealTypeFromClock() {
  if (!mealAutoType) return;
  const type = C.mealTypeForTime($('meal-clock').value);
  if (type) $('meal-type').value = type;
  updateMealWhenSummary();
}
function updateMealWhenSummary() {
  const days = mealDayOptions();
  const selected = $('meal-date').value;
  const day = selected === days.today ? t('date.today') : selected === days.yesterday ? t('date.yesterday') : selected;
  $('meal-when-summary').textContent = [mealName($('meal-type').value), day, $('meal-clock').value].filter(Boolean).join(' · ');
}
['meal-type', 'meal-date', 'meal-clock'].forEach(id => {
  $(id).addEventListener('input', updateMealWhenSummary);
  $(id).addEventListener('change', updateMealWhenSummary);
});
function openMeal(id = null, showFoods = false, startTimer = false) {
  mealOpener = document.activeElement;
  mealReturnIndex = Math.max(0, [...document.querySelectorAll('#history-list [data-edit]')].indexOf(mealOpener));
  editingId = id;
  mealStartsTimer = !id && startTimer;
  mealUseSaveTime = false;
  const event = state.events.find(item => item.id === id);
  mealAutoType = !id;
  $('meal-auto-hint').hidden = !mealAutoType;
  editingSnapshot = event ? C.clone(event) : null;
  $('meal-dialog-title').textContent = event ? t('meal.dialogEdit') : t('meal.dialogNew');
  $('meal-type').value = event?.type || 'breakfast';
  setMealDateTime(event?.at || Date.now());
  $('meal-when').open = Boolean(!id && startTimer);
  $('meal-note').value = event?.note || '';
  $('meal-error').textContent = '';
  clearMealFieldErrors();
  $('delete-meal').hidden = !event;
  $('meal-cancel').textContent = t('dialog.cancel');
  $('meal-cancel').removeAttribute('aria-describedby');
  $('save-meal').textContent = event ? t('meal.saveEdit') : t('meal.save');
  // Existing meal foods are presented through the compact summary first.
  // The detailed manual editor opens only from its explicit edit control.
  window.MealFoods.open(event?.foods, false, state.events);
  mealBaseline = mealDraftSignature();
  $('meal-dialog').showModal();
  const scroller = $('meal-dialog').querySelector('.meal-form-body');
  if (scroller) scroller.scrollTop = 0;
}
function mealDraftSignature() {
  return JSON.stringify({ type: $('meal-type').value, when: mealUseSaveTime ? 'save-time' : mealLocalValue(),
    note: $('meal-note').value, foods: window.MealFoods.draftSignature?.() || '' });
}
function requestMealClose() {
  if (busy) return;
  if (mealBaseline !== mealDraftSignature() || window.MealFoods.hasPendingAnalysis?.()) {
    if (!$('discard-meal-dialog').open) $('discard-meal-dialog').showModal();
  } else $('meal-dialog').close();
}
function showFoodAiSettings(expanded = true) {
  const trigger = $('settings-food-ai-open');
  const section = $('settings-food-ai');
  if (trigger) trigger.setAttribute('aria-expanded', String(expanded));
  if (section) {
    section.hidden = !expanded;
    if (!expanded) return;
    section.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(() => $('settings-food-ai-title')?.focus({ preventScroll: true }));
  }
  $('food-ai-setup')?.setAttribute('open', '');
}
function openMealAiSettings() {
  const mealDialog = $('meal-dialog');
  returnToMealAfterSettings = Boolean(mealDialog?.open);
  if (!$('settings-dialog').open) openSettings(false);
  showFoodAiSettings();
}
function renderIntake() {
  const now = Date.now();
  const today = C.localDay(now, tz());
  const from = C.parseLocalInput(today + 'T00:00', tz());
  const meals = [];
  for (const meal of state.events) {
    if (meal.at < from) break;
    if (meal.at <= now) meals.push(meal);
  }
  const logged = meals.filter(meal => meal.foods?.length);
  const total = logged.reduce((sum, meal) => sum + C.foodKcalTotal(meal.foods), 0);
  $('intake-day-value').textContent = logged.length ? kcalText(total) : t('intake.noCalories');
  $('intake-day-coverage').textContent = meals.length
    ? t('intake.coverage', { logged: logged.length, total: meals.length }) : t('intake.empty');
  $('intake-day-meals').innerHTML = meals.map(meal => {
    const kind = mealName(meal.type);
    const amount = meal.foods?.length ? kcalText(C.foodKcalTotal(meal.foods)) : t('intake.noCalories');
    return `<li><button type="button" class="settings-link" data-intake-edit="${esc(meal.id)}">
      <span class="settings-row-copy"><strong>${esc(kind)} · ${esc(time(meal.at))}</strong><small>${esc(amount)} · ${t('intake.editMeal')}</small></span>
    </button></li>`;
  }).join('');
}
function openIntake() {
  const dialog = $('intake-dialog');
  if (!dialog) { openMeal(null, true); return; }
  renderIntake();
  dialog.showModal();
}
let goalBaseline = null;
let goalSaving = false;
let goalDirty = { enabled: false, hours: false, notifications: false, start: false };
let goalPlan = null;
function clockText(at) { const p = C.tzParts(at, tz()); return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0'); }
function planWindowText() {
  const plan = C.FAST_PLANS[goalPlan], start = $('plan-start').value;
  if (!plan || !C.validWindowStart(start)) return '';
  const end = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + plan.eatHours * 60) % 1440;
  const endText = String(Math.floor(end / 60)).padStart(2, '0') + ':' + String(end % 60).padStart(2, '0');
  return t('plan.windowText', { start, end: endText, fast: plan.fastHours });
}
function updateGoalControls() {
  const enabled = $('goal-enabled').checked;
  $('goal-input').disabled = !enabled || goalSaving;
  document.querySelectorAll('[data-goal-preset]').forEach(button => {
    button.setAttribute('aria-pressed', String(enabled && !goalPlan && Number($('goal-input').value) === Number(button.dataset.goalPreset)));
  });
  document.querySelectorAll('[data-plan]').forEach(button => button.setAttribute('aria-pressed', String(enabled && goalPlan === button.dataset.plan)));
  $('plan-window').hidden = !(enabled && goalPlan);
  $('plan-window-text').textContent = enabled && goalPlan ? planWindowText() : '';
}
function openGoal() {
  if (!ready || $('goal-dialog').open) return;
  goalBaseline = { goalEnabled: state.settings.goalEnabled, goalHours: state.settings.goalHours, notifications: state.settings.notifications, plan: state.settings.plan || null, windowStart: state.settings.windowStart || C.DEFAULT_WINDOW_START };
  goalDirty = { enabled: false, hours: false, notifications: false, start: false };
  goalPlan = goalBaseline.plan;
  $('plan-start').value = goalBaseline.windowStart;
  $('goal-enabled').checked = goalBaseline.goalEnabled;
  $('goal-input').value = goalBaseline.goalHours;
  $('notifications-input').checked = goalBaseline.notifications;
  $('goal-error').textContent = '';
  updateGoalControls();
  updateSettingsStatus();
  $('goal-dialog').showModal();
  $('goal-dialog').querySelector('.goal-dialog-body').scrollTop = 0;
}
function openSettings(profileOnly = false) {
  const dialog = $('settings-dialog');
  window.MealFoods?.beginProviderDraft?.();
  providerDraftCommitted = false;
  const title = $('settings-title');
  title.dataset.i18n = profileOnly ? 'settings.group.profile' : 'settings.title';
  title.textContent = t(title.dataset.i18n);
  dialog.classList.toggle('settings-profile-only', profileOnly);
  $('settings-food-ai-open')?.setAttribute('aria-expanded', 'false');
  $('settings-food-ai').hidden = true;
  dialog.querySelectorAll('.settings-group').forEach(group => {
    group.open = profileOnly && group.id === 'settings-profile';
  });
  const profile = C.normalizeProfile(prefs);
  $('sex-input').value = profile.sex;
  $('age-input').value = profile.age;
  $('height-input').value = profile.heightCm;
  $('weight-input').value = profile.weightKg;
  $('activity-input').value = profile.activityLevel;
  $('profile-confirmed-input').checked = prefs.profileConfirmed === true;
  $('profile-basis-note').hidden = prefs.profileConfirmed === true;
  $('tray-input').checked = prefs.tray;
  $('autostart-input').checked = prefs.autoStartActive || prefs.autoStart;
  $('autostart-label').hidden = !prefs.canAutoStart;
  $('language-input').value = prefs.language || 'auto';
  $('timezone-input').value = prefs.timeZone || 'auto';
  $('color-theme-input').value = prefs.colorTheme || 'sage';
  $('timer-gradient-input').value = C.validTimerGradient(prefs.timerGradient) ? prefs.timerGradient : 'p05';
  timerGradientPreview = null;
  renderTimerGradientPreview();
  $('theme-auto-input').checked = state.settings.themeAuto;
  $('backup-reminder-input').checked = Boolean(prefs.backupReminder);
  $('restore-confirm').checked = false;
  $('resolve-restore-conflict').disabled = true;
  updateSettingsStatus();
  settingsBaseline = {
    prefs: {
      ...profile, profileConfirmed: prefs.profileConfirmed === true, tray: $('tray-input').checked, autoStart: $('autostart-input').checked,
      language: $('language-input').value, timeZone: $('timezone-input').value, colorTheme: $('color-theme-input').value, timerGradient: $('timer-gradient-input').value, backupReminder: Boolean(prefs.backupReminder)
    },
    settings: { ...state.settings }
  };
  $('settings-error').textContent = '';
  dialog.showModal();
  refreshSyncPanel();
  title.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}
function updateSettingsStatus() {
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const key = permission === 'granted' ? 'settings.notificationsGranted' : permission === 'denied' ? 'settings.notificationsDenied' : permission === 'default' ? 'settings.notificationsAsk' : 'settings.notificationsUnavailable';
  $('notification-status').textContent = t(key);
  const status = $('backup-status');
  status.hidden = !document.body.classList.contains('is-pwa');
  $('backup-scope').hidden = status.hidden;
  $('backup-reminder-setting').hidden = status.hidden;
  $('activity-recovery').hidden = status.hidden || !activityRecoveryNeeded;
  $('restore-recovery').hidden = status.hidden || !restoreRecoveryNeeded;
  if (!status.hidden) {
    const backupDate = lastBackupAt ? new Date(lastBackupAt).toLocaleDateString(L.locale, { year:'numeric', month:'short', day:'numeric', ...tzOpt() }) : '';
    status.textContent = lastBackupAt ? t('settings.backupLast', { date: backupDate }) : t('settings.backupNever');
    if (backupReminderBase() && Date.now() - backupReminderBase() >= 30 * 86400000) status.textContent += ' ' + t('settings.backupDue');
  }
}
async function exportData(format) {
  const chooser = $('export-dialog');
  if (!format && chooser && document.body.classList.contains('is-pwa')) {
    $('export-error').textContent = '';
    chooser.showModal();
    return;
  }
  const result = await action(format ? { type: 'export', format } : { type: 'export' }, null, false);
  if (result && Object.hasOwn(result, 'lastBackupAt')) { lastBackupAt = result.lastBackupAt; updateSettingsStatus(); }
  if (result?.exported) {
    if (chooser?.open) chooser.close();
    toast(t(result.backupScope === 'records-only' ? 'settings.recordsOnly' : 'toast.exported'));
  } else if (chooser?.open && !result) {
    $('export-error').textContent = lastActionError || t('export.failed');
  }
}

icons();
$('dial-ticks').innerHTML = Array.from({length:60},(_,i) => { const a=i*Math.PI/30;const outer=187;const inner=i%5===0?179:183;return `<line class="dial-tick" x1="${180+inner*Math.sin(a)}" y1="${180-inner*Math.cos(a)}" x2="${180+outer*Math.sin(a)}" y2="${180-outer*Math.cos(a)}"/>`; }).join('');
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if(!button)return;
  if(button.dataset.meal) { openMealForType(button.dataset.meal); }
  else if(button.dataset.goal) { action({type:'settings',patch:{goalHours:Number(button.dataset.goal),goalEnabled:true}},t('toast.goalSet', { h: button.dataset.goal })); }
  else if(button.hasAttribute('data-offset')) { mealUseSaveTime = false; setMealDateTime(Date.now()-Number(button.dataset.offset)*60000); $('meal-error').textContent=''; }
  else if(button.dataset.page)goPage(button.dataset.page);
  else if(button.dataset.goto)goPage(button.dataset.goto);
  else if(button.dataset.edit)openMeal(button.dataset.edit);
  else if(button.dataset.intakeEdit)openMeal(button.dataset.intakeEdit, true);
  else if(button.dataset.exportFormat)exportData(button.dataset.exportFormat);
  else if(button.id==='intake-summary')openIntake();
  else if(button.id==='timer-goal')openGoal();
  else if(button.id==='energy-summary')openFastingDetail({live:true},button);
  else if(button.dataset.energyView && $('fasting-dialog').open && fastingSelection?.live)openFastingDetail({ ...fastingSelection, view: button.dataset.energyView });
  else if(button.dataset.effectDate)openFastingDetail({date:button.dataset.effectDate},button);
  else if(button.dataset.effectFrom) {
    const date = button.closest('.effect-record-list') ? fastingSelection?.date : undefined;
    openFastingDetail({ date, from: Number(button.dataset.effectFrom), to: Number(button.dataset.effectTo) }, button);
  }
  else if(button.hasAttribute('data-add'))openMeal();
  else if(button.dataset.close) {
    if (button.dataset.close === 'meal-dialog') { requestMealClose(); return; }
    if (button.dataset.close === 'goal-dialog' && goalSaving) return;
    if (button.dataset.close === 'settings-dialog') discardTimerGradientPreview();
    $(button.dataset.close).close();
  }
});
$('energy-view-tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
});
document.querySelector('.brand').addEventListener('click', event => {event.preventDefault();goPage('timer');});
document.querySelectorAll('[data-meal-day]').forEach(button => button.addEventListener('click', () => {
  mealUseSaveTime = false;
  $('meal-date').value = mealDayOptions()[button.dataset.mealDay];
  showOtherMealDate(false);
  updateMealDateControls();
  $('meal-error').textContent = ''; clearMealFieldErrors();
}));
$('meal-other-toggle').addEventListener('click', () => {
  if ($('meal-other-date').hidden) mealUseSaveTime = false;
  showOtherMealDate($('meal-other-date').hidden);
});
// Freeze only when editing begins; merely expanding the summary retains Save time.
for (const id of ['meal-date', 'meal-clock']) {
  $(id).addEventListener('focus', () => { mealUseSaveTime = false; });
}
$('meal-date').addEventListener('input', () => { mealUseSaveTime = false; updateMealDateControls(); $('meal-error').textContent = ''; setMealFieldError('date'); });
$('meal-date').addEventListener('change', () => { mealUseSaveTime = false; updateMealDateControls(); });
$('meal-type').addEventListener('change', () => { mealAutoType = false; $('meal-auto-hint').hidden = true; });
$('meal-clock').addEventListener('input', () => { mealUseSaveTime = false; syncMealTypeFromClock(); clearChangedMealPreset(); $('meal-error').textContent = ''; setMealFieldError('clock'); });
$('meal-clock').addEventListener('change', () => { mealUseSaveTime = false; syncMealTypeFromClock(); });
$('meal-last-time').addEventListener('click', () => {
  const last = state.events[0];
  if (!last || last.at > Date.now()) return;
  mealUseSaveTime = false;
  setMealDateTime(last.at, last);
  $('meal-error').textContent = ''; clearMealFieldErrors();
});
$('timer-pause').addEventListener('click',async()=>{const res=await action({type:'timer-pause'},null);if(res)toast(res.paused?t('toast.paused'):t('toast.resumed'),res.canUndo);});
$('timer-reset').addEventListener('click', () => { if (!busy && !$('timer-reset').disabled) $('reset-dialog').showModal(); });
$('confirm-reset').addEventListener('click', async () => {
  const button = $('confirm-reset');
  if (button.disabled) return;
  button.disabled = true;
  $('reset-error').textContent = '';
  try {
    if (await action({ type: 'timer-reset' }, t('toast.reset'))) $('reset-dialog').close();
    else $('reset-error').textContent = lastActionError;
  } finally { button.disabled = false; }
});
$('reset-dialog').addEventListener('close', () => $('timer-goal').focus({ preventScroll: true }));
$('meal-dialog').addEventListener('cancel', event => { event.preventDefault(); requestMealClose(); });
$('discard-meal').addEventListener('click', () => {
  $('discard-meal-dialog').close();
  $('meal-dialog').close();
});
$('goal-enabled').addEventListener('change', () => {
  goalDirty.enabled = true;
  if ($('goal-enabled').checked) goalDirty.hours = true;
  $('goal-error').textContent = '';
  updateGoalControls();
});
$('goal-input').addEventListener('input', () => {
  goalDirty.hours = true;
  goalDirty.enabled = true;
  $('goal-error').textContent = '';
  updateGoalControls();
});
$('notifications-input').addEventListener('change', () => { goalDirty.notifications = true; });
$('plan-start').addEventListener('input', () => { goalDirty.start = true; updateGoalControls(); });
document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => {
  // Pressing the chosen plan again drops it and keeps the hours as a plain goal.
  goalPlan = goalPlan === button.dataset.plan ? null : button.dataset.plan;
  goalDirty.enabled = true;
  goalDirty.hours = true;
  $('goal-enabled').checked = true;
  if (goalPlan) $('goal-input').value = C.FAST_PLANS[goalPlan].fastHours;
  $('goal-error').textContent = '';
  updateGoalControls();
}));
document.querySelectorAll('[data-goal-preset]').forEach(button => button.addEventListener('click', () => {
  goalPlan = null;
  goalDirty.enabled = true;
  goalDirty.hours = true;
  $('goal-enabled').checked = true;
  $('goal-input').value = button.dataset.goalPreset;
  $('goal-error').textContent = '';
  updateGoalControls();
}));
$('goal-dialog').addEventListener('cancel', event => { if (goalSaving) event.preventDefault(); });
document.querySelectorAll('[data-welcome-plan]').forEach(button => button.addEventListener('click', () => { welcomePlan = button.dataset.welcomePlan; showWelcomeStep(welcomeStep); }));
['age', 'height', 'weight'].forEach(id => $(`welcome-${id}`).addEventListener('input', () => showWelcomeStep(welcomeStep)));
$('welcome-back').addEventListener('click', () => showWelcomeStep(Math.max(1, welcomeStep - 1)));
$('welcome-skip').addEventListener('click', () => finishWelcome(false));
$('welcome-dialog').addEventListener('cancel', event => { event.preventDefault(); finishWelcome(false); });
$('welcome-form').addEventListener('submit', event => {
  event.preventDefault();
  if (welcomeStep === 2 && welcomeBodyEntered()) {
    const value = id => $(`welcome-${id}`).value === '' ? null : $(`welcome-${id}`).valueAsNumber;
    const age = value('age'), height = value('height'), weight = value('weight');
    const bad = (age !== null && (!Number.isInteger(age) || age < 10 || age > 120)) || (height !== null && !(height >= 100 && height <= 250)) || (weight !== null && !(weight >= 25 && weight <= 300));
    if (bad) { $('welcome-error').textContent = t('settings.bodyInvalid'); return; }
  }
  if (welcomeStep < 3) { showWelcomeStep(welcomeStep + 1); return; }
  finishWelcome(true);
});
$('goal-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (goalSaving || !goalBaseline) return;
  const enabled = $('goal-enabled').checked;
  const hours = $('goal-input').valueAsNumber;
  const error = $('goal-error');
  error.textContent = '';
  if (enabled && goalPlan && !C.validWindowStart($('plan-start').value)) {
    error.textContent = t('plan.invalidStart');
    $('plan-start').focus();
    return;
  }
  if (enabled && (!Number.isInteger(hours) || hours < 8 || hours > 24)) {
    error.textContent = t('settings.goalInvalid');
    $('goal-input').focus();
    return;
  }
  const patch = {};
  if (goalDirty.enabled || (enabled && goalDirty.hours)) patch.goalEnabled = enabled;
  if (enabled && goalDirty.hours) patch.goalHours = hours;
  if (goalDirty.notifications) patch.notifications = $('notifications-input').checked;
  const planNow = enabled ? goalPlan : null;
  if (planNow !== goalBaseline.plan) patch.plan = planNow;
  if (planNow && (patch.plan || goalDirty.start)) patch.windowStart = $('plan-start').value;
  if (!Object.keys(patch).length) { $('goal-dialog').close(); return; }
  goalSaving = true;
  const controls = [...$('goal-form').querySelectorAll('button, input')];
  controls.forEach(control => { control.disabled = true; });
  $('goal-form').setAttribute('aria-busy', 'true');
  try {
    const result = await action({ type: 'settings', patch }, null);
    if (!result) { error.textContent = lastActionError || t('settings.saveFailed'); return; }
    $('goal-dialog').close();
    const savedGoal = result.state.settings;
    toast(savedGoal.goalEnabled ? t('toast.goalSet', { h: savedGoal.goalHours }) : t('toast.goalOff'), result.canUndo);
  } finally {
    goalSaving = false;
    controls.forEach(control => { control.disabled = false; });
    updateGoalControls();
    $('goal-form').removeAttribute('aria-busy');
  }
});
$('add-history').addEventListener('click',()=>openMeal());
let chartDateOpener = null;
$('chart-date-menu')?.addEventListener('click', event => {
  chartDateOpener = event.currentTarget;
  const stats = C.weeklyStats(state, Date.now(), tz());
  $('chart-date-list').innerHTML = stats.daily.map(day => {
    const duration = day.longestInterval ? shortDuration(day.maxIntervalMs) : t('stats.dayNoData');
    return `<button type="button" class="settings-link" data-effect-date="${esc(day.date)}"><span class="settings-row-copy"><strong>${esc(day.date)}</strong><small>${esc(duration)}</small></span></button>`;
  }).join('');
  $('chart-date-dialog').showModal();
});
$('chart-date-dialog')?.addEventListener('close', () => {
  const opener = chartDateOpener;
  chartDateOpener = null;
  requestAnimationFrame(() => opener?.isConnected && opener.focus({ preventScroll: true }));
});
$('intake-add')?.addEventListener('click', () => openMeal(null, true));
$('meal-dialog').addEventListener('close', () => {
  // A native command can reopen the same dialog before its queued close event
  // arrives. That old event must not reset the new draft's save contract.
  if ($('meal-dialog').open) return;
  mealUseSaveTime = false;
  mealStartsTimer = false;
  returnToMealAfterSettings = false;
  const edited = editingId;
  if ($('intake-dialog')?.open) {
    renderIntake();
    const item = [...$('intake-day-meals').querySelectorAll('[data-intake-edit]')].find(button => button.dataset.intakeEdit === edited);
    (item || $('intake-add')).focus({ preventScroll: true });
  } else if (document.body.dataset.page === 'history') {
    const items = [...document.querySelectorAll('#history-list [data-edit]')];
    const item = items.find(button => button.dataset.edit === edited);
    (item || (edited && items[Math.min(mealReturnIndex, items.length - 1)]) || $('add-history')).focus({ preventScroll: true });
  } else if (mealOpener?.isConnected && mealOpener !== document.body) mealOpener.focus({ preventScroll: true });
  mealOpener = null;
  mealBaseline = null;
});


$('settings-button').addEventListener('click', () => openSettings());
$('settings-food-ai-open').addEventListener('click', () => showFoodAiSettings($('settings-food-ai-open').getAttribute('aria-expanded') !== 'true'));
$('restore-recovery-shortcut').addEventListener('click', () => { openSettings(); $('settings-backup').open = true; $('restore-recovery').scrollIntoView({ block: 'nearest' }); });
$('energy-profile').addEventListener('click', () => openSettings(true));
$('color-theme-input').addEventListener('change',()=>applyColorTheme($('color-theme-input').value));
$('timer-gradient-input').addEventListener('change',()=>{
  timerGradientPreview = $('timer-gradient-input').value;
  applyTimerGradient(timerGradientPreview);
  renderTimerGradientPreview();
  renderDialGradient(dialGradientProgress, dialGradientActive);
});
$('settings-dialog').addEventListener('close', () => {
  if (!providerDraftCommitted) window.MealFoods?.revertProviderDraft?.();
  providerDraftCommitted = false;
  applyColorTheme(prefs.colorTheme);
  discardTimerGradientPreview();
  if (returnToMealAfterSettings && $('meal-dialog').open) {
    returnToMealAfterSettings = false;
    requestAnimationFrame(() => $('meal-note')?.focus({ preventScroll: true }));
  }
  if ($('fasting-dialog').open && fastingSelection?.live) openFastingDetail(fastingSelection);
});
window.addEventListener('meal:ai-settings', openMealAiSettings);
for (const id of ['activity-dialog', 'workout-dialog']) {
  $(id)?.addEventListener('close', () => {
    if ($('fasting-dialog').open && fastingSelection) openFastingDetail(fastingSelection);
  });
}
$('fasting-dialog').addEventListener('close',()=>{
  const origin = effectOpener;
  const target = origin?.isConnected ? origin : [...document.querySelectorAll('#weekly-chart button, #interval-list button')].find(button => origin && (
    origin.dataset.effectDate && button.dataset.effectDate === origin.dataset.effectDate ||
    origin.dataset.effectFrom && button.dataset.effectFrom === origin.dataset.effectFrom && button.dataset.effectTo === origin.dataset.effectTo
  ));
  if (origin) (target || document.querySelector('.nav-item.active'))?.focus({preventScroll:true});
  effectOpener = null;
});
$('theme-button').addEventListener('click',()=>action({type:'settings',patch:{theme:theme==='light'?'dark':'light',themeAuto:false}},null,false));
$('mini-button').addEventListener('click',()=>action({type:'mini'},null,false));
$('expand-button').addEventListener('click',()=>action({type:'mini'},null,false));
$('pin-window').addEventListener('click',async()=>{
  if(!ready||pinBusy||!windowInfo||windowInfo.mini)return;
  const desired=!windowInfo.alwaysOnTop;pinBusy=true;applyWindowInfo(windowInfo);
  try{const result=await window.desktop.action({type:'set-window-pin',value:desired});if(!result.ok)throw new Error(result.error);applyWindowInfo(result.window);}
  catch(error){toast(error.message||t('toast.pinFailed'),false);}
  finally{pinBusy=false;applyWindowInfo(windowInfo);}
});
document.querySelectorAll('[data-window-menu]').forEach(button=>button.addEventListener('click',()=>{const r=button.getBoundingClientRect();action({type:'window-menu',name:button.dataset.windowMenu,x:r.left,y:r.bottom},null,false);}));
$('undo-button').addEventListener('click',()=>action({type:'undo'},t('toast.undone'),false));
$('toast-close').addEventListener('click', hideToast);
window.addEventListener('resize', fitMiniToast);
$('load-more').addEventListener('click',()=>{historyLimit+=60;renderHistory();});
['history-search', 'history-type-filter', 'history-date-filter'].forEach(id => ['input','change'].forEach(name => $(id).addEventListener(name, () => { historyLimit = 60; renderHistory(); })));
$('export-history').addEventListener('click', () => exportData());
$('export-settings').addEventListener('click', () => exportData());
// ───────── device sync panel (optional; the work happens in pwa.js or main.js)
let syncPanelBusy = false;
function syncMessage(text, isError = false) { const el = $('sync-message'); el.textContent = text; el.classList.toggle('form-error', isError); el.setAttribute('role', isError ? 'alert' : 'status'); }
function renderSyncPanel(summary) {
  const group = $('settings-sync');
  group.hidden = !summary || !summary.available;
  if (group.hidden) return;
  $('sync-off').hidden = summary.enabled;
  $('sync-on').hidden = !summary.enabled;
  if (!summary.enabled) $('sync-code-box').hidden = true;
  $('sync-create').disabled = $('sync-join').disabled = summary.serviceReady === false;
  $('sync-status').textContent = summary.serviceReady === false ? t('sync.serviceUnavailable') : !summary.enabled ? t('sync.statusOff')
    : summary.failed ? t('sync.statusFailed')
    : summary.lastSyncAt ? t('sync.statusOn', { when: dateTime(summary.lastSyncAt) }) : t('sync.statusNever');
}
async function refreshSyncPanel() {
  if (typeof window.desktop.action !== 'function') return;
  const result = await window.desktop.action({ type: 'sync-status' });
  renderSyncPanel(result && result.ok ? result.sync : null);
}
async function runSyncAction(payload, working) {
  if (syncPanelBusy) return null;
  syncPanelBusy = true;
  document.querySelectorAll('#settings-sync button').forEach(button => { button.disabled = true; });
  syncMessage(working);
  try {
    const result = await window.desktop.action(payload);
    if (!result || !result.ok) { syncMessage((result && result.error) || t('settings.saveFailed'), true); return null; }
    return result;
  } finally {
    syncPanelBusy = false;
    document.querySelectorAll('#settings-sync button').forEach(button => { button.disabled = false; });
    await refreshSyncPanel();
  }
}
// Shown in groups of five that wrap as whole groups on narrow screens; the full code stays in data-code for copying.
const SYNC_QR_PREFIX = 'dansik-sync:';
function showSyncCode(code) {
  const box = $('sync-code-text');
  box.dataset.code = code;
  box.replaceChildren(...code.split('-').map(part => { const group = document.createElement('span'); group.textContent = part; return group; }));
  const qr = $('sync-qr');
  try { qr.innerHTML = window.FastingQr.toSvg(window.FastingQr.encode(SYNC_QR_PREFIX + code.replace(/-/g, '')), { margin: 2 }); qr.hidden = false; }
  catch (_) { qr.innerHTML = ''; qr.hidden = true; } // the text code always works without the QR
  $('sync-code-box').hidden = false;
}
$('sync-check-service').addEventListener('click', async () => {
  const result = await runSyncAction({ type: 'sync-check-service' }, t('sync.working'));
  if (result) renderSyncPanel(result.sync);
});
$('sync-create').addEventListener('click', async () => {
  const result = await runSyncAction({ type: 'sync-enable', mode: 'create' }, t('sync.working'));
  if (!result) return;
  renderSyncPanel(result.sync); showSyncCode(result.code); syncMessage(t('sync.created'));
});
async function joinSync(code) {
  const result = await runSyncAction({ type: 'sync-enable', mode: 'join', code }, t('sync.working'));
  if (!result) return;
  $('sync-code-input').value = '';
  renderSyncPanel(result.sync); syncMessage(t('sync.joined'));
}
$('sync-join').addEventListener('click', () => joinSync($('sync-code-input').value));
// A scanned QR must be one of ours; anything else is refused before it can reach the server.
function codeFromScan(text) {
  const body = String(text || '').trim();
  const value = body.startsWith(SYNC_QR_PREFIX) ? body.slice(SYNC_QR_PREFIX.length) : null;
  const symbols = value && window.FastingSync.normalizeCode(value);
  return symbols ? window.FastingSync.formatCode(symbols) : null;
}
let syncScanStop = null;
function stopSyncScan() {
  if (syncScanStop) { syncScanStop(); syncScanStop = null; }
  $('sync-scan-preview').hidden = true;
}
async function joinFromScan(text) {
  const code = codeFromScan(text);
  if (!code) { syncMessage(t('sync.scanBad'), true); return; }
  $('sync-code-input').value = code;
  await joinSync(code);
}
$('sync-scan').addEventListener('click', async () => {
  if (syncScanStop || syncPanelBusy) return;
  if (!window.FastingQr || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('sync-scan-file').click(); return; }
  syncMessage('');
  $('sync-scan-preview').hidden = false;
  let finished = false;
  const stop = await window.FastingQr.startCamera($('sync-scan-video'), {
    onResult: text => { finished = true; stopSyncScan(); joinFromScan(text); },
    onError: reason => { finished = true; stopSyncScan(); syncMessage(t(reason === 'permission' || reason === 'unsupported' ? 'sync.scanPermission' : 'sync.scanFail'), true); }
  });
  if (finished) stop(); else syncScanStop = stop;
});
$('sync-scan-stop').addEventListener('click', stopSyncScan);
$('sync-scan-photo').addEventListener('click', () => $('sync-scan-file').click());
$('sync-scan-file').addEventListener('change', async () => {
  const file = $('sync-scan-file').files[0];
  $('sync-scan-file').value = '';
  if (!file) return;
  const text = window.FastingQr ? await window.FastingQr.decodeFile(file) : null;
  if (!text) { syncMessage(t('sync.scanFail'), true); return; }
  await joinFromScan(text);
});
$('settings-dialog').addEventListener('close', stopSyncScan);
$('sync-now').addEventListener('click', async () => {
  const result = await runSyncAction({ type: 'sync-now' }, t('sync.working'));
  if (!result) { refreshSyncPanel(); return; }
  renderSyncPanel(result.sync);
  const c = result.changes || {};
  const incoming = (c.added || 0) + (c.updated || 0) + (c.removed || 0), outgoing = c.sent || 0;
  syncMessage(incoming || outgoing ? t('sync.done', { in: incoming, out: outgoing }) : t('sync.nothing'));
});
$('sync-show').addEventListener('click', async () => {
  const result = await runSyncAction({ type: 'sync-show-code' }, '');
  if (result) { showSyncCode(result.code); syncMessage(''); }
});
$('sync-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('sync-code-text').dataset.code); syncMessage(t('sync.copied')); }
  catch (_) { syncMessage($('sync-code-text').dataset.code); }
});
$('sync-disable').addEventListener('click', async () => {
  const result = await runSyncAction({ type: 'sync-disable', deleteServer: $('sync-delete-server').checked }, t('sync.working'));
  if (!result) return;
  $('sync-delete-server').checked = false;
  renderSyncPanel(result.sync); syncMessage(t('sync.turnedOff'));
});
$('export-settings-recovery').addEventListener('click', async () => { const result = await action({type:'export-settings-recovery'}, null, false); if (result?.exported) toast(t('toast.exported')); });
$('export-restore-recovery').addEventListener('click', async () => { const result = await action({type:'export-restore-recovery'}, null, false); if (result?.exported) toast(t('toast.exported')); });
$('restore-confirm').addEventListener('change', () => { $('resolve-restore-conflict').disabled = !$('restore-confirm').checked; });
$('resolve-restore-conflict').addEventListener('click', async () => {
  if (!$('restore-confirm').checked) return;
  const result = await action({type:'resolve-restore-conflict',confirm:true}, null, false);
  if (result) { updateSettingsStatus(); toast(t('settings.restoreResolved')); }
});
async function importData() {
  const result = await action({type:'import-preview'}, null, false);
  if (!result || !result.picked) return;
  const p = result.preview;
  const range = p.count ? `${dateTime(p.oldestAt)} ~ ${dateTime(p.newestAt)}` : t('import.noRecords');
  $('import-summary').textContent = t('import.summary', { name: p.name, kind: p.kind === 'csv' ? t('import.kindCsv') : t('import.kindJson'), count: p.count, range });
  $('import-merge-text').firstChild.textContent = t('import.mergeAdd', { added: p.added });
  $('import-merge-text').querySelector('small').textContent = p.skipped ? t('import.mergeSkip', { current: p.current, skipped: p.skipped }) : t('import.mergeKeep', { current: p.current });
  $('import-replace-text').firstChild.textContent = t('import.replaceCount', { current: p.current, count: p.count });
  $('import-replace-text').querySelector('small').textContent = t('import.replaceHelp');
  const weights = p.weights;
  if (weights) {
    const mergeHint = weights.incoming === null
      ? t('import.weightKeep', { current: weights.current })
      : t('import.weightMerge', { current: weights.current, added: weights.added });
    const replaceHint = weights.incoming === null
      ? t('import.weightKeep', { current: weights.current })
      : t('import.weightReplace', { current: weights.current, incoming: weights.incoming });
    $('import-merge-text').querySelector('small').textContent += ' ' + mergeHint;
    $('import-replace-text').querySelector('small').textContent = replaceHint;
  }
  if (p.hasPortablePrefs) {
    $('import-merge-text').querySelector('small').textContent += ' ' + t('import.fullMerge', { n: p.activityIncoming });
    $('import-replace-text').querySelector('small').textContent += ' ' + t('import.fullReplace');
    $('import-summary').textContent += ' ' + t('import.fullCaution');
    if (p.activityFuture) $('import-summary').textContent += ' ' + t('import.futureActivity', { n: p.activityFuture });
  }
  $('import-mode-merge').checked = true;
  $('import-mode-replace').disabled = p.kind === 'csv';
  if (p.kind === 'csv') {
    $('import-summary').textContent += ' ' + t('import.csvMergeOnly');
    $('import-replace-text').querySelector('small').textContent = t('import.csvMergeOnly');
  }
  $('import-error').textContent = '';
  $('import-dialog').showModal();
}
$('import-settings').addEventListener('click',importData);
$('import-cancel').addEventListener('click',()=>$('import-dialog').close());
$('import-dialog').addEventListener('close',()=>{window.desktop.action({type:'import-cancel'}).catch(()=>{});});
$('import-confirm').addEventListener('click',async()=>{
  const result = await action({type:'import-commit',mode:document.querySelector('input[name=import-mode]:checked').value}, t('import.done'));
  if (result) { $('import-dialog').close(); $('settings-dialog').close(); }
  else $('import-error').textContent = lastActionError || t('import.failed');
});
$('meal-form').addEventListener('invalid', event => {
  if (event.target.closest('#meal-when')) $('meal-when').open = true;
}, true);
$('meal-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if (busy || !$('meal-dialog').open) return;
  if (window.MealFoods.prepareSave?.() === false) return;
  const original = editingSnapshot;
  if (!$('meal-date').value) { const message = t('meal.dateMissing'); showOtherMealDate(true); showMealFieldValidation('date', message); return; }
  const saveNow = Date.now();
  const local = mealUseSaveTime ? localInput(saveNow) : mealLocalValue();
  clearChangedMealPreset();
  const exact = !mealUseSaveTime && mealExactPreset ? mealExactPreset.at : null;
  // Leaving the time field alone keeps the stored time (including its seconds) untouched.
  const timeUntouched = !!original && local === localInput(original.at) && (exact === null || exact === original.at);
  const at = mealUseSaveTime ? saveNow : exact === null ? C.parseLocalInput(local, tz()) : exact;
  if(!timeUntouched&&(!Number.isSafeInteger(at)||at>Date.now()||at<C.MIN_DATE)){const message=t('meal.timeRange');showMealFieldValidation('clock', message);return;}
  if(!timeUntouched&&localInput(at)!==local){const message=t('meal.invalidLocal');showMealFieldValidation('clock', message);return;}
  let foods;
  try { foods = window.MealFoods.read({ confirmAnalysis: true }); }
  catch (error) { $('meal-error').textContent = L.err(error); return; }
  const patch = { type: $('meal-type').value, note: $('meal-note').value.trim(), foods };
  if (!timeUntouched) patch.at = at;
  const saveButton = $('save-meal'), saveLabel = saveButton.textContent;
  saveButton.textContent = t('meal.saving');
  try {
    const result=await action(editingId?{type:'update',id:editingId,patch,expectedMeal:original}:{type:'add',patch,startTimer:mealStartsTimer},t('toast.mealSaved'));
    if(result) {
      if (mealStartsTimer) pulse(document.querySelector('.dial-wrap'), 'just-recorded', 900);
      $('meal-dialog').close();
    } else $('meal-error').textContent=lastActionError||t('meal.saveFailed');
  } finally { saveButton.textContent = saveLabel; }
});
$('delete-meal').addEventListener('click',()=>{$('delete-error').textContent='';$('delete-dialog').showModal();});
$('confirm-delete').addEventListener('click',async()=>{const result=await action({type:'delete',id:editingId,expectedMeal:editingSnapshot},t('toast.mealDeleted'));if(result){$('delete-dialog').close();$('meal-dialog').close();}else $('delete-error').textContent=lastActionError||t('delete.failed');});
$('settings-form').addEventListener('invalid', event => {
  const group = event.target.closest('.settings-group');
  if (group) group.open = true;
}, true);
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const dialog = $('settings-dialog');
  const error = $('settings-error');
  const submit = event.currentTarget.querySelector('[type="submit"]');
  if (submit.disabled) return;
  error.textContent = '';
  const profileOnly = dialog.classList.contains('settings-profile-only');
  const age = Number($('age-input').value), heightCm = Math.round(Number($('height-input').value) * 10) / 10, weightKg = Math.round(Number($('weight-input').value) * 10) / 10;
  if (!Number.isInteger(age) || age < 10 || age > 120 || heightCm < 100 || heightCm > 250 || weightKg < 25 || weightKg > 300 || !Number.isFinite(heightCm) || !Number.isFinite(weightKg)) {
    error.textContent = t('settings.bodyInvalid');
    return;
  }
  const wanted = { sex: $('sex-input').value, age, heightCm, weightKg, activityLevel: $('activity-input').value, profileConfirmed: $('profile-confirmed-input').checked };
  const baseline = settingsBaseline || { prefs, settings: state.settings };
  let settingsPatch = {};
  if (!profileOnly) {
    Object.assign(wanted, {
      tray: $('tray-input').checked,
      language: $('language-input').value,
      timeZone: $('timezone-input').value,
      colorTheme: $('color-theme-input').value,
      timerGradient: $('timer-gradient-input').value
    });
    if (prefs.canAutoStart) wanted.autoStart = $('autostart-input').checked;
    if (document.body.classList.contains('is-pwa')) wanted.backupReminder = $('backup-reminder-input').checked;
    const themeAuto = $('theme-auto-input').checked;
    const options = { themeAuto };
    settingsPatch = Object.fromEntries(Object.entries(options).filter(([key, value]) => value !== baseline.settings[key]));
    if (settingsPatch.themeAuto === false && state.settings.themeAuto) settingsPatch.theme = theme;
  }
  const changed = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => value !== baseline.prefs[key]));
  submit.disabled = true;
  try {
    if (Object.keys(changed).length) {
      const saved = await window.desktop.action({ type: 'prefs', patch: changed });
      if (!saved.ok) throw new Error(saved.error || t('settings.saveFailed'));
      prefs = saved.prefs;
      if (saved.state) applySnapshot(saved);
      if (settingsBaseline === baseline) Object.assign(baseline.prefs, changed);
    }
    let canUndo = false;
    if (Object.keys(settingsPatch).length) {
      const result = await action({ type: 'settings', patch: settingsPatch }, null);
      if (!result) throw new Error(lastActionError || t('settings.saveFailed'));
      canUndo = result.canUndo;
    }
    window.MealFoods?.commitProviderDraft?.();
    providerDraftCommitted = true;
    dialog.close();
    toast(t('toast.settingsSaved'), canUndo);
  } catch (cause) {
    error.textContent = L.err(cause) || t('settings.saveFailed');
  } finally {
    submit.disabled = false;
  }
});
function openHelp(scrollToShortcuts) {
  $('about-version').textContent = appInfo.version ? t('help.version', { version: appInfo.version }) : '';
  if (!$('help-dialog').open) { helpOpener = document.activeElement; $('help-dialog').showModal(); }
  if (scrollToShortcuts) $('shortcuts-title').scrollIntoView({block:'start'});
}
$('help-dialog').addEventListener('close', () => {
  if ($('help-dialog').open) return;
  const usable = helpOpener?.isConnected && ![document.body, document.documentElement].includes(helpOpener) && !helpOpener.disabled && helpOpener.getClientRects().length &&
    !helpOpener.closest('[hidden], [inert]') && (!helpOpener.closest('dialog') || helpOpener.closest('dialog').open);
  const target = usable ? helpOpener : document.querySelector('dialog[open] .icon-button') || document.querySelector('.nav-item.active');
  target?.focus({ preventScroll: true });
  helpOpener = null;
});
$('settings-help')?.addEventListener('click', () => openHelp(false));
const MEAL_KEYS = { '1': 'breakfast', '2': 'lunch', '3': 'dinner', '4': 'snack' };
document.querySelectorAll('[data-meal]').forEach(button => { const key = Object.keys(MEAL_KEYS).find(k => MEAL_KEYS[k] === button.dataset.meal); button.setAttribute('aria-keyshortcuts', `Control+${key}`); button.title = t('meal.hint', { meal: mealName(button.dataset.meal), key }); });
document.addEventListener('keydown',event=>{
  const dialogOpen=!!document.querySelector('dialog[open]');
  if(event.key==='F1'){event.preventDefault();openHelp(false);return;}
  if(!(event.ctrlKey||event.metaKey)||event.altKey||dialogOpen||!ready)return;
  const key=event.key.toLowerCase();
  if(key==='z'){if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();action({type:'undo'},t('toast.undone'),false);}return;}
  if(MEAL_KEYS[key]){event.preventDefault();openMealForType(MEAL_KEYS[key]);return;}
  if(key==='n'){event.preventDefault();openMeal();}
  else if(key==='m'){event.preventDefault();action({type:'mini'},null,false);}
  else if(key===','){event.preventDefault();openSettings();}
});
window.addEventListener('focus',()=>{tick();renderStats();});
window.addEventListener('dansik:photo-pair',event=>toast(event.detail));
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();renderStats();}});
document.querySelectorAll('[data-meal]').forEach(button=>{button.disabled=true;});
if(window.desktop){
  window.desktop.onState(snapshot=>{if(snapshot.state)applySnapshot(snapshot);if(snapshot.warning)showWarning(snapshot.warning);});
  window.desktop.onMode(mini=>{document.body.classList.toggle('mini',mini);placeToast();});
  window.desktop.onCommand(name=>{
    if (name?.type === 'meal-entry' && C.TYPES.includes(name.meal)) {
      pendingMealEntries.push(name.meal);
      drainPendingMealEntry();
    } else if(name==='help'||name==='about')openHelp(false);
    else if(name==='shortcuts')openHelp(true);
  });
  window.desktop.getState().then(result => {
    if (!result.ok) throw new Error(result.error);
    applySnapshot(result);
    document.querySelectorAll('[data-meal]').forEach(button => { button.disabled = false; });
  }).catch(error => {
    showWarning(t('error.loadFailed', { message: error.message }));
    $('save-status').textContent = t('footer.loadFailed');
  });
}else{showWarning(t('error.desktopOnly'));}
setInterval(tick,1000);
setInterval(()=>{if(ready)renderStats();},60000);

function showPreparedUpdate() {
  $('pwa-update-notice').hidden = document.body.dataset.pwaUpdateReady !== 'true';
}
window.addEventListener('dansik:update-ready', showPreparedUpdate);
$('pwa-update-apply').addEventListener('click', async () => {
  const result = await window.desktop.action({ type: 'apply-update' });
  if (!result.ok) toast(result.error);
});
showPreparedUpdate();
document.addEventListener('close', () => {
  if (pendingMealEntries.length) setTimeout(drainPendingMealEntry, 0);
}, true);
