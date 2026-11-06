(function () {
  'use strict';
  if (!document.body.classList.contains('is-pwa')) return;

  const body = document.body;
  const main = document.querySelector('#main-content');
  const page = document.querySelector('#page-timer');
  const grid = page && page.querySelector('.dashboard-grid');
  const panel = page && page.querySelector('.timer-panel');
  const dial = page && page.querySelector('.dial-wrap');
  if (!main || !grid || !panel || !dial) return;
  const meal = page.querySelector('.meal-panel');
  const header = panel.querySelector('.panel-header');
  const stage = panel.querySelector('.autophagy-stages');
  const meta = panel.querySelector('.timer-meta');
  const digits = panel.querySelector('.timer-digits');
  const nav = document.querySelector('.sidebar nav');
  const viewport = window.visualViewport;
  const rail = matchMedia('(min-width: 920px) and (min-height: 540px)');
  let pending = 0;
  let lastKey = '';
  let previousHeight = 0;
  let previousWidth = 0;
  let previousMode = 'comfortable';
  let previousLandscape = false;
  let observedText = '';
  let baseScale = 0;
  const modes = ['comfortable', 'dense', 'compact'];
  const number = value => parseFloat(value) || 0;
  const height = el => el ? el.getBoundingClientRect().height : 0;
  function variable(name, value) {
    if (body.style.getPropertyValue(name) !== value) body.style.setProperty(name, value);
  }
  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(() => requestAnimationFrame(fit), 90);
  }
  function reading() {
    return number(getComputedStyle(header.querySelector('h2')).fontSize) > 18 ||
      number(getComputedStyle(nav.querySelector('.nav-item')).fontSize) > 17;
  }
  function contentKey() {
    const current = stage.querySelector('.autophagy-stage:not([hidden])');
    return [page.hidden, current && current.textContent, meta.textContent, digits.className, digits.textContent.split(':')[0].length].join('|');
  }
  function fitDigits() {
    // CSS keeps type proportional to the circle; use the actual glyph width for
    // long hours and translated numerals, without scaling any other text.
    digits.style.removeProperty('--fit-digit-size');
    dial.removeAttribute('data-clock-wrap');
    const size = number(getComputedStyle(digits).fontSize);
    const width = digits.getBoundingClientRect().width;
    const available = dial.getBoundingClientRect().width * 0.84;
    if (width > available && size > 0) {
      const fitted = size * available / width;
      digits.style.setProperty('--fit-digit-size', `${Math.max(24, fitted).toFixed(2)}px`);
      dial.toggleAttribute('data-clock-wrap', fitted < 24);
    }
  }
  function fit() {
    if (viewport && !(viewport.scale > 0)) return;
    const currentScale = viewport && viewport.scale > 0 ? viewport.scale : 1;
    // A standalone iPhone can start at a persisted scale such as 1.5. Fit that
    // initial viewport, then preserve additional pinch zoom relative to it.
    if (!baseScale || currentScale < baseScale) baseScale = currentScale;
    if (viewport && currentScale > baseScale * 1.05) {
      body.toggleAttribute('data-fit-reading', reading());
      body.dataset.fitStatus = 'zoom';
      lastKey = '';
      return; // Never counteract a user's pinch zoom.
    }
    const active = document.activeElement;
    if (active && active.matches('input, textarea, select, [contenteditable="true"]') && active.closest('dialog[open]')) {
      const keyboardHeight = viewport && viewport.height > 0 ? viewport.height : innerHeight;
      const safeTop = number(getComputedStyle(body).paddingTop);
      variable('--fit-dialog-height', `${Math.max(100, Math.floor(keyboardHeight - safeTop - 24))}px`);
      variable('--fit-dialog-top', `${number(viewport && viewport.offsetTop) + safeTop + 12}px`);
      body.dataset.fitStatus = 'keyboard';
      lastKey = '';
      return;
    }
    if (body.dataset.fitStatus === 'keyboard') { body.dataset.fitStatus = 'fit'; lastKey = ''; }
    const visibleHeight = Math.round(viewport && viewport.height > 0 ? viewport.height : innerHeight);
    const visibleWidth = Math.round(viewport && viewport.width > 0 ? viewport.width : innerWidth);
    if (visibleHeight < 1 || visibleWidth < 1) return;
    variable('--pwa-viewport-height', `${visibleHeight}px`);
    const landscape = visibleWidth >= 600 && visibleWidth > visibleHeight;
    if (!viewport && previousHeight && previousLandscape === landscape && (visibleHeight < previousHeight - 1 || visibleWidth < previousWidth - 1)) {
      // Legacy browsers cannot reliably distinguish pinch zoom from a shrinking
      // viewport. Keep the readable clock size and allow scrolling in that case.
      if (!body.hasAttribute('data-fit-reading')) digits.style.setProperty('--fit-digit-size', getComputedStyle(digits).fontSize);
      body.setAttribute('data-fit-reading', '');
      body.dataset.fitStatus = 'reading';
      lastKey = '';
      return;
    }
    body.toggleAttribute('data-fit-landscape', landscape);
    if (!body.dataset.fitMode) body.dataset.fitMode = 'comfortable';
    // Measure the actual nav content, including enlarged type. Safe padding is
    // included by CSS exactly once; shell reserves the same measured height.
    if (rail.matches) {
      variable('--pwa-nav-height', '0px');
    } else {
      variable('--pwa-nav-height', '54px');
      const safeBottom = number(getComputedStyle(nav).paddingBottom) - 3;
      variable('--pwa-nav-height', `${Math.max(54, Math.ceil(height(nav) - safeBottom))}px`);
    }
    if (page.hidden) {
      lastKey = '';
      return;
    }
    const enlarged = reading();
    body.toggleAttribute('data-fit-reading', enlarged);
    const textKey = contentKey();
    observedText = textKey;
    const key = [visibleWidth, visibleHeight, main.clientHeight, enlarged, height(meal), height(header), height(stage), height(meta), textKey].join('|');
    if (key === lastKey) return;
    if (enlarged) {
      body.dataset.fitMode = 'comfortable';
      variable('--fit-dial-size', `${Math.min(330, Math.max(180, panel.clientWidth - 34))}px`);
      body.dataset.fitStatus = 'reading';
      digits.style.removeProperty('--fit-digit-size');
      lastKey = key;
      return;
    }
    let selected = 'compact';
    let diameter = 128;
    const stable = previousHeight && Math.abs(previousHeight - visibleHeight) < 16 && Math.abs(previousWidth - visibleWidth) < 16 && previousLandscape === landscape;
    const start = stable ? modes.indexOf(previousMode) : 0;
    for (let i = Math.max(0, start); i < modes.length; i += 1) {
      body.dataset.fitMode = modes[i];
      const gridStyle = getComputedStyle(grid);
      const panelStyle = getComputedStyle(panel);
      const pad = number(panelStyle.paddingTop) + number(panelStyle.paddingBottom) + number(panelStyle.borderTopWidth) + number(panelStyle.borderBottomWidth);
      const gridPad = number(gridStyle.paddingTop) + number(gridStyle.paddingBottom);
      const available = grid.clientHeight - gridPad - (landscape ? 0 : height(meal) + number(gridStyle.rowGap));
      const stageGap = number(getComputedStyle(panel).getPropertyValue('--fit-stage-gap'));
      const metaGap = number(getComputedStyle(panel).getPropertyValue('--fit-meta-gap'));
      const fixed = height(header) + pad + 12 + (landscape ? 0 : height(stage) + height(meta) + stageGap + metaGap);
      const innerWidth = panel.clientWidth - number(panelStyle.paddingLeft) - number(panelStyle.paddingRight);
      const column = landscape ? number(panelStyle.gridTemplateColumns.split(' ')[0]) : innerWidth;
      const maxWidth = Math.floor(column * 0.94);
      diameter = Math.floor(Math.min(330, maxWidth, available - fixed));
      const preferred = landscape ? 160 : [280, 220, 128][i];
      selected = modes[i];
      if (diameter >= preferred) break;
    }
    variable('--fit-dial-size', `${Math.max(128, Math.floor(diameter * 0.96))}px`);
    fitDigits();
    // Reading minima take precedence on exceptionally constrained viewports.
    const digitRect = digits.getBoundingClientRect();
    const dialRect = dial.getBoundingClientRect();
    const overflow = main.scrollHeight > main.clientHeight + 1 || main.scrollWidth > main.clientWidth + 1 || meta.getBoundingClientRect().bottom > main.getBoundingClientRect().bottom + 1 || digitRect.width > dialRect.width + 1 || digitRect.height > dialRect.height + 1;
    body.dataset.fitStatus = overflow ? 'overflow' : 'fit';
    previousHeight = visibleHeight;
    previousWidth = visibleWidth;
    previousMode = selected;
    previousLandscape = landscape;
    lastKey = key;
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('focusin', schedule);
  window.addEventListener('focusout', () => { lastKey = ''; schedule(); });
  window.addEventListener('pageshow', () => { lastKey = ''; schedule(); });
  if (viewport) viewport.addEventListener('resize', schedule);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(schedule);
    [main, meal, header, stage, meta, nav].forEach(el => observer.observe(el));
  }
  const changes = new MutationObserver(() => {
    const next = contentKey();
    if (next !== observedText) { observedText = next; schedule(); }
  });
  changes.observe(page, { attributes: true, attributeFilter: ['hidden'] });
  changes.observe(digits, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
  // Refit translated/long metadata without observing the once-per-second clock.
  changes.observe(stage, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  changes.observe(meta, { childList: true, characterData: true, subtree: true });
  if (document.fonts) document.fonts.ready.then(() => { lastKey = ''; schedule(); });

  // Version and layout diagnostics are local, read-only, and contain no meals
  // or profile fields. Capture the home geometry before the modal opens.
  const fitBuild = 'PWA-62';
  body.dataset.pwaBuild = fitBuild;
  const settingsHeading = document.querySelector('#settings-form .dialog-heading');
  if (settingsHeading) {
    const diagnostics = document.createElement('section');
    diagnostics.className = 'pwa-diagnostics';
    diagnostics.innerHTML = '<div class="pwa-build"><span></span><strong></strong></div><p class="pwa-build-state" aria-live="polite"></p><details><summary></summary><pre tabindex="0"></pre><button type="button" class="text-button"></button><p class="pwa-copy-state" aria-live="polite"></p></details>';
    const slot = document.querySelector('#settings-diagnostics');
    if (slot) slot.append(diagnostics);
    else settingsHeading.after(diagnostics);
    const output = diagnostics.querySelector('pre');
    const copy = diagnostics.querySelector('button');
    let english = false;
    function workerVersion() {
      return new Promise(resolve => {
        const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!worker || !window.MessageChannel) { resolve('unavailable'); return; }
        const channel = new MessageChannel();
        const finish = value => { clearTimeout(timeout); channel.port1.close(); resolve(value); };
        const timeout = setTimeout(() => finish('unavailable'), 1200);
        channel.port1.onmessage = event => finish(event.data && typeof event.data.cache === 'string' ? event.data.cache : 'unavailable');
        try { worker.postMessage({ type: 'DANSIK_VERSION' }, [channel.port2]); }
        catch (_) { finish('unavailable'); }
      });
    }
    document.querySelector('#settings-button').addEventListener('click', () => {
      english = document.documentElement.lang === 'en';
      diagnostics.querySelector('.pwa-build span').textContent = english ? 'Running web app' : '웹앱 실행 버전';
      diagnostics.querySelector('.pwa-build strong').textContent = fitBuild;
      diagnostics.querySelector('summary').textContent = english ? 'Screen diagnostics' : '화면 진단 보기';
      diagnostics.querySelector('.pwa-copy-state').textContent = '';
      copy.textContent = english ? 'Copy diagnostics' : '진단 복사';
      const stateLine = diagnostics.querySelector('.pwa-build-state');
      stateLine.textContent = english ? 'Checking offline version…' : '오프라인 버전 확인 중…';
      const style = getComputedStyle(body);
      const lines = [
        `fit-module: ${fitBuild}`,
        `display: ${(navigator.standalone || matchMedia('(display-mode: standalone)').matches) ? 'standalone' : 'browser'}`,
        `layout: ${innerWidth} x ${innerHeight}`,
        `visible: ${viewport ? `${Math.round(viewport.width)} x ${Math.round(viewport.height)}, scale ${viewport.scale}` : 'API unavailable'}`,
        `initial-scale: ${baseScale || 'pending'}`,
        `main: ${main.clientWidth} x ${main.clientHeight}; content ${main.scrollWidth} x ${main.scrollHeight}`,
        `fit: ${body.dataset.fitMode || 'not initialized'} / ${body.dataset.fitStatus || 'not initialized'}`,
        `swipe: ${body.dataset.swipeStatus || 'not yet used'}`,
        `chrome: top ${Math.round(height(document.querySelector('.sidebar')))}; nav ${Math.round(height(nav))}; safe ${style.paddingTop} / ${number(getComputedStyle(nav).paddingBottom) - 3}px`,
        `document: ${document.documentElement.clientWidth} x ${document.documentElement.clientHeight}; scroll ${document.scrollingElement.scrollHeight}`,
        `type: title ${getComputedStyle(header.querySelector('h2')).fontSize}; clock ${getComputedStyle(digits).fontSize}`,
        `dial: ${Math.round(dial.getBoundingClientRect().width)} x ${Math.round(height(dial))}`
      ];
      output.textContent = lines.join('\n');
      Promise.all([window.desktop.getState(), workerVersion()]).then(([snapshot, cache]) => {
        const appBuild = snapshot.app && (snapshot.app.build || snapshot.app.version) || 'unavailable';
        output.textContent = [`app: ${appBuild}`, ...lines, `worker: ${cache}`].join('\n');
        const consistent = appBuild === fitBuild && cache === 'dansik-pwa-v1.0.62';
        if (body.dataset.pwaUpdateReady === 'true' && !consistent) {
          stateLine.textContent = english ? 'Update ready. Save any changes, then close and reopen the app.' : '업데이트가 준비됐어요. 입력을 저장한 뒤 앱을 닫았다 다시 열어주세요.';
        } else {
          stateLine.textContent = consistent ? (english ? 'App, layout and offline versions match.' : '앱·화면·오프라인 버전이 일치해요.') : (english ? 'Update check incomplete. Close and reopen the app.' : '버전 확인이 끝나지 않았어요. 앱을 닫았다가 다시 열어주세요.');
        }
      }).catch(() => { stateLine.textContent = english ? 'Version unavailable.' : '버전을 확인하지 못했어요.'; });
    }, { capture: true });
    copy.addEventListener('click', () => {
      const result = diagnostics.querySelector('.pwa-copy-state');
      const fallback = () => { result.textContent = english ? 'Press and hold the diagnostic text to copy it.' : '진단 문장을 길게 눌러 복사해 주세요.'; };
      if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
      navigator.clipboard.writeText(output.textContent).then(() => { result.textContent = english ? 'Copied.' : '복사했어요.'; }).catch(fallback);
    });
  }
  schedule();
})();
