'use strict';
const C = window.FastingCore;
const I18N = window.FastingI18n;
const $ = id => document.getElementById(id);
// iOS can retain :focus-visible after a touch opens or closes a dialog.
// Keep keyboard focus styling available as soon as keyboard input resumes.
document.addEventListener('pointerdown', event => {
  document.body.classList.toggle('touch-focus', event.pointerType === 'touch');
}, true);
document.addEventListener('keydown', () => document.body.classList.remove('touch-focus'), true);
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
  settings: '<path d="m9 3-1 3-3 1-2 3 2 3v4l4 1 3 3 3-3 4-1v-4l2-3-2-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
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
function kcalText(value, compact = false) { return t('timer.kcalValue', { kcal: new Intl.NumberFormat(L.locale, { maximumFractionDigits: 1, notation: compact && value >= 10000 ? 'compact' : 'standard' }).format(value) }); }
function fatTrendKey(elapsedMs) {
  const stage = C.getAutophagyStage(elapsedMs);
  return !stage.active ? 'effects.trendEmpty' : stage.stage > 0 ? 'effects.trendFat' : 'effects.trendMixed';
}
let state = C.defaultState();
let busy = false;
let editingId = null;
let editingSnapshot = null;
let settingsBaseline = null;
let mealStartsTimer = false;
let mealDateDay = '';
let mealLastKey = '';
let mealExactPreset = null;
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
  document.querySelectorAll('[data-meal]').forEach(button => { const key = Object.keys(MEAL_KEYS).find(k => MEAL_KEYS[k] === button.dataset.meal); button.title = t('meal.hint', { meal: mealName(button.dataset.meal), key }); });
  if (windowInfo) applyWindowInfo(windowInfo);
}
function placeToast(page = document.body.dataset.page || 'timer') {
  const element = $('toast');
  if (page === 'insights') {
    const insights = $('page-insights');
    const heading = insights.querySelector('.page-heading');
    if (heading && element.parentElement !== insights) heading.after(element);
  } else if (element.parentElement !== document.body) {
    document.body.append(element);
  }
}
function toast(message, undo = false) { placeToast(); $('toast-message').textContent = message; $('undo-button').hidden = !undo; $('toast').hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('toast').hidden = true; }, undo ? 15000 : 5000); }
function showWarning(message) { $('warning').textContent = message || ''; $('warning').hidden = !message; }
function applyWindowInfo(info) {
  if(!info)return;
  windowInfo=info;
  document.body.classList.toggle('has-window-chrome',!!info.overlay);
  document.body.classList.toggle('mini',!!info.mini);
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
    lastActionError = error.message;
    $('save-status').textContent = t('footer.notSaved');
    toast(error.message, false);
    return null;
  } finally {
    busy = false;
    document.querySelectorAll('[data-meal],#save-meal,#confirm-delete').forEach(button => { button.disabled = !ready; });
  }
}
async function recordMealAndEdit(meal) {
  const result = await action({ type: 'record', meal }, t('toast.recorded', { meal: mealName(meal) }));
  if (!result?.recordedMealId) return null;
  // The response carries the exact persisted ID. Do not infer it from event order:
  // a different tab can add or move another meal while this action is in flight.
  if (!state.events.some(event => event.id === result.recordedMealId)) return null;
  if (document.body.classList.contains('mini')) {
    const expanded = await action({ type: 'mini' }, null, false);
    const mini = expanded?.window?.mini ?? expanded?.mini;
    if (mini !== false) return null;
    // The PWA changes mode through an event; use its confirmed response as a
    // fallback so the dialog cannot be opened inside the compact window.
    document.body.classList.remove('mini');
  }
  openMeal(result.recordedMealId, true);
  return result;
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
  energyButton.querySelector('.energy-label').textContent = t(burnedLabel);
  $('goal-time').textContent = conflict ? t('dayEnergy.noAmount') : kcalText(burned.totalKcal, true);
  const burnedAmount = conflict ? t('dayEnergy.activityConflict') : kcalText(burned.totalKcal);
  energyButton.setAttribute('aria-label', t('energy.homeAria', { amount: burnedAmount }) + ' · ' + window.FastingEnergy.activityNote(burned, prefs));
  intakeButton.disabled = energyButton.disabled = false;
  dailyCaloriesView = { ...snapshot, minute, prefs, events: state.events };
  return dailyCaloriesView;
}
function tick() {
  if (!ready) return;
  const now = Date.now();
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
  const remaining = !active || timer.clockSkew || laterMeal ? '' : timer.paused ? t('timer.paused') : state.settings.goalEnabled ? (timer.reached ? t('mini.reached') : t('mini.remaining', { d: shortDuration(timer.remainingMs) })) : '';
  $('goal-remaining').textContent = remaining;
  $('goal-remaining').hidden = !remaining;
  const nowP = C.tzParts(now, tz()), nowW = new Date(now).toLocaleDateString(L.locale, { weekday: 'long', ...tzOpt() });
  $('today-label').textContent = nowW.toUpperCase() + ' · MY LITTLE PAUSE';
  $('date-stamp').innerHTML = `<strong>${nowP.month}.${String(nowP.day).padStart(2,'0')}</strong>${nowW}`;
}
function row(event) {
  const meal = MEALS[event.type], name = mealName(event.type);
  const symbol = `<span class="row-icon ${event.type}">${icon(meal.icon)}</span>`;
  const foodNames = event.foods?.map(food => food.name).filter(Boolean).join(', ');
  const description = [foodNames, event.note, event.foods?.length ? kcalText(C.foodKcalTotal(event.foods)) : ''].filter(Boolean).join(' · ');
  const editAria = esc(t('history.editAria', { when: dateTime(event.at), meal: name }));
  return `<div class="history-row">${symbol}<button type="button" class="history-edit-copy" data-edit="${esc(event.id)}" aria-label="${editAria}"><strong>${name}</strong><span>${esc(description || t('history.noNote'))}</span></button><time datetime="${new Date(event.at).toISOString()}">${time(event.at)}</time><button class="icon-button" data-edit="${esc(event.id)}" aria-label="${editAria}">${icon('edit')}</button></div>`;
}
function renderHistory() {
  $('history-count').textContent = t('history.count', { n: state.events.length });
  if (!state.events.length) {
    $('history-list').innerHTML = `<div class="history-empty">${icon('history')}<h2>${t('history.emptyTitle')}</h2><p>${t('history.emptyText')}</p><button class="primary-button" data-add>${t('history.emptyAction')}</button></div>`;
  } else {
    let currentDay = '';
    $('history-list').innerHTML = state.events.slice(0, historyLimit).map(event => {
      const d = day(event.at); const header = currentDay !== d ? `<div class="history-group-label">${esc(t('date.year', { y: C.tzParts(event.at, tz()).year, rest: d }))}</div>` : '';
      currentDay = d; return header + row(event);
    }).join('');
  }
  $('load-more').hidden = state.events.length <= historyLimit;
}
function renderStats() {
  const now = Date.now();
  const stats = C.weeklyStats(state, now, tz());
  $('stat-meals').innerHTML = `${stats.totalMeals}<small>${t('stats.unitTimes')}</small>`;
  $('stat-days').innerHTML = `${stats.daily.filter(d => d.meals > 0).length}<small>${t('stats.unitDays')}</small>`;
  const longest = stats.mealIntervals.reduce((m, x) => Math.max(m, x.durationMs), 0);
  $('stat-gap').textContent = stats.mealIntervals.length ? shortDuration(longest) : t('stats.none');
  const max = Math.max(3600000, ...stats.daily.map(d => d.maxIntervalMs));
  $('weekly-chart').innerHTML = stats.daily.map((d,i) => {
    const duration = d.longestInterval ? shortDuration(d.maxIntervalMs) : t('stats.dayNoData');
    const hours = d.maxIntervalMs / 3600000;
    const value = d.longestInterval ? new Intl.NumberFormat(L.locale, { maximumFractionDigits: 1, notation: hours >= 1000 ? 'compact' : 'standard' }).format(hours) : '—';
    const date = d.date.split('-').slice(1).map(Number).join('.');
    return `<button type="button" class="chart-day ${i===6?'today':''}" data-effect-date="${d.date}" aria-haspopup="dialog" aria-controls="fasting-dialog" aria-label="${esc(t('stats.dayAria', { date: d.date, duration }))}"><span class="chart-value">${esc(value)}</span><span class="chart-bar" style="height:${Math.max(2,d.maxIntervalMs/max*52)}px" aria-hidden="true"></span><span class="chart-label">${date}</span></button>`;
  }).join('');
  $('weekly-chart').setAttribute('aria-label', t('stats.weekAria', { list: stats.daily.map(d => t('stats.weekItem', { date: d.date, duration: d.longestInterval ? shortDuration(d.maxIntervalMs) : t('stats.dayNoData') })).join(', ') }));
  $('interval-list').innerHTML = stats.mealIntervals.length ? stats.mealIntervals.slice(0,7).map(interval => `<button type="button" class="interval-row" data-effect-from="${interval.from}" data-effect-to="${interval.to}" aria-haspopup="dialog" aria-controls="fasting-dialog" aria-label="${esc(t('effects.intervalAria', { from: intervalTime(interval.from), to: intervalTime(interval.to), duration: shortDuration(interval.durationMs) }))}"><span>${intervalPoint(interval.from)} → ${intervalPoint(interval.to)}</span><strong>${shortDuration(interval.durationMs)} <span aria-hidden="true">›</span></strong></button>`).join('') : `<p class="empty-recent">${t('stats.intervalsEmpty')}</p>`;
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
    <div class="day-energy-balance" data-energy-balance-row><span>${t('dayEnergy.balance')}</span><strong data-energy-balance>${balanceText}</strong></div>
    ${!conflict && balance === null ? `<p class="field-help">${t('dayEnergy.missing')}</p>` : ''}
    <p class="field-help">${esc(window.FastingEnergy.activityNote(daily, prefs))}</p>`;
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
      <span>${t('dayEnergy.balance')}</span><strong data-day-balance>${balanceText}</strong>
    </div>
    <p class="field-help">${esc(window.FastingEnergy.activityNote(burned, prefs))}</p>
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
  $('fasting-title').textContent = selection.live ? t('timer.goalArrival') : t('effects.dayTitle', { date: date ? new Date(date+'T12:00:00Z').toLocaleDateString(L.locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '' });
  renderDayCalories(selectedDay?.date, now);
  renderEnergyBreakdown(selection.live, now);
  $('energy-fasting-note').hidden = !selection.live || !interval;
  if (!interval) {
    $('fasting-detail').innerHTML = `<div class="effect-empty">${icon('leaf')}<strong>${t(laterMeal ? 'effects.mealAfterTitle' : 'effects.emptyTitle')}</strong><p>${t(laterMeal ? 'effects.mealAfter' : selection.live ? 'effects.emptyLive' : 'effects.emptyDay')}</p></div>`;
  } else {
    const trend = fatTrendKey(interval.durationMs);
    const rising = trend === 'effects.trendFat';
    const modelPrefs = selection.live ? { ...prefs, energyMode: 'activity' } : prefs;
    const kcal = window.FastingEnergy.estimate(interval, modelPrefs, !selection.live || !(prefs.timerPausedMs > 0));
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
      <div class="effect-energy"><span>${t(selection.live ? 'energy.fasting' : 'effects.energyTitle')}</span><strong>${kcalText(kcal.totalKcal)}</strong></div>${history}`;
    if (modelPrefs.energyMode === 'activity') {
      const note = document.createElement('p');
      note.className = 'effect-note';
      note.textContent = window.FastingEnergy.describe(kcal, modelPrefs);
      $('fasting-detail').append(note);
    }
  }
  if (!$('fasting-dialog').open) $('fasting-dialog').showModal();
  else if (interval) $('fasting-detail').querySelector('.effect-record-list [aria-pressed="true"]')?.focus({ preventScroll: true });
}
function render() {




  renderHistory(); renderStats(); tick();
}
function goPage(page) {
  document.body.dataset.page = page;
  placeToast(page);
  $('sr-status').textContent = { timer: t('sr.timer'), history: t('sr.history'), insights: t('sr.insights') }[page] || '';
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${page}`; });
  document.querySelectorAll('[data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page===page); if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
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
}
function setMealDateTime(at, exactMeal = null) {
  const local = localInput(at);
  mealExactPreset = exactMeal ? { id: exactMeal.id, at: exactMeal.at, local } : null;
  $('meal-date').value = local.slice(0, 10);
  $('meal-clock').value = local.slice(11, 16);
  const days = mealDayOptions();
  showOtherMealDate($('meal-date').value !== days.today && $('meal-date').value !== days.yesterday);
  updateMealDateControls();
}
function openMeal(id = null, showFoods = false, startTimer = false) {
  editingId = id;
  mealStartsTimer = !id && startTimer;
  const event = state.events.find(item => item.id === id);
  editingSnapshot = event ? C.clone(event) : null;
  $('meal-dialog-title').textContent = event ? t('meal.dialogEdit') : t('meal.dialogNew');
  $('meal-type').value = event?.type || 'breakfast';
  setMealDateTime(event?.at || Date.now());
  $('meal-note').value = event?.note || '';
  $('meal-error').textContent = '';
  clearMealFieldErrors();
  $('delete-meal').hidden = !event;
  window.MealFoods.open(event?.foods, showFoods);
  $('meal-dialog').showModal();
  const scroller = $('meal-dialog').querySelector('.meal-form-body');
  if (scroller) scroller.scrollTop = 0;
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
function openSettings(profileOnly = false) {
  const dialog = $('settings-dialog');
  const title = $('settings-title');
  title.dataset.i18n = profileOnly ? 'settings.group.profile' : 'settings.title';
  title.textContent = t(title.dataset.i18n);
  dialog.classList.toggle('settings-profile-only', profileOnly);
  dialog.querySelectorAll('.settings-group').forEach(group => {
    group.open = profileOnly && group.id === 'settings-profile';
  });
  const profile = C.normalizeProfile(prefs);
  $('sex-input').value = profile.sex;
  $('age-input').value = profile.age;
  $('height-input').value = profile.heightCm;
  $('weight-input').value = profile.weightKg;
  $('activity-input').value = profile.activityLevel;
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
  $('goal-enabled').checked = state.settings.goalEnabled;
  $('goal-input').value = state.settings.goalHours;
  $('goal-input').disabled = profileOnly;
  $('notifications-input').checked = state.settings.notifications;
  settingsBaseline = {
    prefs: {
      ...profile, tray: $('tray-input').checked, autoStart: $('autostart-input').checked,
      language: $('language-input').value, timeZone: $('timezone-input').value, colorTheme: $('color-theme-input').value, timerGradient: $('timer-gradient-input').value
    },
    settings: { ...state.settings }
  };
  $('settings-error').textContent = '';
  dialog.showModal();
  title.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}
async function exportData(format) {
  const chooser = $('export-dialog');
  if (!format && chooser && document.body.classList.contains('is-pwa')) {
    $('export-error').textContent = '';
    chooser.showModal();
    return;
  }
  const result = await action(format ? { type: 'export', format } : { type: 'export' }, null, false);
  if (result?.exported) {
    if (chooser?.open) chooser.close();
    toast(t('toast.exported'));
  } else if (chooser?.open && !result) {
    $('export-error').textContent = lastActionError || t('export.failed');
  }
}

icons();
$('dial-ticks').innerHTML = Array.from({length:60},(_,i) => { const a=i*Math.PI/30;const outer=187;const inner=i%5===0?179:183;return `<line class="dial-tick" x1="${180+inner*Math.sin(a)}" y1="${180-inner*Math.cos(a)}" x2="${180+outer*Math.sin(a)}" y2="${180-outer*Math.cos(a)}"/>`; }).join('');
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if(!button)return;
  if(button.dataset.meal) { recordMealAndEdit(button.dataset.meal); }
  else if(button.dataset.goal) { action({type:'settings',patch:{goalHours:Number(button.dataset.goal),goalEnabled:true}},t('toast.goalSet', { h: button.dataset.goal })); }
  else if(button.hasAttribute('data-offset')) { setMealDateTime(Date.now()-Number(button.dataset.offset)*60000); $('meal-error').textContent=''; }
  else if(button.dataset.page)goPage(button.dataset.page);
  else if(button.dataset.goto)goPage(button.dataset.goto);
  else if(button.dataset.edit)openMeal(button.dataset.edit);
  else if(button.dataset.intakeEdit)openMeal(button.dataset.intakeEdit, true);
  else if(button.dataset.exportFormat)exportData(button.dataset.exportFormat);
  else if(button.id==='intake-summary')openIntake();
  else if(button.id==='energy-summary')openFastingDetail({live:true},button);
  else if(button.dataset.effectDate)openFastingDetail({date:button.dataset.effectDate},button);
  else if(button.dataset.effectFrom) {
    const date = button.closest('.effect-record-list') ? fastingSelection?.date : undefined;
    openFastingDetail({ date, from: Number(button.dataset.effectFrom), to: Number(button.dataset.effectTo) }, button);
  }
  else if(button.hasAttribute('data-add'))openMeal();
  else if(button.dataset.close) {
    if (button.dataset.close === 'settings-dialog') discardTimerGradientPreview();
    $(button.dataset.close).close();
  }
});
document.querySelector('.brand').addEventListener('click', event => {event.preventDefault();goPage('timer');});
$('past-meal').addEventListener('click',()=>openMeal(null, true, true));
document.querySelectorAll('[data-meal-day]').forEach(button => button.addEventListener('click', () => {
  $('meal-date').value = mealDayOptions()[button.dataset.mealDay];
  showOtherMealDate(false);
  updateMealDateControls();
  $('meal-error').textContent = ''; clearMealFieldErrors();
}));
$('meal-other-toggle').addEventListener('click', () => showOtherMealDate($('meal-other-date').hidden));
$('meal-date').addEventListener('input', () => { updateMealDateControls(); $('meal-error').textContent = ''; setMealFieldError('date'); });
$('meal-date').addEventListener('change', updateMealDateControls);
$('meal-clock').addEventListener('input', () => { clearChangedMealPreset(); $('meal-error').textContent = ''; setMealFieldError('clock'); });
$('meal-last-time').addEventListener('click', () => {
  const last = state.events[0];
  if (!last || last.at > Date.now()) return;
  setMealDateTime(last.at, last);
  $('meal-error').textContent = ''; clearMealFieldErrors();
});
$('food-photo-pick').addEventListener('click', () => $('food-photo-file').click());
$('timer-pause').addEventListener('click',async()=>{const res=await action({type:'timer-pause'},null);if(res)toast(res.paused?t('toast.paused'):t('toast.resumed'),res.canUndo);});
$('timer-reset').addEventListener('click',()=>action({type:'timer-reset'},t('toast.reset')));
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
  if (!$('intake-dialog')?.open) return;
  const edited = editingId;
  renderIntake();
  const item = [...$('intake-day-meals').querySelectorAll('[data-intake-edit]')].find(button => button.dataset.intakeEdit === edited);
  (item || $('intake-add')).focus({ preventScroll: true });
});


$('settings-button').addEventListener('click', () => openSettings());
$('energy-profile').addEventListener('click', () => openSettings(true));
$('color-theme-input').addEventListener('change',()=>applyColorTheme($('color-theme-input').value));
$('timer-gradient-input').addEventListener('change',()=>{
  timerGradientPreview = $('timer-gradient-input').value;
  applyTimerGradient(timerGradientPreview);
  renderTimerGradientPreview();
  renderDialGradient(dialGradientProgress, dialGradientActive);
});
$('settings-dialog').addEventListener('close', () => {
  applyColorTheme(prefs.colorTheme);
  discardTimerGradientPreview();
  if ($('fasting-dialog').open && fastingSelection?.live) openFastingDetail(fastingSelection);
});
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
$('toast-close').addEventListener('click',()=>{$('toast').hidden=true;});
$('load-more').addEventListener('click',()=>{historyLimit+=60;renderHistory();});
$('export-history').addEventListener('click', () => exportData());
$('export-settings').addEventListener('click', () => exportData());
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
  $('import-mode-merge').checked = true;
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
$('meal-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if (window.MealFoods.prepareSave?.() === false) return;
  const original = editingSnapshot;
  if (!$('meal-date').value) { const message = t('meal.dateMissing'); showOtherMealDate(true); showMealFieldValidation('date', message); return; }
  const local = mealLocalValue();
  clearChangedMealPreset();
  const exact = mealExactPreset ? mealExactPreset.at : null;
  // Leaving the time field alone keeps the stored time (including its seconds) untouched.
  const timeUntouched = !!original && local === localInput(original.at) && (exact === null || exact === original.at);
  const at = exact === null ? C.parseLocalInput(local, tz()) : exact;
  if(!timeUntouched&&(!Number.isSafeInteger(at)||at>Date.now()||at<C.MIN_DATE)){const message=t('meal.timeRange');showMealFieldValidation('clock', message);return;}
  if(!timeUntouched&&localInput(at)!==local){const message=t('meal.invalidLocal');showMealFieldValidation('clock', message);return;}
  let foods;
  try { foods = window.MealFoods.read(); }
  catch (error) { $('meal-foods').open = true; $('meal-error').textContent = L.err(error); return; }
  const patch = { type: $('meal-type').value, note: $('meal-note').value.trim(), foods };
  if (!timeUntouched) patch.at = at;
  const result=await action(editingId?{type:'update',id:editingId,patch,expectedMeal:original}:{type:'add',patch,startTimer:mealStartsTimer},t('toast.mealSaved'));
  if(result)$('meal-dialog').close();else $('meal-error').textContent=lastActionError||t('meal.saveFailed');
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
  const goalHours = Number($('goal-input').value);
  if (!profileOnly && (!Number.isInteger(goalHours) || goalHours < 8 || goalHours > 24)) {
    error.textContent = t('settings.goalInvalid');
    return;
  }
  const age = Number($('age-input').value), heightCm = Math.round(Number($('height-input').value) * 10) / 10, weightKg = Math.round(Number($('weight-input').value) * 10) / 10;
  if (!Number.isInteger(age) || age < 10 || age > 120 || heightCm < 100 || heightCm > 250 || weightKg < 25 || weightKg > 300 || !Number.isFinite(heightCm) || !Number.isFinite(weightKg)) {
    error.textContent = t('settings.bodyInvalid');
    return;
  }
  const wanted = { sex: $('sex-input').value, age, heightCm, weightKg, activityLevel: $('activity-input').value };
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
    const themeAuto = $('theme-auto-input').checked;
    const options = { goalEnabled: $('goal-enabled').checked, goalHours, notifications: $('notifications-input').checked, themeAuto };
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
    dialog.close();
    toast(t('toast.settingsSaved'), canUndo);
  } catch (cause) {
    error.textContent = cause.message || t('settings.saveFailed');
  } finally {
    submit.disabled = false;
  }
});
function openHelp(scrollToShortcuts) {
  $('about-version').textContent = appInfo.version ? t('help.version', { version: appInfo.version }) : '';
  if (!$('help-dialog').open) $('help-dialog').showModal();
  if (scrollToShortcuts) $('shortcuts-title').scrollIntoView({block:'start'});
}
$('settings-help')?.addEventListener('click', () => openHelp(false));
const MEAL_KEYS = { '1': 'breakfast', '2': 'lunch', '3': 'dinner', '4': 'snack' };
document.querySelectorAll('[data-meal]').forEach(button => { const key = Object.keys(MEAL_KEYS).find(k => MEAL_KEYS[k] === button.dataset.meal); button.setAttribute('aria-keyshortcuts', `Control+${key}`); button.title = t('meal.hint', { meal: mealName(button.dataset.meal), key }); });
document.addEventListener('keydown',event=>{
  const dialogOpen=!!document.querySelector('dialog[open]');
  if(event.key==='F1'){event.preventDefault();openHelp(false);return;}
  if(!(event.ctrlKey||event.metaKey)||event.altKey||dialogOpen||!ready)return;
  const key=event.key.toLowerCase();
  if(key==='z'){if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();action({type:'undo'},t('toast.undone'),false);}return;}
  if(MEAL_KEYS[key]){event.preventDefault();recordMealAndEdit(MEAL_KEYS[key]);return;}
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
  window.desktop.onMode(mini=>{document.body.classList.toggle('mini',mini);});
  window.desktop.onCommand(name=>{if(name==='help'||name==='about')openHelp(false);else if(name==='shortcuts')openHelp(true);});
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
