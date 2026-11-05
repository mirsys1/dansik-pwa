'use strict';
const C = window.FastingCore;
const I18N = window.FastingI18n;
const $ = id => document.getElementById(id);
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
function compactDateTime(at) {

  const p = C.tzParts(at, tz()), todayP = C.tzParts(Date.now(), tz());
  const yd = new Date(Date.UTC(todayP.year, todayP.month - 1, todayP.day - 1));
  const yestP = { year: yd.getUTCFullYear(), month: yd.getUTCMonth() + 1, day: yd.getUTCDate() };
  const sameDay = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
  const label = sameDay(p, todayP) ? t('date.today') : sameDay(p, yestP) ? t('date.yesterday') : `${p.year === todayP.year ? '' : p.year+'.'}${p.month}.${p.day}`;
  return `${label} ${time(at)}`;
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
let toastTimeout;
let historyLimit = 60;
let ready = false;
let lastActionError = '';
let windowInfo = null;
let theme = 'light';
let prefs = { tray: false, autoStart: false, firstRunDone: true, canAutoStart: false, autoStartActive: false, language: 'auto', timeZone: 'auto', colorTheme: 'sage', sex: 'male', age: 35, heightCm: 170, weightKg: 68, activityLevel: 'light' };
function applyColorTheme(name) { document.body.dataset.colorTheme = C.validColorTheme(name) ? name : 'sage'; }
let appInfo = { version: '' };
let firstRunShown = false;
let pinBusy = false;
let effectOpener = null;

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
function toast(message, undo = false) { $('toast-message').textContent = message; $('undo-button').hidden = !undo; $('toast').hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('toast').hidden = true; }, undo ? 15000 : 5000); }
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
  $('theme-button').setAttribute('aria-label', theme === 'light' ? t('theme.toDark') : t('theme.toLight'));
  $('save-status').textContent = t('footer.saved', { time: time(Date.now()) });
  if (snapshot.warning) showWarning(snapshot.warning);
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
const DIAL_MS = 24 * 3600000;
const STAGE_COLORS = [[0, [127, 157, 107]], [12, [95, 160, 138]], [16, [63, 155, 176]], [24, [79, 127, 208]], [36, [122, 98, 200]], [48, [176, 72, 159]]];
function stageColor(elapsedMs) {
  const h = elapsedMs == null ? 0 : elapsedMs / 3600000;
  let i = STAGE_COLORS.length - 1;
  while (i > 0 && h < STAGE_COLORS[i][0]) i--;
  const a = STAGE_COLORS[i], b = STAGE_COLORS[Math.min(i + 1, STAGE_COLORS.length - 1)];
  const f = b[0] === a[0] ? 0 : Math.min(1, (h - a[0]) / (b[0] - a[0]));
  return `rgb(${a[1].map((v, k) => Math.round(v + (b[1][k] - v) * f)).join(',')})`;
}
function tick() {
  if (!ready) return;
  const now = Date.now();
  const latest = state.events[0];
  const timer = C.getTimer(state, now, prefs);
  const active = Boolean(latest) && !timer.reset;
  const autophagy = C.getAutophagyStage(active && !timer.clockSkew ? timer.elapsedMs : null);
  $('autophagy-dial').classList.toggle('is-active', autophagy.active);
  $('autophagy-dial-dots').textContent = autophagy.dots;
  $('autophagy-dial-label').textContent = t(autophagy.current.titleKey);
  document.querySelectorAll('#autophagy-stages .autophagy-stage').forEach(el => { const s = Number(el.dataset.stage), cur = autophagy.active && s === autophagy.stage; el.hidden = s !== autophagy.stage; el.classList.toggle('is-current', cur); el.classList.toggle('is-done', autophagy.active && s < autophagy.stage); if (cur) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
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
  const sub = !active ? '' : timer.paused ? t('timer.paused') : timer.clockSkew ? t('mini.checkTime') : !state.settings.goalEnabled ? t('mini.ownRhythm') : timer.reached ? t('mini.reached') : t('mini.untilGoal', { d: shortDuration(timer.remainingMs) });
  $('mini-remaining').textContent = sub;
  $('mini-remaining').hidden = !sub;
  $('clock-warning').hidden = !timer.clockSkew;
  const dialProgress = active && !timer.clockSkew ? (timer.elapsedMs % DIAL_MS) / DIAL_MS : 0;
  document.querySelector('.dial-wrap').style.setProperty('--stage-color', stageColor(active && !timer.clockSkew ? timer.elapsedMs : null));
  $('dial-progress').setAttribute('stroke-dasharray', `${dialProgress * 100} 100`);
  const angle = dialProgress * Math.PI * 2 - Math.PI / 2;
  $('dial-tip').setAttribute('cx', 180 + 170 * Math.cos(angle));
  $('dial-tip').setAttribute('cy', 180 + 170 * Math.sin(angle));
  $('mini-progress-bar').style.width = `${timer.progress * 100}%`;
  $('last-meal').textContent = latest ? `${mealName(latest.type)} · ${compactDateTime(latest.at)}` : t('timer.noRecord');
  const kcal = C.calculateCalories(active && !timer.clockSkew ? timer.elapsedMs : null, prefs);
  $('goal-time').textContent = kcalText(kcal.totalKcal, true);
  const trend = fatTrendKey(active && !timer.clockSkew ? timer.elapsedMs : null);
  $('energy-trend').textContent = t(trend);
  $('energy-summary').dataset.fatTrend = trend === 'effects.trendFat' ? 'rising' : 'mixed';
  $('energy-summary').disabled = false;
  $('energy-summary').setAttribute('aria-label', t('effects.homeAria', { energy: kcalText(kcal.totalKcal), trend: t(trend) }));
  const remaining = !active || timer.clockSkew ? '' : timer.paused ? t('timer.paused') : state.settings.goalEnabled ? (timer.reached ? t('mini.reached') : t('mini.remaining', { d: shortDuration(timer.remainingMs) })) : '';
  $('goal-remaining').textContent = remaining;
  $('goal-remaining').hidden = !remaining;
  const nowP = C.tzParts(now, tz()), nowW = new Date(now).toLocaleDateString(L.locale, { weekday: 'long', ...tzOpt() });
  $('today-label').textContent = nowW.toUpperCase() + ' · MY LITTLE PAUSE';
  $('date-stamp').innerHTML = `<strong>${nowP.month}.${String(nowP.day).padStart(2,'0')}</strong>${nowW}`;
}
function row(event) {
  const meal = MEALS[event.type], name = mealName(event.type);
  const symbol = `<span class="row-icon ${event.type}">${icon(meal.icon)}</span>`;
  return `<div class="history-row">${symbol}<div><strong>${name}</strong><p>${esc(event.note || t('history.noNote'))}</p></div><time datetime="${new Date(event.at).toISOString()}">${time(event.at)}</time><button class="icon-button" data-edit="${esc(event.id)}" aria-label="${esc(t('history.editAria', { when: dateTime(event.at), meal: name }))}">${icon('edit')}</button></div>`;
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
function openFastingDetail(selection = {}, opener = null) {
  if (!$('fasting-dialog').open) effectOpener = opener || document.activeElement;
  const now = Date.now();
  const stats = C.weeklyStats(state, now, tz());
  let interval, date, records = [];
  if (selection.live) {
    const timer = C.getTimer(state, now, prefs);
    if (state.events.length && !timer.reset && !timer.clockSkew) interval = { from: state.events[0].at, to: timer.paused ? prefs.timerPausedAt : now, durationMs: timer.elapsedMs };
    date = C.localDay(now, tz());
  } else if (selection.date) {
    date = selection.date;
    const entry = stats.daily.find(d => d.date === date);
    records = entry ? entry.intervals : [];
    interval = entry && entry.longestInterval;
  } else {
    interval = stats.mealIntervals.find(x => x.from === selection.from && x.to === selection.to);
    date = interval ? C.localDay(interval.to, tz()) : '';
    records = stats.daily.find(d => d.date === date)?.intervals || [];
  }
  $('fasting-title').textContent = selection.live ? t('effects.liveTitle') : t('effects.dayTitle', { date: date ? new Date(date+'T12:00:00Z').toLocaleDateString(L.locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '' });
  if (!interval) {
    $('fasting-detail').innerHTML = `<div class="effect-empty">${icon('leaf')}<strong>${t('effects.emptyTitle')}</strong><p>${t(selection.live ? 'effects.emptyLive' : 'effects.emptyDay')}</p></div>`;
  } else {
    const trend = fatTrendKey(interval.durationMs);
    const rising = trend === 'effects.trendFat';
    const kcal = C.calculateCalories(interval.durationMs, prefs);
    $('fasting-detail').innerHTML = `<p class="effect-caption">${t(selection.live ? 'effects.atOpen' : 'effects.recordedInterval')}</p><strong class="effect-duration">${shortDuration(interval.durationMs)}</strong><p class="effect-period">${intervalPoint(interval.from)} → ${intervalPoint(interval.to)}</p><section class="effect-state" data-fat-trend="${rising?'rising':'mixed'}"><div>${icon('leaf')}<strong>${t(rising?'effects.fatTitle':'effects.mixedTitle')}</strong></div><div class="effect-flow" aria-hidden="true"><span class="${rising?'':'is-current'}">${t('effects.mixedLabel')}</span><b>→</b><span class="${rising?'is-current':''}">${t('effects.fatLabel')}</span></div><p>${t(rising?'effects.fatDescription':'effects.mixedDescription')}</p></section><div class="effect-energy"><span>${t('effects.energyTitle')}</span><strong>${kcalText(kcal.totalKcal)}</strong></div>${records.length>1?`<section class="effect-records"><h3>${t('effects.otherRecords', { n: records.length })}</h3><div class="effect-record-list">${records.map(x=>`<button type="button" data-effect-from="${x.from}" data-effect-to="${x.to}" aria-pressed="${x.from===interval.from&&x.to===interval.to}"><span>${time(x.from)} → ${time(x.to)}</span><strong>${shortDuration(x.durationMs)}</strong></button>`).join('')}</div></section>`:''}`;
  }
  if (!$('fasting-dialog').open) $('fasting-dialog').showModal();
  else if (interval) $('fasting-detail').querySelector('.effect-record-list [aria-pressed="true"]')?.focus({ preventScroll: true });
}
function render() {




  renderHistory(); renderStats(); tick();
}
function goPage(page) {
  $('sr-status').textContent = { timer: t('sr.timer'), history: t('sr.history'), insights: t('sr.insights') }[page] || '';
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${page}`; });
  document.querySelectorAll('[data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page===page); if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
  const main = document.querySelector('main');
  main.scrollTop = 0; // PWA: <main> is its own scroll container, scrollIntoView only moves ancestors
  main.scrollIntoView({behavior:'instant'});
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
function openMeal(id = null) {
  editingId = id;
  const event = state.events.find(item => item.id === id);
  $('meal-dialog-title').textContent = event ? t('meal.dialogEdit') : t('meal.dialogNew');
  $('meal-type').value = event?.type || 'breakfast';
  $('meal-at').value = localInput(event?.at || Date.now());
  $('meal-at').max = localInput(Math.max(Date.now(), event?.at || 0));
  $('meal-note').value = event?.note || '';
  $('meal-error').textContent = '';
  $('delete-meal').hidden = !event;
  $('meal-dialog').showModal();
}
function openSettings() { $('sex-input').value = prefs.sex || 'male'; $('age-input').value = prefs.age || 35; $('height-input').value = prefs.heightCm || 170; $('weight-input').value = prefs.weightKg || 68; $('activity-input').value = prefs.activityLevel || 'light'; $('tray-input').checked = prefs.tray; $('autostart-input').checked = prefs.autoStartActive || prefs.autoStart; $('autostart-label').hidden = !prefs.canAutoStart; $('language-input').value = prefs.language || 'auto'; $('timezone-input').value = prefs.timeZone || 'auto'; $('color-theme-input').value = prefs.colorTheme || 'sage'; $('theme-auto-input').checked = state.settings.themeAuto; $('goal-enabled').checked = state.settings.goalEnabled; $('goal-input').value = state.settings.goalHours; $('notifications-input').checked = state.settings.notifications; $('settings-error').textContent = ''; $('settings-dialog').showModal(); }
async function exportData() { const result = await action({type:'export'}, null, false); if(result?.exported)toast(t('toast.exported')); }

icons();
$('dial-ticks').innerHTML = Array.from({length:60},(_,i) => { const a=i*Math.PI/30;const outer=187;const inner=i%5===0?179:183;return `<line class="dial-tick" x1="${180+inner*Math.sin(a)}" y1="${180-inner*Math.cos(a)}" x2="${180+outer*Math.sin(a)}" y2="${180-outer*Math.cos(a)}"/>`; }).join('');
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if(!button)return;
  if(button.dataset.meal) { action({type:'record',meal:button.dataset.meal},t('toast.recorded', { meal: mealName(button.dataset.meal) })); }
  else if(button.dataset.goal) { action({type:'settings',patch:{goalHours:Number(button.dataset.goal),goalEnabled:true}},t('toast.goalSet', { h: button.dataset.goal })); }
  else if(button.hasAttribute('data-offset')) { const now=Date.now(); $('meal-at').max=localInput(now); $('meal-at').value=localInput(now-Number(button.dataset.offset)*60000); }
  else if(button.dataset.page)goPage(button.dataset.page);
  else if(button.dataset.goto)goPage(button.dataset.goto);
  else if(button.dataset.edit)openMeal(button.dataset.edit);
  else if(button.id==='energy-summary')openFastingDetail({live:true},button);
  else if(button.dataset.effectDate)openFastingDetail({date:button.dataset.effectDate},button);
  else if(button.dataset.effectFrom)openFastingDetail({from:Number(button.dataset.effectFrom),to:Number(button.dataset.effectTo)},button);
  else if(button.hasAttribute('data-add'))openMeal();
  else if(button.dataset.close)$(button.dataset.close).close();
});
document.querySelector('.brand').addEventListener('click', event => {event.preventDefault();goPage('timer');});
$('past-meal').addEventListener('click',()=>openMeal());
$('timer-pause').addEventListener('click',async()=>{const res=await action({type:'timer-pause'},null);if(res)toast(res.paused?t('toast.paused'):t('toast.resumed'),res.canUndo);});
$('timer-reset').addEventListener('click',()=>action({type:'timer-reset'},t('toast.reset')));
$('add-history').addEventListener('click',()=>openMeal());


$('settings-button').addEventListener('click',openSettings);
$('color-theme-input').addEventListener('change',()=>applyColorTheme($('color-theme-input').value));
$('settings-dialog').addEventListener('close',()=>applyColorTheme(prefs.colorTheme));
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
$('export-history').addEventListener('click',exportData);
$('export-settings').addEventListener('click',exportData);
async function importData() {
  const result = await action({type:'import-preview'}, null, false);
  if (!result || !result.picked) return;
  const p = result.preview;
  const range = p.count ? `${dateTime(p.oldestAt)} ~ ${dateTime(p.newestAt)}` : t('import.noRecords');
  $('import-summary').textContent = t('import.summary', { name: p.name, kind: p.kind === 'csv' ? t('import.kindCsv') : t('import.kindJson'), count: p.count, range });
  $('import-merge-text').firstChild.textContent = t('import.mergeAdd', { added: p.added });
  $('import-merge-text').querySelector('small').textContent = p.skipped ? t('import.mergeSkip', { current: p.current, skipped: p.skipped }) : t('import.mergeKeep', { current: p.current });
  $('import-replace-text').firstChild.textContent = t('import.replaceCount', { current: p.current, count: p.count });
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
  const original = editingId ? state.events.find(item => item.id === editingId) : null;
  // Leaving the time field alone keeps the stored time (including its seconds) untouched.
  const timeUntouched = !!original && $('meal-at').value === localInput(original.at);
  const at = C.parseLocalInput($('meal-at').value, tz());
  if(!timeUntouched&&(!Number.isSafeInteger(at)||at>Date.now()||at<C.MIN_DATE)){$('meal-error').textContent=t('meal.timeRange');return;}
  const patch=timeUntouched?{type:$('meal-type').value,note:$('meal-note').value.trim()}:{type:$('meal-type').value,at,note:$('meal-note').value.trim()};
  const result=await action(editingId?{type:'update',id:editingId,patch}:{type:'add',patch},t('toast.mealSaved'));
  if(result)$('meal-dialog').close();else $('meal-error').textContent=lastActionError||t('meal.saveFailed');
});
$('delete-meal').addEventListener('click',()=>{$('delete-error').textContent='';$('delete-dialog').showModal();});
$('confirm-delete').addEventListener('click',async()=>{const result=await action({type:'delete',id:editingId},t('toast.mealDeleted'));if(result){$('delete-dialog').close();$('meal-dialog').close();}else $('delete-error').textContent=lastActionError||t('delete.failed');});
$('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();const goalHours=Number($('goal-input').value);
  if(!Number.isInteger(goalHours)||goalHours<8||goalHours>24){$('settings-error').textContent=t('settings.goalInvalid');return;}
  const age = Number($('age-input').value), heightCm = Math.round(Number($('height-input').value) * 10) / 10, weightKg = Math.round(Number($('weight-input').value) * 10) / 10;
  if (!Number.isInteger(age) || age < 10 || age > 120 || !Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250 || !Number.isFinite(weightKg) || weightKg < 25 || weightKg > 300) { $('settings-error').textContent = t('settings.bodyInvalid'); return; }
  const wanted = { tray: $('tray-input').checked, autoStart: $('autostart-input').checked, language: $('language-input').value, timeZone: $('timezone-input').value, colorTheme: $('color-theme-input').value, sex: $('sex-input').value, age, heightCm, weightKg, activityLevel: $('activity-input').value };
  const changed = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => (key === 'autoStart' ? (!prefs.canAutoStart ? false : value !== Boolean(prefs.autoStartActive || prefs.autoStart)) : value !== prefs[key])));
  if (Object.keys(changed).length) { const saved = await window.desktop.action({type:'prefs',patch:changed}); if (!saved.ok) { $('settings-error').textContent = saved.error; return; } prefs = saved.prefs; if (saved.state) applySnapshot(saved); }
  const themeAuto = $('theme-auto-input').checked;
  const settingsPatch = { goalEnabled: $('goal-enabled').checked, goalHours, notifications: $('notifications-input').checked, themeAuto };
  if (!themeAuto && state.settings.themeAuto) settingsPatch.theme = theme;
  const result=await action({type:'settings',patch:settingsPatch},t('toast.settingsSaved'));if(result)$('settings-dialog').close();else $('settings-error').textContent=lastActionError||t('settings.saveFailed');
});
function openHelp(scrollToShortcuts) {
  $('about-version').textContent = appInfo.version ? t('help.version', { version: appInfo.version }) : '';
  if (!$('help-dialog').open) $('help-dialog').showModal();
  if (scrollToShortcuts) $('shortcuts-title').scrollIntoView({block:'start'});
}
const MEAL_KEYS = { '1': 'breakfast', '2': 'lunch', '3': 'dinner', '4': 'snack' };
document.querySelectorAll('[data-meal]').forEach(button => { const key = Object.keys(MEAL_KEYS).find(k => MEAL_KEYS[k] === button.dataset.meal); button.setAttribute('aria-keyshortcuts', `Control+${key}`); button.title = t('meal.hint', { meal: mealName(button.dataset.meal), key }); });
document.addEventListener('keydown',event=>{
  const dialogOpen=!!document.querySelector('dialog[open]');
  if(event.key==='F1'){event.preventDefault();openHelp(false);return;}
  if(!(event.ctrlKey||event.metaKey)||event.altKey||dialogOpen||!ready)return;
  const key=event.key.toLowerCase();
  if(key==='z'){if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();action({type:'undo'},t('toast.undone'),false);}return;}
  if(MEAL_KEYS[key]){event.preventDefault();action({type:'record',meal:MEAL_KEYS[key]},t('toast.recorded', { meal: mealName(MEAL_KEYS[key]) }));return;}
  if(key==='n'){event.preventDefault();openMeal();}
  else if(key==='m'){event.preventDefault();action({type:'mini'},null,false);}
  else if(key===','){event.preventDefault();openSettings();}
});
window.addEventListener('focus',()=>{tick();renderStats();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();renderStats();}});
document.querySelectorAll('[data-meal]').forEach(button=>{button.disabled=true;});
if(window.desktop){
  window.desktop.onState(snapshot=>{if(snapshot.state)applySnapshot(snapshot);if(snapshot.warning)showWarning(snapshot.warning);});
  window.desktop.onMode(mini=>{document.body.classList.toggle('mini',mini);});
  window.desktop.onCommand(name=>{if(name==='help'||name==='about')openHelp(false);else if(name==='shortcuts')openHelp(true);});
  window.desktop.getState().then(result=>{if(!result.ok)throw new Error(result.error);applySnapshot(result);document.querySelectorAll('[data-meal]').forEach(button=>{button.disabled=false;});if(!prefs.firstRunDone&&!firstRunShown&&!state.events.length){firstRunShown=true;toast(t('toast.firstRun'));window.desktop.action({type:'prefs',patch:{firstRunDone:true}}).catch(()=>{});}}).catch(error=>{showWarning(t('error.loadFailed', { message: error.message }));$('save-status').textContent=t('footer.loadFailed');});
}else{showWarning(t('error.desktopOnly'));}
setInterval(tick,1000);
setInterval(()=>{if(ready)renderStats();},60000);
