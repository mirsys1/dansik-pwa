/* Food entry, photo analysis, and pairing. The caller saves meal data returned by read(). */
(function mealFoodsModule(root) {
  'use strict';

  const MAX_FOODS = 24;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_KCAL = 20000;
  const MAX_GRAMS = 10000;
  const MAX_DENSITY = 20000;
  const MAX_AI_BYTES = 1024 * 1024;
  const MAX_PHOTO_BATCH = 8;
  const MAX_PHOTO_BATCH_BYTES = 32 * 1024 * 1024;
  const CODE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
  const PAIR_LINK = 'https://mirsys1.github.io/dansik-pwa/#photo-connect=';
  const TEXT_AUTO_KEY = 'dansik:meal-text-auto:v1';
  const AI_PROVIDER_KEY = 'dansik:food-ai-provider:v1';
  let cameraStream = null;
  let initialized = false;
  let transientGeneration = 0;
  let currentPhoto = null;
  let analysisRequest = null;
  let photoBatch = null;
  let photoSelectionGeneration = 0;
  let photoSelectionPending = null;
  let photoReadGeneration = null;
  let noteEdited = false;
  let endpoint = null;
  let photoCode = '';
  let aiProvider = 'cloudflare';
  let savedProvider = 'cloudflare';
  let savedPhotoCode = '';
  let savedTextAuto = true;
  let providerDraftBaseline = null;
  let providerDraftActive = false;
  let sharedQuotaDay = '';
  let qrSession = null;
  let qrReadGeneration = 0;
  // A text-analysis response is only allowed to change rows from the revision
  // it started with.  Direct edits always win over a delayed suggestion.
  let foodRevision = 0;
  let noteRevision = 0;
  let skipNextNoteAnalysisRevision = null;
  let manualNamesVisible = true;

  const byId = (id) => document.getElementById(id);
  const isEnglish = () => String(document.documentElement.lang || '').toLowerCase().startsWith('en');
  const copy = (korean, english) => (isEnglish() ? english : korean);
  const valueOrEmpty = (value) => value === undefined || value === null ? '' : String(value);

  function normalizeProvider(value) {
    return value === 'gemini' ? 'gemini' : 'cloudflare';
  }

  function providerNeedsSetup(provider = aiProvider) {
    // Both providers use the existing app access code. This is not a Gemini
    // API key, which remains registered only on the server.
    return provider === 'cloudflare' || provider === 'gemini';
  }

  function providerReady(provider = aiProvider) {
    return Boolean(endpoint && (!providerNeedsSetup(provider) || photoCode));
  }

  function canonicalFoodName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function sameVisibleFood(row, food) {
    const name = row.querySelector('[data-food-name]')?.value;
    const kcalRaw = row.querySelector('[data-food-kcal]')?.value.trim();
    const kcal = Number(kcalRaw);
    return canonicalFoodName(name) === canonicalFoodName(food.name) && kcalRaw !== '' && Number.isFinite(kcal) && kcal === food.kcal;
  }

  function reviseFoods() {
    foodRevision += 1;
    if (analysisRequest?.kind === 'text') cancelAnalysis();
  }

  function applyNoteDefaultName(row) {
    if (!row?.hasAttribute('data-food-note-default')) return false;
    const name = row.querySelector('[data-food-name]');
    const kcal = row.querySelector('[data-food-kcal]');
    const note = byId('meal-note')?.value.trim() || '';
    // A blank optional row stays blank for note-only meals.  It becomes a
    // named food only when the user supplies an actual total calorie value.
    if (!name || !kcal || !note) return false;
    if (!kcal.value.trim()) {
      if (!name.value) return false;
      name.value = '';
      return true;
    }
    const defaultName = note.length <= 100 ? note : copy('식사 전체', 'Whole meal');
    if (name.value === defaultName) return false;
    name.value = defaultName;
    return true;
  }

  function syncNoteDefaultNames() {
    const note = byId('meal-note')?.value.trim() || '';
    let changed = false;
    document.querySelectorAll('#food-items [data-food-note-default]').forEach((row) => {
      const name = row.querySelector('[data-food-name]');
      const kcal = row.querySelector('[data-food-kcal]');
      if (!name || !kcal?.value.trim()) return;
      // A filled food must remain editable if its description is removed.
      // Retain the previous name and reveal it instead of hiding an error.
      if (!note && name.value) {
        delete row.dataset.foodNoteDefault;
        manualNamesVisible = true;
        return;
      }
      const defaultName = note ? (note.length <= 100 ? note : copy('식사 전체', 'Whole meal')) : '';
      if (name.value !== defaultName) {
        name.value = defaultName;
        changed = true;
      }
    });
    if (changed) updateTotal();
    else refreshFoodRowPresentation();
  }

  function refreshFoodRowPresentation() {
    const rows = [...document.querySelectorAll('#food-items [data-food-row]')];
    const note = byId('meal-note')?.value.trim() || '';
    let compact = false;
    rows.forEach((row) => {
      const name = row.querySelector('[data-food-name]');
      const label = row.querySelector('[data-food-name-field]');
      if (!label || !name) return;
      // Equality changes presentation only. Saved/AI/recent food values never
      // gain automatic-note ownership just because their names match.
      const duplicate = note && canonicalFoodName(note) === canonicalFoodName(name.value);
      const hideName = rows.length === 1 && !manualNamesVisible && !row.hasAttribute('data-food-review') &&
        (row.hasAttribute('data-food-note-default') || duplicate);
      label.hidden = Boolean(hideName);
      row.toggleAttribute('data-food-name-compact', Boolean(hideName));
      compact = compact || Boolean(hideName);
    });
    const edit = byId('food-name-edit');
    if (edit) edit.hidden = !compact;
    const summaryItems = byId('food-summary-items');
    if (summaryItems) summaryItems.hidden = compact;
  }

  function showMenuNames() {
    manualNamesVisible = true;
    document.querySelectorAll('#food-items [data-food-note-default]').forEach(row => {
      delete row.dataset.foodNoteDefault;
    });
    refreshFoodRowPresentation();
  }

  function setText(node, value, state = 'ready') {
    if (node) node.textContent = value;
    if (node?.id === 'food-text-status' || node?.id === 'food-photo-status') {
      node.dataset.analysisState = state;
      refreshAnalysisFeedback();
    }
  }

  function refreshAnalysisFeedback() {
    const feedback = byId('meal-ai-feedback');
    if (!feedback) return;
    const messages = ['food-text-status', 'food-photo-status'].map(byId).filter(node => node?.textContent.trim());
    feedback.hidden = messages.length === 0;
    feedback.dataset.state = analysisPending() || messages.some(node => node.dataset.analysisState === 'loading') ? 'loading' : messages.some(node => node.dataset.analysisState === 'error') ? 'error' : 'ready';
  }

  function analysisStatus(kind, message, state = 'ready') {
    const node = byId(kind === 'text' ? 'food-text-status' : 'food-photo-status');
    setText(node, message, state);
    if (kind === 'text' && state === 'error') {
      const retry = byId('food-text-calculate');
      if (retry && photoCode) {
        retry.hidden = false;
        const options = byId('food-text-options');
        if (options) options.hidden = false;
      }
    }
  }

  function setStatus(message, state = 'ready') {
    analysisStatus('photo', message, state);
  }

  function setConnectionStatus(message, state = 'ready') {
    const node = byId('food-ai-connection-status');
    setText(node, message);
    if (node) node.dataset.state = state;
  }

  function finiteNumber(raw) {
    if (raw === '') return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : NaN;
  }

  function roundKcal(value) {
    return Math.round(value * 10) / 10;
  }

  function nextTransientGeneration() {
    photoReadGeneration = null;
    cancelAnalysis();
    stopQrScan();
    transientGeneration += 1;
    return transientGeneration;
  }

  function isCurrentGeneration(generation) {
    return generation === transientGeneration;
  }

  function isMobileDevice() {
    const agent = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function input(type, className, value, placeholder) {
    const control = document.createElement('input');
    control.type = type;
    control.className = className;
    control.value = valueOrEmpty(value);
    control.placeholder = placeholder;
    control.autocomplete = 'off';
    return control;
  }

  function field(labelText, control) {
    const label = document.createElement('label');
    label.textContent = labelText;
    label.append(control);
    return label;
  }

  function rowCount() {
    const container = byId('food-items');
    return container ? container.querySelectorAll('[data-food-row]').length : 0;
  }

  // Only previously saved, valid calorie entries are offered. The choices are
  // derived from meal records each time; they are never sent to a service or
  // persisted as a second copy of the user's food history.
  function recentFoods(events) {
    const choices = new Map();
    if (!Array.isArray(events)) return [];
    events.slice(0, 300).forEach((event, index) => {
      if (!Array.isArray(event?.foods)) return;
      event.foods.forEach((food) => {
        if (typeof food?.name !== 'string' || !food.name.trim() || food.name.length > 100 ||
            !Number.isFinite(food.kcal) || food.kcal < 0 || food.kcal > MAX_KCAL) return;
        const name = food.name.trim();
        const key = name.toLocaleLowerCase();
        let choice = choices.get(key);
        if (!choice) {
          const item = { name, kcal: food.kcal };
          if (Number.isFinite(food.grams) && food.grams > 0 && food.grams <= MAX_GRAMS) item.grams = food.grams;
          choice = { item, count: 0, index };
          choices.set(key, choice);
        }
        choice.count += 1;
      });
    });
    return [...choices.values()].sort((a, b) => b.count - a.count || a.index - b.index).slice(0, 8).map((choice) => choice.item);
  }

  function showRecentFoods(events) {
    // The short form only offers three touch-sized suggestions.  The full
    // history remains in the History tab; a select here made a quick record
    // look like a second form.
    const slot = byId('food-recent-slot');
    if (slot) {
      slot.replaceChildren();
      const choices = recentFoods(events).slice(0, 3);
      if (!choices.length) { slot.hidden = true; return; }
      const label = document.createElement('span');
      label.className = 'food-recent-label';
      label.textContent = copy('최근 음식', 'Recent foods');
      const chips = document.createElement('div');
      chips.className = 'food-recent-chips';
      choices.forEach((food, index) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'food-recent-chip';
        chip.dataset.recentIndex = String(index);
        chip.textContent = food.name;
        chip.title = `${food.name} · ${food.kcal} kcal`;
        // Keep the text area focused when a chip is touched, otherwise its
        // blur can start an AI request just before this known local value is
        // reused. Keyboard activation still works through the click handler.
        chip.addEventListener('pointerdown', event => event.preventDefault());
        chip.addEventListener('click', () => {
          const note = byId('meal-note');
          if (!note) return;
          // Pointer activation keeps the note focused, so its blur is deferred.
          // Bind suppression to this exact note revision; a later user edit must
          // never inherit it.
          skipNextNoteAnalysisRevision = noteRevision;
          reviseFoods();
          const existingNote = note.value.trim();
          if (!existingNote) note.value = food.name;
          else if (!existingNote.toLocaleLowerCase().includes(food.name.toLocaleLowerCase())) note.value = `${existingNote}, ${food.name}`;
          noteEdited = false;
          const rows = [...document.querySelectorAll('#food-items [data-food-row]')];
          const same = rows.find((row) => sameVisibleFood(row, food));
          if (!same) {
            const blank = rows.find(row => [...row.querySelectorAll('input')].every(control => !control.value.trim() && !control.validity.badInput));
            if (blank) blank.remove();
            addRow(food);
          }
          setText(byId('food-text-status'), copy(`${food.name}을(를) 불러왔어요. 칼로리는 필요하면 수정할 수 있어요.`, `${food.name} added. You can change the calories if needed.`));
          updateTotal();
        });
        chips.append(chip);
      });
      slot.append(label, chips);
      slot.hidden = true;
      return;
    }
    const container = byId('food-items');
    if (!container) return;
    byId('food-recent')?.remove();
    const choices = recentFoods(events).map(food => ({ kind: 'food', food }));
    const seenNotes = new Set();
    (Array.isArray(events) ? events.slice(0, 300) : []).forEach((event) => {
      if (Array.isArray(event?.foods) && event.foods.length) return;
      const note = typeof event?.note === 'string' ? event.note.trim() : '';
      if (!note || note.length > 200 || seenNotes.has(note)) return;
      seenNotes.add(note);
      if (seenNotes.size <= 3) choices.push({ kind: 'note', note });
    });
    if (!choices.length) return;
    const section = document.createElement('div');
    section.id = 'food-recent';
    const select = document.createElement('select');
    select.id = 'food-recent-select';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = copy('음식 선택', 'Choose a food');
    select.append(first);
    choices.forEach((choice, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      if (choice.kind === 'note') {
        option.textContent = copy(`이전 음식 메모 · ${choice.note}`, `Previous food note · ${choice.note}`);
      } else {
        const food = choice.food;
        const amount = food.grams === undefined ? '' : ` · ${food.grams} g`;
        option.textContent = `${food.name}${amount} · ${food.kcal} kcal`;
      }
      select.append(option);
    });
    const label = field(copy('최근·자주 먹은 음식', 'Recent and frequent foods'), select);
    const help = document.createElement('p');
    help.className = 'field-help';
    help.setAttribute('role', 'status');
    help.textContent = copy('선택 후 음식과 양을 바꿀 수 있어요.', 'You can change the food and amount after choosing it.');
    select.addEventListener('change', () => {
      if (select.value === '') return;
      const selected = choices[Number(select.value)];
      select.value = '';
      if (!selected) return;
      if (selected.kind === 'note') {
        const note = byId('meal-note');
        if (note.value.trim()) {
          help.textContent = copy('음식 메모가 이미 있어요. 비운 뒤 이전 메모를 선택해 주세요.', 'The food note is not empty. Clear it before choosing a previous note.');
        } else {
          note.value = selected.note;
          // Reusing a saved note is not consent to a new AI request, even if
          // the optional auto-analysis preference was previously enabled.
          noteEdited = false;
          help.textContent = copy('이전 음식 메모를 불러왔어요. 내용을 확인해 주세요.', 'Previous food note added. Check it before saving.');
        }
        note.focus({ preventScroll: true });
        return;
      }
      const choice = selected.food;
      const rows = [...container.querySelectorAll('[data-food-row]')];
      const existing = rows.find((row) => sameVisibleFood(row, choice));
      if (existing) {
        help.textContent = copy('이미 추가된 음식이에요. 양과 칼로리를 확인해 주세요.', 'This food is already added. Check its amount and calories.');
        const target = existing.hasAttribute('data-food-name-compact') ? '[data-food-kcal]' : '[data-food-name]';
        existing.querySelector(target).focus({ preventScroll: true });
        return;
      }
      const blank = rows.find((row) => !row.hasAttribute('data-food-review') &&
        [...row.querySelectorAll('input')].every((control) => !control.value.trim() && !control.validity.badInput));
      if (blank) blank.remove();
      reviseFoods();
      const added = addRow(choice);
      if (added) {
        const addedName = added.querySelector('[data-food-name]');
        const addedKcal = added.querySelector('[data-food-kcal]');
        const addedDensity = added.querySelector('[data-food-density]');
        addedName.addEventListener('input', () => {
          if (addedName.value.trim() === choice.name) return;
          addedDensity.value = '';
          addedKcal.value = '';
          addedKcal.removeAttribute('data-calculated');
          help.textContent = copy('음식 이름을 바꿨어요. 칼로리를 확인해 주세요.', 'Food name changed. Check the calories.');
          updateTotal();
        });
        help.textContent = copy('음식을 추가했어요. 메뉴의 총 칼로리를 확인해 주세요.', 'Food added. Check the total calories for this item.');
        (added.hasAttribute('data-food-name-compact') ? addedKcal : addedName).focus({ preventScroll: true });
      }
    });
    section.append(label, help);
    container.before(section);
  }

  function updateTotal() {
    refreshFoodRowPresentation();
    const output = byId('food-total');
    const summary = byId('food-summary');
    const summaryTotal = byId('food-summary-total');
    const summaryItems = byId('food-summary-items');
    const summaryHelp = byId('food-summary-help');
    const rows = document.querySelectorAll('#food-items [data-food-kcal]');
    let total = 0;
    let calculated = 0;
    let missingAmount = false;
    let incomplete = false;
    const names = [];
    rows.forEach((control) => {
      const row = control.closest('[data-food-row]');
      const name = row?.querySelector('[data-food-name]')?.value.trim() || '';
      const kcalRaw = control.value.trim();
      const gramsRaw = row?.querySelector('[data-food-grams]')?.value.trim() || '';
      const densityRaw = row?.querySelector('[data-food-density]')?.value.trim() || '';
      const kcal = finiteNumber(kcalRaw);
      const grams = finiteNumber(gramsRaw);
      const density = finiteNumber(densityRaw);
      const validName = name.length > 0 && name.length <= 100;
      const validKcal = Number.isFinite(kcal) && kcal >= 0 && kcal <= MAX_KCAL;
      const validGrams = gramsRaw === '' || (Number.isFinite(grams) && grams > 0 && grams <= MAX_GRAMS);
      const validDensity = densityRaw === '' || (Number.isFinite(density) && density >= 0 && density <= MAX_DENSITY);
      const validForSave = validName && validKcal && validGrams && validDensity;
      const requiresChoice = Boolean(row?.hasAttribute('data-food-review') && !name);
      const hasInput = Boolean(name || kcalRaw || gramsRaw || densityRaw);

      if (validForSave) {
        total += kcal;
        calculated++;
        names.push({ name, kcal });
      } else if (hasInput || requiresChoice) {
        incomplete = true;
        if (validName && densityRaw && !kcalRaw && !gramsRaw) missingAmount = true;
      }
    });
    const needsCorrection = incomplete || missingAmount;
    const aiDraft = Boolean(document.querySelector('#food-items [data-food-photo-draft], #food-items [data-food-text-draft]'));
    const showAiResult = aiDraft && calculated > 0;
    positionFoodSummary();
    const formatted = roundKcal(total).toLocaleString(isEnglish() ? 'en-US' : 'ko-KR', { maximumFractionDigits: 1 });
    const message = needsCorrection
      ? (calculated ? copy(`계산된 합계 ${formatted} kcal · 입력 확인 필요`, `Calculated subtotal ${formatted} kcal · review needed`)
        : copy('음식 이름과 칼로리를 확인하면 합계가 표시돼요.', 'Enter a food name and calories to show the total.'))
      : (calculated ? copy(`합계 ${formatted} kcal`, `Total ${formatted} kcal`) : '');
    setText(output, message);
    if (output) output.hidden = !message || showAiResult || (!needsCorrection && rowCount() <= 1);
    if (summary) summary.hidden = !showAiResult;
    if (summaryTotal) setText(summaryTotal, calculated ? `${formatted} kcal` : '');
    if (summaryItems) {
      summaryItems.replaceChildren(...names.map((item) => {
        const line = document.createElement('li');
        line.textContent = `${item.name} · ${roundKcal(item.kcal).toLocaleString(isEnglish() ? 'en-US' : 'ko-KR', { maximumFractionDigits: 1 })} kcal`;
        return line;
      }));
    }
    if (summaryHelp) setText(summaryHelp, needsCorrection
      ? copy('빠진 정보가 있는 음식은 합계에 포함되지 않아요. 수정에서 음식 이름과 칼로리를 확인해 주세요.', 'Items with missing information are not included. Check the food name and calories in Edit.')
      : '');
    root.dispatchEvent(new CustomEvent('meal:foods-changed', { detail: { count: calculated, total: calculated ? roundKcal(total) : null, incomplete: needsCorrection } }));
  }

  function positionFoodSummary() {
    const summary = byId('food-summary');
    const aiTools = byId('meal-ai-tools');
    if (!summary || !aiTools) return;
    // Keep every AI result above manual entry, including multi-photo totals.
    if (summary.previousElementSibling !== aiTools) aiTools.after(summary);
    const summaryItems = byId('food-summary-items');
    if (summaryItems) summaryItems.hidden = summary.hasAttribute('data-multi-photo-summary') ||
      Boolean(document.querySelector('#food-items [data-food-name-compact]'));
  }

  // The calorie path opens below the short meal form. Keep the first row's
  // label clear of the fixed dialog header as well as the editable fields
  // clear of the save bar, without moving focus or opening the keyboard.
  function revealFoodEntry() {
    const foods = byId('meal-foods');
    const scroller = document.querySelector('#meal-dialog .meal-form-body');
    const target = foods?.querySelector('.food-row, .food-fields, [data-food-name]');
    if (!foods || !scroller || !target) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const clearHeader = 28;
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + top - clearHeader), behavior: 'instant' });
  }

  function computeKcal(row) {
    const grams = finiteNumber(row.querySelector('[data-food-grams]').value.trim());
    const density = finiteNumber(row.querySelector('[data-food-density]').value.trim());
    const kcal = row.querySelector('[data-food-kcal]');
    if (kcal.hasAttribute('data-calculated')) kcal.value = '';
    if (Number.isFinite(grams) && grams > 0 && grams <= MAX_GRAMS && Number.isFinite(density) && density >= 0 && density <= MAX_DENSITY) {
      const computed = roundKcal((grams * density) / 100);
      if (computed <= MAX_KCAL) {
        kcal.value = String(computed);
        kcal.setAttribute('data-calculated', '');
      }
    }
    updateTotal();
  }

  function removeRow(row) {
    reviseFoods();
    row.remove();
    if (rowCount() === 0) addRow();
    updateTotal();
  }

  function addRow(food) {
    const container = byId('food-items');
    if (!container) return null;
    if (rowCount() >= MAX_FOODS) {
      setStatus(copy(`음식은 최대 ${MAX_FOODS}개까지 추가할 수 있어요.`, `You can add up to ${MAX_FOODS} foods.`), 'error');
      return null;
    }
    if (rowCount() > 0) showMenuNames();

    const data = food && typeof food === 'object' ? food : {};
    const row = document.createElement('section');
    row.className = 'food-row';
    row.dataset.foodRow = 'true';
    // Draft-only provenance: removing every result from this photo allows a
    // fresh analysis; editing a result keeps the duplicate guard in place.
    if (data.photoFingerprint) row.dataset.foodPhotoFingerprint = data.photoFingerprint;
    if (!food) row.dataset.foodNoteDefault = 'true';

    const header = document.createElement('div');
    header.className = 'food-row-head';
    const heading = document.createElement('strong');
    heading.textContent = copy(`음식 ${rowCount() + 1}`, `Food ${rowCount() + 1}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', copy('음식 항목 삭제', 'Remove food item'));
    remove.addEventListener('click', () => removeRow(row));
    header.append(heading, remove);

    const fields = document.createElement('div');
    fields.className = 'food-fields';
    const name = input('text', '', data.name, copy('예: 김밥', 'e.g. gimbap'));
    name.maxLength = 100;
    name.setAttribute('enterkeyhint', 'next');
    name.dataset.foodName = 'true';
    // Preserve saved portions and AI metadata without a second input form.
    // The user edits the total calories for the food they actually ate.
    const grams = input('hidden', '', data.grams, '');
    grams.dataset.foodGrams = 'true';
    const kcal = input('number', '', data.kcal, copy('예: 450', 'e.g. 450'));
    kcal.inputMode = 'decimal';
    kcal.min = '0';
    kcal.max = String(MAX_KCAL);
    kcal.step = 'any';
    kcal.setAttribute('enterkeyhint', 'done');
    kcal.dataset.foodKcal = 'true';
    const density = input('hidden', '', data.kcalPer100g, '');
    density.dataset.foodDensity = 'true';

    const originalName = canonicalFoodName(data.name);

    kcal.addEventListener('input', () => {
      clearFoodValidation(kcal);
      applyNoteDefaultName(row);
      kcal.removeAttribute('data-calculated');
      reviseFoods();
      updateTotal();
    });
    name.addEventListener('input', () => {
      clearFoodValidation(name);
      // Any user name edit takes ownership away from the note.  Later note
      // changes must not overwrite an explicitly named second menu.
      delete row.dataset.foodNoteDefault;
      manualNamesVisible = true;
      // The g and density inputs are hidden metadata.  If a saved/AI menu is
      // renamed, they no longer describe the visible food and must not leak
      // into the next save or duplicate check.
      if (canonicalFoodName(name.value) !== originalName) {
        grams.value = '';
        density.value = '';
        if (kcal.hasAttribute('data-calculated')) kcal.value = '';
        kcal.removeAttribute('data-calculated');
      }
      reviseFoods();
      updateTotal();
    });
    name.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      kcal.focus();
    });
    kcal.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      kcal.blur();
    });
    const nameField = field(copy('메뉴', 'Menu'), name);
    nameField.dataset.foodNameField = 'true';
    fields.append(
      nameField,
      field(copy('총 칼로리', 'Total kcal'), kcal)
    );
    row.append(header, fields, grams, density);
    container.append(row);
    if (data.photoDraft || data.textDraft) {
      const draftKey = data.textDraft ? 'foodTextDraft' : 'foodPhotoDraft';
      row.dataset[draftKey] = 'true';
      if (data.kcalPer100g) kcal.dataset.calculated = 'true';
      row.addEventListener('input', () => { delete row.dataset[draftKey]; }, { once: true, capture: true });
      if (data.estimated) {
        const estimate = document.createElement('small');
        estimate.className = 'food-ai-estimate';
        estimate.textContent = copy(' · AI 열량 참고값', ' · AI calorie estimate');
        heading.append(estimate);
        [name, density, kcal].forEach((control) => control.addEventListener('input', () => estimate.remove(), { once: true }));
      }
      if (data.photoSource) {
        const source = document.createElement('small');
        source.className = 'food-photo-source';
        source.textContent = copy(` · 사진 ${data.photoSource}`, ` · Photo ${data.photoSource}`);
        heading.append(source);
      }
    }
    if (data.choices?.length) {
      row.dataset.foodReview = 'true';
      const select = document.createElement('select');
      select.className = 'food-photo-choice';
      select.append(new Option(copy('먹은 음식 선택', 'Select what you ate'), ''));
      data.choices.forEach((item) => select.append(new Option(item.name, item.name)));
      select.addEventListener('change', () => {
        const chosen = data.choices.find((item) => item.name === select.value);
        if (!chosen) return;
        delete row.dataset.foodPhotoDraft;
        name.value = chosen.name;
        density.value = String(chosen.kcalPer100g);
        kcal.value = '';
        computeKcal(row);
      });
      row.insertBefore(field(copy('국·찌개 종류 확인', 'Confirm soup or stew'), select), fields);
    }
    updateTotal();
    return row;
  }

  function photoEndpoint() {
    const raw = document.querySelector('meta[name="dansik-food-photo-endpoint"]')?.content;
    if (!raw || !/^https?:$/.test(root.location.protocol) || !document.body.classList.contains('is-pwa')) return null;
    try {
      const url = new URL(raw, root.location.href);
      const local = url.origin === root.location.origin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const worker = url.protocol === 'https:' && !url.port && url.hostname.endsWith('.workers.dev');
      return (local || worker) && url.pathname === '/meal-photo/analyze' && !url.search && !url.hash && !url.username && !url.password ? url : null;
    } catch { return null; }
  }

  function codeKey() { return `dansik:food-photo-code:v1:${endpoint.origin}`; }

  function providerDisclosure(provider = aiProvider) {
    return provider === 'gemini'
      ? copy('계산할 음식 글과 고른 사진이 Cloudflare 중계 서버를 거쳐 Gemini로 전송돼요. Gemini 무료 등급에서는 전송한 데이터가 Google 서비스 개선에 사용될 수 있어요. 결과를 확인한 뒤 저장하세요.', 'Food descriptions you calculate and selected photos are sent to Gemini through the Cloudflare relay server. With the Gemini free tier, submitted data may be used to improve Google services. Check the result before saving.')
      : copy('계산할 음식 글과 고른 사진이 Cloudflare AI로 전송돼요. 결과를 확인한 뒤 저장하세요.', 'Food descriptions you calculate and selected photos are sent to Cloudflare AI. Check the result before saving.');
  }

  function providerTextHelp(provider = aiProvider) {
    return provider === 'gemini'
      ? copy('예: 두부 150g. 자동 계산을 켜면 음식 칸에서 나올 때 글이 Cloudflare 중계 서버를 거쳐 Gemini로 전송돼요.', 'Example: 150 g tofu. With automatic calculation on, leaving the food field sends the text to Gemini through the Cloudflare relay server.')
      : copy('예: 두부 150g. 자동 계산을 켜면 음식 칸에서 나올 때 글이 Cloudflare AI로 전송돼요.', 'Example: 150 g tofu. With automatic calculation on, leaving the food field sends the text to Cloudflare AI.');
  }

  function accessCodeSavedMessage() {
    if (providerDraftActive) {
      return copy('AI 연결 코드를 임시 적용했어요. 저장을 누르면 이 기기에 저장돼요.', 'The AI access code is applied temporarily. Choose Save to store it on this device.');
    }
    return aiProvider === 'gemini'
      ? copy('AI 연결 코드를 저장했어요. Gemini 서버 준비 상태는 분석할 때 확인돼요.', 'The AI access code is saved. Gemini server readiness is checked when you analyze.')
      : copy('사진 분석을 연결했어요. 음식 사진을 찍거나 올려 보세요.', 'Photo analysis is connected. Take or add a food photo.');
  }

  function updateProviderUi() {
    const select = byId('food-ai-provider');
    if (select) select.value = aiProvider;
    const help = byId('food-ai-provider-help');
    if (help) {
      setText(help, aiProvider === 'gemini'
        ? copy('Gemini API 키는 이 앱에 입력하지 않아요. 서버에 안전하게 등록되어 있어야 해요. Gemini 무료 등급 전송 데이터는 Google 서비스 개선에 사용될 수 있어요.', 'A Gemini API key is never entered in this app. It must be securely registered on the server. Gemini free-tier submitted data may be used to improve Google services.')
        : copy('Cloudflare AI 분석을 사용해요. 이 기기의 AI 연결 코드가 필요해요.', 'Cloudflare AI analysis is selected. This device needs an AI access code.'));
    }
    setText(byId('food-ai-disclosure-detail'), providerDisclosure());
    setText(byId('food-text-help'), providerTextHelp());
    const setup = byId('food-ai-setup');
    if (setup) setup.hidden = Boolean(photoCode);
    const disconnect = byId('food-ai-disconnect');
    if (disconnect) disconnect.hidden = !photoCode;
    const textAuto = byId('food-text-auto');
    if (textAuto) textAuto.disabled = !providerReady();
    const quotaCheck = byId('food-quota-check');
    if (quotaCheck) quotaCheck.hidden = false;
    const quotaStatus = byId('food-quota-status');
    if (quotaStatus && aiProvider === 'gemini') {
      setText(quotaStatus, copy('Gemini 공급자 한도와 별개로 Cloudflare 중계 서버의 앱 공통 잔여 분석 횟수를 아래에서 확인할 수 있어요.', 'You can check the app-wide remaining analyses on the Cloudflare relay server below; this is separate from Gemini provider limits.'));
    } else if (quotaStatus?.dataset.providerNotice === 'gemini') {
      setText(quotaStatus, '');
    }
    if (quotaStatus) quotaStatus.dataset.providerNotice = aiProvider;
  }

  function setAiProvider(value) {
    const nextProvider = normalizeProvider(value);
    if (nextProvider !== aiProvider) {
      cancelAnalysis();
      setText(byId('food-text-status'), '');
      setText(byId('food-photo-status'), '');
    }
    aiProvider = nextProvider;
    updateProviderUi();
    updateTextActions();
  }

  function beginProviderDraft() {
    providerDraftBaseline = { provider: savedProvider, photoCode: savedPhotoCode, textAuto: savedTextAuto };
    providerDraftActive = true;
    cancelAnalysis();
    noteEdited = false;
    setText(byId('food-ai-connection-status'), '');
  }

  function commitProviderDraft() {
    savedProvider = aiProvider;
    savedPhotoCode = photoCode;
    savedTextAuto = Boolean(byId('food-text-auto')?.checked);
    providerDraftBaseline = null;
    providerDraftActive = false;
    noteEdited = false;
    try { root.localStorage.setItem(AI_PROVIDER_KEY, savedProvider); } catch { /* optional persistence */ }
    persistPhotoCode(savedPhotoCode);
    try { root.localStorage.setItem(TEXT_AUTO_KEY, savedTextAuto ? '1' : '0'); } catch { /* optional persistence */ }
  }

  function revertProviderDraft() {
    setText(byId('food-ai-connection-status'), '');
    if (providerDraftBaseline === null) return;
    const baseline = providerDraftBaseline;
    providerDraftBaseline = null;
    providerDraftActive = false;
    noteEdited = false;
    setAiProvider(baseline.provider);
    setPhotoCode(baseline.photoCode, { persist: false });
    const textAuto = byId('food-text-auto');
    if (textAuto) textAuto.checked = baseline.textAuto;
    updateTextActions();
  }

  function updateTextActions() {
    const calculate = byId('food-text-calculate');
    const auto = byId('food-text-auto');
    // Connection controls and transfer information live in top-level Settings.
    const ready = providerReady();
    if (calculate) calculate.hidden = !ready || Boolean(auto?.checked);
    const options = byId('food-text-options');
    if (options) options.hidden = !calculate || calculate.hidden;
    const automatic = Boolean(ready && auto?.checked);
    const note = byId('meal-note');
    if (note) note.setAttribute('aria-describedby', 'food-text-status');
    const badge = byId('food-ai-state');
    if (badge) badge.dataset.i18n = !endpoint ? 'intake.aiStateManual' : !photoCode ? 'intake.aiStateDisconnected' : aiProvider === 'gemini' ? 'intake.aiStateGemini' : automatic ? 'intake.aiStateAuto' : 'intake.aiStateConnected';
    setText(badge, !endpoint ? copy('직접 입력', 'Manual') : !photoCode ? copy('연결 안 됨', 'Not connected') : aiProvider === 'gemini' ? copy('Gemini 선택됨 · 3.5 Flash-Lite', 'Gemini selected · 3.5 Flash-Lite') : automatic ? copy('자동 계산 켜짐', 'Auto on') : copy('연결됨', 'Connected'));
  }

  function persistPhotoCode(code) {
    try {
      if (code) root.localStorage.setItem(codeKey(), code);
      else root.localStorage.removeItem(codeKey());
    } catch { /* storage can be unavailable in private browser sessions */ }
  }

  function setPhotoCode(code, { persist = !providerDraftActive } = {}) {
    if (code) stopQrScan();
    photoCode = code;
    if (persist) {
      savedPhotoCode = code;
      persistPhotoCode(code);
    }
    const codeInput = byId('food-ai-code');
    if (codeInput) codeInput.value = '';
    updateProviderUi();
    // No standing hint without a code: pressing Calculate explains and opens the setup.
    setText(byId('food-text-status'), '');
    updateTextActions();
  }

  function codeFromQrLink(link) {
    if (!link.startsWith(PAIR_LINK)) return '';
    const code = link.slice(PAIR_LINK.length);
    return CODE_PATTERN.test(code) ? code : '';
  }

  function connectFromQr(code) {
    if (!code) return copy('단식 타이머 연결용 QR을 찍어 주세요.', 'Scan the QR code for Dansik Timer.');
    if (photoCode && photoCode !== code) return copy('이미 연결되어 있어요. 바꾸려면 기존 연결을 먼저 꺼 주세요.', 'Already connected. Turn off the current connection to replace it.');
    setPhotoCode(code);
    return accessCodeSavedMessage();
  }

  function showQrConnection(code) {
    const valid = Boolean(code && (!photoCode || photoCode === code));
    setConnectionStatus(connectFromQr(code), valid ? 'ready' : 'error');
  }

  function consumePhotoPairLink() {
    const link = root.location.href;
    if (!link.startsWith(PAIR_LINK)) return;
    root.history.replaceState(root.history.state, '', root.location.pathname);
    const code = codeFromQrLink(link);
    const valid = Boolean(code && (!photoCode || photoCode === code));
    const message = connectFromQr(code);
    if (byId('meal-dialog').open) setStatus(message, valid ? 'ready' : 'error');
    else root.dispatchEvent(new CustomEvent('dansik:photo-pair', { detail: message }));
  }

  function readQrFrame(source, width, height, canvas, fraction, maxSize) {
    const side = Math.round(Math.min(width, height) * fraction);
    const cropWidth = fraction === 1 ? width : side;
    const cropHeight = fraction === 1 ? height : side;
    const scale = Math.min(1, maxSize / Math.max(cropWidth, cropHeight));
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return root.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
  }

  function stopQrScan() {
    qrReadGeneration += 1;
    const button = byId('food-ai-scan');
    const preview = byId('food-ai-qr-preview');
    if (button) button.disabled = false;
    if (preview) preview.hidden = true;
    if (!qrSession) return;
    const session = qrSession;
    qrSession = null;
    root.clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
    session.video.pause();
    session.video.srcObject = null;
    session.preview.hidden = true;
    session.button.disabled = false;
  }

  async function startQrScan(input, button) {
    const video = byId('food-ai-qr-video');
    const preview = byId('food-ai-qr-preview');
    const dialog = preview?.closest('dialog');
    if (!dialog?.open) return;
    if (!video || !preview || !navigator.mediaDevices?.getUserMedia) {
      input.click();
      return;
    }
    if (qrSession) return;
    stopQrScan();
    stopCamera(false);
    const session = { button, video, preview, dialog, stream: null, timer: null };
    qrSession = session;
    button.disabled = true;
    setConnectionStatus(copy('카메라를 여는 중이에요.', 'Opening the camera.'), 'loading');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (qrSession !== session || !dialog.open || preview.closest('dialog') !== dialog) {
        stream.getTracks().forEach((track) => track.stop());
        if (qrSession === session) stopQrScan();
        return;
      }
      session.stream = stream;
      video.srcObject = stream;
      preview.hidden = false;
      preview.scrollIntoView({ block: 'nearest' });
      const canvas = document.createElement('canvas');
      const deadline = Date.now() + 30000;
      const fail = () => {
        if (qrSession !== session) return;
        stopQrScan();
        setConnectionStatus(copy('카메라로 읽지 못했어요. QR 사진 찍기를 눌러 다시 시도해 주세요.', 'Could not scan with the camera. Try Take QR photo.'), 'error');
      };
      const read = () => {
        if (qrSession !== session) return;
        if (!dialog.open || preview.closest('dialog') !== dialog) { stopQrScan(); return; }
        if (Date.now() >= deadline) { fail(); return; }
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          let result;
          try { result = readQrFrame(video, video.videoWidth, video.videoHeight, canvas, 0.95, 800); }
          catch { fail(); return; }
          if (result) {
            stopQrScan();
            showQrConnection(codeFromQrLink(result.data));
            return;
          }
        }
        session.timer = root.setTimeout(read, 220);
      };
      setConnectionStatus('');
      video.play().catch(fail);
      read();
    } catch {
      if (qrSession === session) {
        stopQrScan();
        setConnectionStatus(copy('카메라 권한을 확인하거나 QR 사진 찍기를 눌러 주세요.', 'Check camera permission or tap Take QR photo.'), 'error');
      }
    }
  }

  async function scanPhotoPairQr(file) {
    const button = byId('food-ai-scan');
    const dialog = byId('food-ai-qr-file')?.closest('dialog');
    stopQrScan();
    const qrGeneration = qrReadGeneration;
    const generation = transientGeneration;
    const active = () => isCurrentGeneration(generation) && qrGeneration === qrReadGeneration && dialog?.open && byId('food-ai-qr-file')?.closest('dialog') === dialog;
    if (!active()) return;
    button.disabled = true;
    try {
      if (file.size > MAX_IMAGE_BYTES || typeof root.jsQR !== 'function') throw new Error('QR image unavailable');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reader.onabort = reject;
        reader.readAsDataURL(file);
      });
      const qrImage = new Image();
      await new Promise((resolve, reject) => {
        qrImage.onload = resolve;
        qrImage.onerror = reject;
        qrImage.src = dataUrl;
      });
      if (!active()) return;
      const canvas = document.createElement('canvas');
      const result = readQrFrame(qrImage, qrImage.naturalWidth, qrImage.naturalHeight, canvas, 0.48, 1600)
        || readQrFrame(qrImage, qrImage.naturalWidth, qrImage.naturalHeight, canvas, 1, 1600);
      if (!result) throw new Error('QR code not found');
      showQrConnection(codeFromQrLink(result.data));
    } catch {
      if (active()) setConnectionStatus(copy('QR을 읽지 못했어요. PC 화면의 QR 전체가 보이게 다시 찍어 주세요.', 'Could not read the QR code. Capture the entire code on your PC screen.'), 'error');
    } finally {
      if (qrGeneration === qrReadGeneration) button.disabled = false;
    }
  }

  function analysisPending() {
    return !!analysisRequest || !!photoBatch || !!photoSelectionPending || photoReadGeneration !== null;
  }

  function batchIsActive(batch) {
    return photoBatch === batch && !batch.cancelled && isCurrentGeneration(batch.generation) && byId('meal-dialog')?.open;
  }

  function setPhotoBatchProgress(batch, message) {
    const progress = byId('food-photo-progress');
    const text = byId('food-photo-progress-text');
    if (progress) progress.hidden = !batch;
    if (text) text.textContent = message || '';
    const cancel = byId('food-photo-analysis-cancel');
    if (cancel) cancel.hidden = !batch;
  }

  function setPhotoBatchItem(batch, index, state, label, src) {
    const item = byId('food-photo-preview-list')?.querySelector(`[data-photo-index="${index}"]`);
    if (!item || photoBatch !== batch) return;
    item.dataset.photoState = state;
    const thumb = item.querySelector('.food-photo-preview-thumb');
    if (thumb && src) thumb.src = src;
    const text = item.querySelector('.food-photo-preview-label');
    if (text && label) text.textContent = label;
  }

  function renderPhotoBatch(batch) {
    const list = byId('food-photo-preview-list');
    if (!list) return;
    list.replaceChildren();
    batch.files.forEach((file, index) => {
      const item = document.createElement('li');
      item.className = 'food-photo-preview-item';
      item.dataset.photoIndex = String(index);
      item.dataset.photoState = 'pending';
      const thumb = document.createElement('img');
      thumb.className = 'food-photo-preview-thumb';
      thumb.alt = copy(`선택한 음식 사진 ${index + 1}`, `Selected food photo ${index + 1}`);
      const label = document.createElement('span');
      label.className = 'food-photo-preview-label';
      label.textContent = copy(`사진 ${index + 1} 대기 중`, `Photo ${index + 1} waiting`);
      item.append(thumb, label);
      list.append(item);
    });
    list.hidden = !batch.files.length;
  }

  function updateAnalysisActions() {
    const pending = analysisPending();
    const calculate = byId('food-text-calculate');
    if (calculate) calculate.disabled = pending;
    const stop = byId('meal-analysis-stop');
    if (stop) stop.hidden = !pending;
    refreshAnalysisFeedback();
    const error = byId('meal-error');
    if (!pending && error?.hasAttribute('data-analysis-pending')) {
      error.removeAttribute('data-analysis-pending');
      error.textContent = '';
    }
  }

  function cancelAnalysis() {
    if (analysisRequest?.kind === 'text') setText(byId('food-text-status'), '');
    analysisRequest?.controller.abort();
    analysisRequest = null;
    if (photoBatch) {
      photoBatch.cancelled = true;
      photoBatch.controller?.abort();
    }
    if (photoSelectionPending) {
      photoSelectionPending.cancelled = true;
      photoSelectionPending = null;
      photoSelectionGeneration += 1;
      setPhotoBatchProgress(null, '');
    }
    updateAnalysisActions();
  }

  function discardDrafts(kind) {
    const rows = document.querySelectorAll(`#food-items [data-food-${kind}-draft]`);
    if (!rows.length) return;
    rows.forEach((row) => row.remove());
    if (rowCount() === 0) addRow();
    updateTotal();
  }

  function photoJpeg(preview) {
    const width = preview.naturalWidth;
    const height = preview.naturalHeight;
    if (!width || !height) return Promise.resolve(null);
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return Promise.resolve(null);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }

  function photoThumbnail(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return '';
    const scale = Math.min(1, 192 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return '';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  function insertAnalyzedFoods(result, kind, status, options = {}) {
    if (!Array.isArray(result?.foods) || !Array.isArray(result.unmatched)) throw new Error('Invalid analysis result');
    const fromText = kind === 'text';
    // Both providers may return a safe AI estimate for an otherwise unknown
    // food.  The Worker has already schema-validated it; still validate every
    // numeric field below before it reaches an editable row.  MFDS remains the
    // preferred source because its matched results retain source: "mfds".
    const allowedSource = (food) => food?.source === 'mfds' || food?.source === 'ai';
    const needsAmount = (food) => food?.grams === null && allowedSource(food) && Number.isFinite(food.kcalPer100g);
    const matches = [...result.foods, ...result.unmatched.filter(needsAmount)];
    const items = matches.slice(0, MAX_FOODS).flatMap((food) => {
      if (!allowedSource(food) || typeof food.name !== 'string') return [];
      const name = food.name.trim();
      const { grams, kcalPer100g } = food;
      if (!name || name.length > 100 || !Number.isFinite(kcalPer100g) || kcalPer100g < 0 || kcalPer100g > MAX_DENSITY) return [];
      if (grams !== null && (!Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS)) return [];
      const kcal = grams === null ? null : roundKcal(grams * kcalPer100g / 100);
      return kcal === null || kcal <= MAX_KCAL ? [{ name, grams, kcalPer100g, kcal,
        photoDraft: !fromText, textDraft: fromText, estimated: food.source === 'ai' }] : [];
    });
    const needsReview = result.unmatched.slice(0, MAX_FOODS).flatMap((item) => {
      if (!Array.isArray(item?.choices)) return [];
      const choices = item.choices.slice(0, 60).filter((choice) => typeof choice?.name === 'string' && choice.name.length <= 100 &&
        Number.isFinite(choice.kcalPer100g) && choice.kcalPer100g > 0 && choice.kcalPer100g <= MAX_DENSITY);
      const grams = Number.isFinite(item.grams) && item.grams > 0 && item.grams <= MAX_GRAMS ? item.grams : null;
      return choices.length ? [{ grams, choices, photoDraft: true }] : [];
    });
    const unmatchedNames = result.unmatched.filter((item) => !item?.choices?.length && !needsAmount(item)).slice(0, 3)
      .map((item) => typeof item?.name === 'string' ? item.name.trim().slice(0, 60) : '').filter(Boolean);
    const unmatched = unmatchedNames.join(', ');
    items.push(...needsReview);
    if (items.length) {
      // AI sources must never erase each other. Text refreshes only replace
      // an earlier text suggestion; photos always append so prior photos and
      // user-entered rows remain available for review.
      if (options.replaceTextDrafts) discardDrafts('text');
      if (options.replacePhotoDrafts) discardDrafts('photo');
      document.querySelectorAll('#food-items [data-food-row]').forEach((row) => {
        if ([...row.querySelectorAll('input')].every((control) => !control.value.trim() && !control.validity.badInput)) row.remove();
      });
    }
    const room = MAX_FOODS - rowCount();
    const inserted = items.slice(0, room);
    if (!fromText) inserted.forEach((item) => {
      if (options.photoSource) item.photoSource = options.photoSource;
      if (options.photoFingerprint) item.photoFingerprint = options.photoFingerprint;
    });
    inserted.forEach((item) => addRow(item));
    if (!items.length || !room) {
      revealFoodEntry();
      status(unmatched
        ? copy(`칼로리를 계산하지 못했어요. 직접 입력: ${unmatched}`, `No calorie match. Enter manually: ${unmatched}`)
        : copy('자동으로 채울 음식이 없어요. 음식과 칼로리를 직접 입력해 주세요.', 'No food was filled. You can enter food and calories manually.'), 'error');
      return { inserted: 0, unresolved: result.unmatched.length, needsManual: 0, overflow: false, unmatchedNames };
    }
    updateTotal();
    revealFoodEntry();
    const message = fromText
      ? copy('음식과 칼로리를 찾았어요. 결과를 확인한 뒤 저장을 눌러 주세요.', 'Food and calories are ready. Review the result, then save the meal.')
      : copy('사진에서 음식을 찾았어요. 결과를 확인한 뒤 저장을 눌러 주세요.', 'Food was found in the photo. Review the result, then save the meal.');
    const amount = inserted.some((item) => item.grams === null && Number.isFinite(item.kcalPer100g))
      ? (fromText
        ? copy(' 칼로리가 비어 있는 메뉴는 총 칼로리를 직접 입력해 주세요.', 'Enter total calories for any item without a calorie value.')
        : copy(' 음식은 찾았지만 사진만으로 양을 확인할 수 없어 총 칼로리를 입력해 주세요.', 'Food was found, but the portion cannot be confirmed from the photo. Enter the total calories.')) : '';
    const review = needsReview.length ? copy(' 국·찌개는 실제로 먹은 종류를 골라 주세요.', ' Select the soup or stew you ate.') : '';
    const manual = unmatched ? copy(` 직접 입력: ${unmatched}`, ` Enter manually: ${unmatched}`) : '';
    const limited = items.length > room ? copy(' 입력 칸이 부족해 일부만 추가했어요.', ' Only some items fit in the form.') : '';
    status(message + amount + review + manual + limited);
    return {
      inserted: inserted.length,
      unresolved: result.unmatched.length,
      needsManual: inserted.filter((item) => item.grams === null || Array.isArray(item.choices)).length,
      needsAmount: inserted.filter((item) => item.grams === null && Number.isFinite(item.kcalPer100g)).length,
      overflow: items.length > room,
      unmatchedNames
    };
  }

  function analysisError(code, kind, provider = aiProvider) {
    switch (code) {
      case 'AUTH':
        setPhotoCode('');
        return copy('연결 코드가 맞지 않아요. 다시 연결해 주세요.', 'The access code is invalid. Please reconnect.');
      case 'QUOTA':
        return provider === 'gemini'
          ? copy('Gemini 분석 한도에 도달했거나 요청이 많아요. 잠시 후 다시 시도하거나 직접 입력해 주세요. 다른 모델로 자동 전환하지 않아요.', 'Gemini is rate-limited or its analysis limit is reached. Try again shortly or enter food manually. We will not switch models automatically.')
          : copy('Cloudflare AI 분석 한도에 도달했거나 요청이 많아요. 잠시 후 다시 시도하거나 직접 입력해 주세요. 다른 모델로 자동 전환하지 않아요.', 'Cloudflare AI is rate-limited or its analysis limit is reached. Try again shortly or enter food manually. We will not switch models automatically.');
      case 'BUSY':
        return kind === 'text'
          ? copy('분석 요청이 많아 지금 계산할 수 없어요. 입력한 내용은 남아 있어요. 잠시 후 다시 시도해 주세요.', 'The analysis service is busy. Your text was kept. Try again shortly.')
          : copy('분석 요청이 많아 잠시 처리할 수 없어요. 남은 사진은 보내지 않았어요.', 'The analysis service is busy. Remaining photos were not sent.');
      case 'UNAVAILABLE':
        return kind === 'text'
          ? copy('분석 연결이 끊겨 계산하지 못했어요. 입력한 내용은 남아 있어요. 다시 시도하거나 총 칼로리를 직접 입력해 주세요.', 'The analysis connection stopped. Your text was kept. Retry or enter total calories manually.')
          : copy('분석 연결이 끊겨 남은 사진은 보내지 않았어요. 완료된 결과는 남아 있어요.', 'The analysis connection stopped. Remaining photos were not sent; completed results are kept.');
      case 'SHARED_QUOTA':
        sharedQuotaDay = new Date().toISOString().slice(0, 10);
        return copy('Cloudflare 중계 서버의 앱 공통 무료 분석 한도에 도달했어요. UTC 자정 이후 다시 시도하거나 직접 입력해 주세요. 다른 모델로 자동 전환하지 않아요.', 'The app-wide free analysis limit on the Cloudflare relay server is reached. Retry after midnight UTC or enter food manually. We will not switch models automatically.');
      case 'GEMINI_NOT_CONFIGURED':
      case 'NOT_CONFIGURED':
        return copy('Gemini는 서버에 안전하게 등록한 뒤 사용할 수 있어요. 설정에서 AI 분석 모델을 확인하거나 직접 입력해 주세요.', 'Gemini needs secure server registration before it can be used. Check the AI model in Settings or enter food manually.');
      case 'GEMINI_BUSY':
        return copy('Gemini 요청이 많아 지금 계산할 수 없어요. 잠시 후 Gemini로 다시 시도하거나 Cloudflare AI를 직접 선택해 주세요. 다른 모델로 자동 전환하지 않아요.', 'Gemini is busy right now. Try Gemini again shortly or select Cloudflare AI yourself. We will not switch models automatically.');
      case 'GEMINI_AUTH':
        return copy('Gemini 서버 설정을 확인해 주세요. API 키는 앱에 입력하지 마세요.', 'Check the Gemini server setup. Do not enter an API key in the app.');
      case 'GEMINI_MODEL':
        return copy('현재 Gemini 모델을 사용할 수 없어요. 설정을 확인하거나 Cloudflare AI를 직접 선택해 주세요. 다른 모델로 자동 전환하지 않아요.', 'The selected Gemini model is unavailable. Check Settings or select Cloudflare AI yourself. We will not switch models automatically.');
      case 'GEMINI_TIMEOUT':
        return copy('Gemini 응답이 늦어 계산을 중단했어요. 잠시 후 다시 시도해 주세요.', 'Gemini took too long, so the calculation stopped. Try again shortly.');
      case 'GEMINI_RESPONSE':
        return copy('Gemini 결과를 읽지 못했어요. 입력한 내용은 그대로 남아 있어요. 다시 시도하거나 직접 입력해 주세요.', 'Gemini returned an unreadable result. Your entries were kept. Try again or enter calories manually.');
      case 'TEXT':
        return copy('음식 이름과 양을 200자 이내로 적어 주세요.', 'Enter food names and amounts in up to 200 characters.');
      case 'IMAGE':
        return copy('사진을 분석할 수 없어요. 다른 사진을 선택해 주세요.', 'This photo could not be analyzed. Try a different photo.');
      case 'NO_FOOD':
        if (kind === 'text') return copy('입력에서 음식 이름을 찾지 못했어요. 예: 두부 150g.', 'No food name was found. Example: 150 g tofu.');
        return copy('사진에서 음식을 찾지 못했어요. 직접 입력하거나 다른 사진을 선택해 주세요.', 'No food was found. Enter it manually or choose a different photo.');
      default:
        return copy('지금은 음식 분석을 할 수 없어요. 음식은 직접 입력할 수 있어요.', 'Food analysis is unavailable. You can still enter food manually.');
    }
  }

  async function analyze(kind, input, options = {}) {
    const provider = aiProvider;
    const fromText = kind === 'text';
    const status = (message, state = 'ready') => analysisStatus(kind, message, state);
    if (fromText && (analysisRequest?.kind === 'photo' || photoReadGeneration !== null || photoBatch || photoSelectionPending)) {
      status(copy('사진 분석이 끝난 뒤 음식 메모 분석을 실행할 수 있어요. 직접 입력한 내용은 그대로 남아 있어요.', 'Text analysis can run after photo analysis finishes. Your manual entries are kept.'));
      return;
    }
    if (!providerReady(provider) || !byId('meal-dialog').open) return;
    if (sharedQuotaDay === new Date().toISOString().slice(0, 10)) {
      status(analysisError('SHARED_QUOTA', kind, provider), 'error');
      return;
    }
    cancelAnalysis();
    setText(byId(fromText ? 'food-photo-status' : 'food-text-status'), '');
    const controller = new AbortController();
    const request = { kind, controller, foodRevision, noteRevision, provider };
    analysisRequest = request;
    updateAnalysisActions();
    const isActive = () => analysisRequest === request && request.provider === aiProvider && byId('meal-dialog').open &&
      (!fromText || (request.foodRevision === foodRevision && request.noteRevision === noteRevision));
    const timeout = root.setTimeout(() => controller.abort(), 30000);
    status(fromText ? copy('입력한 음식의 칼로리를 계산하고 있어요…', 'Calculating calories from your note…')
      : copy('사진 속 음식과 양을 확인하고 있어요…', 'Identifying food and portions…'), 'loading');
    try {
      const body = fromText ? input : await photoJpeg(input);
      if (!isActive()) return;
      if (!fromText && (!body || body.type !== 'image/jpeg' || !body.size || body.size > MAX_AI_BYTES)) {
        status(analysisError('IMAGE', kind), 'error');
        return;
      }
      const url = fromText ? new URL('/meal-text/analyze', endpoint).href : endpoint.href;
      const headers = {
        Authorization: `Bearer ${photoCode}`,
        'Content-Type': fromText ? 'text/plain;charset=UTF-8' : 'image/jpeg',
        'X-AI-Provider': provider
      };
      const response = await fetch(url, {
        method: 'POST', body,
        headers,
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
      });
      const result = await response.json();
      if (!isActive()) return;
      if (response.ok) {
        insertAnalyzedFoods(result, kind, status, fromText ? { replaceTextDrafts: true } : { preserveDrafts: true, photoFingerprint: options.photoFingerprint });
        if (document.querySelector('#food-items [data-food-photo-draft], #food-items [data-food-text-draft]')) updateTextActions();
      }
      else status(analysisError(result?.code, kind, provider), 'error');
    } catch {
      if (isActive()) status(analysisError('UNAVAILABLE', kind, provider), 'error');
    } finally {
      root.clearTimeout(timeout);
      if (analysisRequest === request) {
        analysisRequest = null;
        updateAnalysisActions();
      }
    }
  }

  function analyzePhoto() {
    if (providerDraftActive) return;
    const photo = currentPhoto;
    if (photo && isCurrentGeneration(photo.generation)) {
      if (photoAlreadyIncluded(photo.fingerprint)) { showPhotoAlreadyIncluded(); return; }
      return analyze('photo', photo.preview, { photoFingerprint: photo.fingerprint });
    }
  }

  function analyzeNote() {
    if (analysisRequest?.kind === 'photo' || photoReadGeneration !== null || photoBatch || photoSelectionPending) return;
    if (providerDraftActive || !noteEdited || !providerReady() || !byId('food-text-auto')?.checked) return;
    const note = byId('meal-note').value.trim();
    if (!note) return;
    noteEdited = false;
    return analyze('text', note);
  }

  function prepareSave() {
    if (!analysisPending()) return true;
    const error = byId('meal-error');
    error.setAttribute('data-analysis-pending', '');
    setText(error, copy('음식 칼로리를 계산 중이에요. 완료될 때까지 기다리거나 분석을 중단한 뒤 저장해 주세요.', 'Calorie analysis is running. Wait for it to finish or stop analysis before saving.'));
    return false;
  }

  function clearPhoto(showStatus, invalidate, discardPhotoDrafts = false) {
    if (photoBatch) {
      photoBatch.cancelled = true;
      photoBatch.controller?.abort();
    }
    if (invalidate !== false) {
      photoSelectionGeneration += 1;
      nextTransientGeneration();
    }
    currentPhoto = null;
    if (discardPhotoDrafts) discardDrafts('photo');
    const preview = byId('food-photo-preview');
    const remove = byId('food-photo-remove');
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
      preview.alt = '';
    }
    if (remove) remove.hidden = true;
    const batchList = byId('food-photo-preview-list');
    if (batchList) {
      batchList.replaceChildren();
      batchList.hidden = true;
    }
    setPhotoBatchProgress(null, '');
    ['food-photo-file', 'food-photo-capture'].forEach((id) => {
      const control = byId(id);
      if (control) control.value = '';
    });
    if (showStatus) {
      setStatus(discardPhotoDrafts
        ? copy('사진과 자동 입력한 음식 항목을 지웠어요.', 'The photo and automatically added food items were removed.')
        : copy('사진 미리보기만 지웠어요. 이미 분석된 음식은 그대로 남아 있어요.', 'Only the photo preview was removed. Analyzed food items are still kept.'));
    }
  }

  async function showPhoto(file, generation) {
    if (!isCurrentGeneration(generation)) return;
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setStatus(copy('이미지 파일만 올릴 수 있어요.', 'Please choose an image file.'), 'error');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus(copy('사진은 12MB 이하로 올려 주세요.', 'Choose an image smaller than 12 MB.'), 'error');
      return;
    }
    if (providerReady()) {
      photoReadGeneration = generation;
      updateAnalysisActions();
    }
    const finishReading = () => {
      if (photoReadGeneration !== generation) return;
      photoReadGeneration = null;
      updateAnalysisActions();
    };
    let fingerprint = null;
    try { fingerprint = await photoByteFingerprint(file); } catch { /* Still allow a photo when local hashing is unavailable. */ }
    if (!isCurrentGeneration(generation)) return;
    if (photoAlreadyIncluded(fingerprint)) {
      finishReading();
      showPhotoAlreadyIncluded();
      return;
    }
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => {
      finishReading();
      if (isCurrentGeneration(generation)) setStatus(copy('사진을 읽지 못했어요. 다른 사진을 선택해 주세요.', 'The photo could not be read. Please choose another one.'), 'error');
    };
    reader.onload = () => {
      if (!isCurrentGeneration(generation)) return;
      const preview = byId('food-photo-preview');
      const remove = byId('food-photo-remove');
      if (!preview || typeof reader.result !== 'string') { finishReading(); return; }
      preview.src = reader.result;
      preview.alt = copy('입력한 음식 사진 미리보기', 'Selected food photo preview');
      const ready = typeof preview.decode === 'function' ? preview.decode() : Promise.resolve();
      ready.then(() => {
        if (!isCurrentGeneration(generation)) return;
        finishReading();
        preview.hidden = false;
        if (remove) remove.hidden = false;
        currentPhoto = { preview, generation, fingerprint };
        if (!providerDraftActive && providerReady()) analyzePhoto();
        else setStatus(endpoint
          ? copy('연결하면 선택한 사진에서 음식을 자동으로 채워요.', 'Connect to fill in food from the selected photo.')
          : copy('사진은 이 입력 화면에서만 참고용으로 사용돼요. 음식과 칼로리를 확인해 주세요.', 'This photo is temporary reference only. Please confirm the food and calories.'));
      }).catch(() => {
        if (!isCurrentGeneration(generation)) return;
        finishReading();
        clearPhoto(false, false, false);
        setStatus(copy('사진을 표시하지 못했어요. 다른 사진을 선택해 주세요.', 'The photo could not be displayed. Please choose another one.'), 'error');
      });
    };
    reader.readAsDataURL(file);
  }

  function selectPhoto(file) {
    photoSelectionGeneration += 1;
    const generation = nextTransientGeneration();
    cancelAnalysis();
    stopCamera(false);
    clearPhoto(false, false, false);
    showPhoto(file, generation);
  }

  async function photoByteFingerprint(file) {
    if (typeof file?.arrayBuffer !== 'function') return null;
    const bytes = await file.arrayBuffer();
    if (!root.crypto?.subtle) return null;
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function photoAlreadyIncluded(fingerprint) {
    return Boolean(fingerprint && [...document.querySelectorAll('#food-items [data-food-photo-fingerprint]')]
      .some(row => row.dataset.foodPhotoFingerprint === fingerprint));
  }

  function showPhotoAlreadyIncluded() {
    setStatus(copy('이미 반영한 사진은 제외했어요. 다시 분석하려면 해당 사진의 음식 항목을 먼저 삭제해 주세요.',
      'Photos already included were skipped. Remove their food items first to analyze them again.'));
  }

  async function uniquePhotoFiles(files, selectionGeneration) {
    const hashes = new Set();
    const unique = [];
    const fingerprints = [];
    let duplicates = 0;
    let hashUnavailable = 0;
    for (const file of files) {
      if (selectionGeneration !== photoSelectionGeneration) return null;
      let hash = null;
      try {
        hash = await photoByteFingerprint(file);
        if (selectionGeneration !== photoSelectionGeneration) return null;
        if (hash && (hashes.has(hash) || photoAlreadyIncluded(hash))) { duplicates += 1; continue; }
        if (hash) hashes.add(hash);
        else hashUnavailable += 1;
      } catch {
        // A failed local hash never justifies dropping a user-selected photo.
        hashUnavailable += 1;
      }
      unique.push(file);
      fingerprints.push(hash);
    }
    return { unique, fingerprints, duplicates, hashUnavailable };
  }

  function readBatchPhoto(file, batch, index) {
    return new Promise((resolve) => {
      if (!batchIsActive(batch)) { resolve(null); return; }
      if (!String(file?.type || '').startsWith('image/') || file.size > MAX_IMAGE_BYTES) { resolve({ error: 'IMAGE' }); return; }
      const reader = new FileReader();
      reader.onerror = reader.onabort = () => resolve({ error: 'IMAGE' });
      reader.onload = () => {
        if (!batchIsActive(batch) || typeof reader.result !== 'string') { resolve(null); return; }
        const image = new Image();
        image.onload = () => {
          if (!batchIsActive(batch)) { resolve(null); return; }
          let thumbnail = '';
          try { thumbnail = photoThumbnail(image); } catch { thumbnail = ''; }
          if (!thumbnail) { resolve({ error: 'IMAGE' }); return; }
          const preview = byId('food-photo-preview');
          if (preview) {
            preview.src = thumbnail;
            preview.alt = copy(`음식 사진 ${index + 1}`, `Food photo ${index + 1}`);
            preview.hidden = false;
          }
          const remove = byId('food-photo-remove');
          if (remove) remove.hidden = false;
          setPhotoBatchItem(batch, index, 'analyzing', copy(`사진 ${index + 1} 분석 중`, `Analyzing photo ${index + 1}`), thumbnail);
          resolve({ image, src: thumbnail });
        };
        image.onerror = () => resolve({ error: 'IMAGE' });
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function emitPhotoBatchEvent(name, detail) {
    root.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function photoBatchSummary(batch) {
    return {
      batchId: batch.id, provider: batch.provider, selected: batch.selected, total: batch.files.length,
      analyzed: batch.analyzed, succeeded: batch.succeeded, failed: batch.failed, unresolved: batch.unresolved,
      inserted: batch.inserted, duplicates: batch.duplicates, limited: batch.limited,
      hashUnavailable: batch.hashUnavailable,
      unmatchedNames: batch.unmatchedNames.slice(),
      cancelled: batch.cancelled, blocked: batch.blocked,
      complete: !batch.cancelled && !batch.blocked && !batch.duplicates && !batch.hashUnavailable && !batch.limited &&
        batch.files.length >= 2 && batch.analyzed === batch.files.length && batch.succeeded === batch.files.length &&
        batch.failed === 0 && batch.unresolved === 0 && batch.inserted > 0
    };
  }

  function finishPhotoBatch(batch) {
    if (photoBatch !== batch) return;
    photoBatch = null;
    setPhotoBatchProgress(photoSelectionPending, photoSelectionPending?.message || '');
    updateAnalysisActions();
    const summary = photoBatchSummary(batch);
    const partial = summary.failed || summary.unresolved || summary.duplicates || summary.hashUnavailable || summary.limited || summary.blocked;
    const unprocessed = Math.max(0, summary.total - summary.analyzed);
    const duplicateNotice = summary.duplicates
      ? copy(` 같은 사진 ${summary.duplicates}장은 제외했어요.`, ` ${summary.duplicates} identical photo(s) were excluded.`) : '';
    const hashNotice = summary.hashUnavailable
      ? copy(' 일부 사진은 중복 확인을 할 수 없었어요. 같은 사진이 있다면 결과를 확인해 주세요.', ' Some photos could not be checked for duplicates. Review the result if the same photo was selected.') : '';
    const unmatchedNotice = summary.unmatchedNames.length
      ? copy(` 직접 칼로리를 입력할 음식: ${summary.unmatchedNames.slice(0, 3).join(', ')}.`, ` Enter calories manually for: ${summary.unmatchedNames.slice(0, 3).join(', ')}.`) : '';
    const amountNotice = batch.needsAmount
      ? copy(' 음식은 찾았지만 사진만으로 양을 확인할 수 없어 총 칼로리를 입력해 주세요.', ' Food was found, but the portion cannot be confirmed from the photo. Enter the total calories.') : '';
    const dishNotice = copy(' 같은 접시를 여러 장 찍었다면 중복 음식은 삭제해 주세요.', ' If the same plate appears in multiple photos, remove duplicate foods.');
    if (summary.cancelled) {
      setStatus(copy(`사진 분석을 중단했어요. ${summary.succeeded}장 완료, ${unprocessed}장은 분석하지 않았고 완료된 결과와 합계는 남아 있어요.`, `Photo analysis stopped. ${summary.succeeded} completed and ${unprocessed} were not analyzed; completed results and totals are kept.`) + duplicateNotice + hashNotice + unmatchedNotice + amountNotice + dishNotice, 'error');
    } else if (partial) {
      const reason = batch.blockedMessage ? ` ${batch.blockedMessage}` : '';
      setStatus(copy(`사진 ${summary.analyzed}/${summary.total}장을 분석해 ${summary.succeeded}장을 반영했어요. 실패·미분석·확인 필요 사진을 확인한 뒤 저장을 눌러 주세요.`, `Analyzed ${summary.analyzed}/${summary.total} photos and added ${summary.succeeded}. Review failed, unprocessed, or incomplete photos, then save the meal.`) + reason + duplicateNotice + hashNotice + unmatchedNotice + amountNotice + dishNotice, 'error');
    } else {
      setStatus(copy(`${summary.succeeded}장 사진의 음식과 총 칼로리를 반영했어요. 결과를 확인한 뒤 저장을 눌러 주세요.`, `Food and total calories from ${summary.succeeded} photos are ready. Review the result, then save the meal.`) + amountNotice + dishNotice);
    }
    // Completion permits UI feedback only. A meal is never saved without the
    // user's explicit Record save action.
    emitPhotoBatchEvent('meal:photo-analysis-complete', summary);
  }

  async function runPhotoBatch(batch) {
    try {
      for (let index = 0; index < batch.files.length; index += 1) {
        if (!batchIsActive(batch)) break;
        if (rowCount() >= MAX_FOODS) {
          batch.blocked = true;
          batch.unresolved += batch.files.length - index;
          break;
        }
        const step = await readBatchPhoto(batch.files[index], batch, index);
        if (!batchIsActive(batch)) break;
        if (!step?.image) {
          batch.analyzed += 1;
          batch.failed += 1;
          setPhotoBatchItem(batch, index, 'error', copy(`사진 ${index + 1}을 읽지 못했어요`, `Could not read photo ${index + 1}`));
          setPhotoBatchProgress(batch, copy(`${index + 1}/${batch.files.length}장 확인 중`, `Checking ${index + 1}/${batch.files.length}`));
          continue;
        }
        const body = await photoJpeg(step.image);
        if (!batchIsActive(batch)) break;
        if (!body || body.type !== 'image/jpeg' || !body.size || body.size > MAX_AI_BYTES) {
          batch.analyzed += 1;
          batch.failed += 1;
          setPhotoBatchItem(batch, index, 'error', copy(`사진 ${index + 1}을 분석할 수 없어요`, `Could not analyze photo ${index + 1}`), step.src);
          continue;
        }
        const controller = new AbortController();
        batch.controller = controller;
        const timeout = root.setTimeout(() => controller.abort(), 30000);
        try {
          const response = await fetch(endpoint.href, {
            method: 'POST', body,
            headers: { Authorization: `Bearer ${photoCode}`, 'Content-Type': 'image/jpeg', 'X-AI-Provider': batch.provider },
            credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
          });
          let result = null;
          try { result = await response.json(); } catch { result = { code: 'UNAVAILABLE' }; }
          if (!batchIsActive(batch)) break;
          batch.analyzed += 1;
          if (!response.ok) {
            batch.failed += 1;
            const code = result?.code || (response.status === 429 ? 'QUOTA' : 'UNAVAILABLE');
            setPhotoBatchItem(batch, index, 'error', copy(`사진 ${index + 1} 분석 실패`, `Photo ${index + 1} failed`), step.src);
            // Only the Worker’s documented per-photo failures may continue.
            // Unknown non-2xx responses can mean an upstream or quota fault,
            // so stop before spending more shared free requests.
            if ((response.status === 422 && code === 'NO_FOOD') || (response.status === 400 && code === 'IMAGE')) continue;
            batch.blocked = true;
            batch.blockedMessage = analysisError(code, 'photo', batch.provider);
            break;
          }
          const photoFingerprint = batch.fingerprints[index];
          const outcome = insertAnalyzedFoods(result, 'photo', () => {}, { preserveDrafts: true, photoSource: index + 1, photoFingerprint });
          // Keep names that the model saw but could not price. They are
          // deliberately incomplete AI drafts, so the user can fill a total
          // calorie value instead of losing the recognition result.
          outcome.unmatchedNames.forEach((name) => {
            if (rowCount() >= MAX_FOODS) return;
            addRow({ name, photoDraft: true, photoSource: index + 1, photoFingerprint });
          });
          if (outcome.unmatchedNames.length) updateTotal();
          outcome.unmatchedNames.forEach((name) => {
            if (!batch.unmatchedNames.includes(name)) batch.unmatchedNames.push(name);
          });
          batch.inserted += outcome.inserted;
          batch.unresolved += outcome.unresolved + outcome.needsManual + (outcome.overflow ? 1 : 0);
          batch.needsAmount += outcome.needsAmount || 0;
          if (outcome.inserted > 0) batch.succeeded += 1;
          else batch.failed += 1;
          const review = outcome.unresolved || outcome.needsManual || outcome.overflow;
          setPhotoBatchItem(batch, index, review ? 'error' : 'done', review
            ? copy(`사진 ${index + 1} 확인 필요`, `Photo ${index + 1} needs review`)
            : copy(`사진 ${index + 1} 완료`, `Photo ${index + 1} complete`), step.src);
        } catch {
          if (!batchIsActive(batch)) break;
          batch.analyzed += 1;
          batch.failed += 1;
          setPhotoBatchItem(batch, index, 'error', copy(`사진 ${index + 1} 분석 실패`, `Photo ${index + 1} failed`), step.src);
          batch.blocked = true;
          batch.blockedMessage = analysisError('UNAVAILABLE', 'photo', batch.provider);
        } finally {
          root.clearTimeout(timeout);
          if (photoBatch === batch) batch.controller = null;
        }
        if (batchIsActive(batch)) setPhotoBatchProgress(batch, copy(`${batch.analyzed}/${batch.files.length}장 분석 · 완료 ${batch.succeeded} · 실패 ${batch.failed}`, `${batch.analyzed}/${batch.files.length} analyzed · ${batch.succeeded} complete · ${batch.failed} failed`));
      }
    } finally {
      finishPhotoBatch(batch);
    }
  }

  async function selectPhotos(fileList) {
    const selectedFiles = Array.from(fileList || []).filter(Boolean);
    if (selectedFiles.length <= 1) { selectPhoto(selectedFiles[0]); return; }
    if (selectedFiles.length > MAX_PHOTO_BATCH) {
      setStatus(copy(`한 번에 ${MAX_PHOTO_BATCH}장까지 분석할 수 있어요. 사진 수를 줄여 다시 선택해 주세요.`, `You can analyze up to ${MAX_PHOTO_BATCH} photos at once. Select fewer photos and try again.`), 'error');
      return;
    }
    const totalBytes = selectedFiles.reduce((total, file) => total + Math.max(0, Number(file.size) || 0), 0);
    if (totalBytes > MAX_PHOTO_BATCH_BYTES) {
      setStatus(copy(`선택한 사진이 너무 커요. 합계 ${Math.round(MAX_PHOTO_BATCH_BYTES / 1024 / 1024)}MB 이하로 줄여 다시 선택해 주세요.`, `The selected photos are too large. Keep the total under ${Math.round(MAX_PHOTO_BATCH_BYTES / 1024 / 1024)} MB and try again.`), 'error');
      return;
    }
    if (providerDraftActive || !providerReady()) {
      setStatus(copy(`${selectedFiles.length}장 사진은 아직 분석하지 않았어요. AI 연결을 확인한 뒤 다시 선택해 주세요.`, `${selectedFiles.length} photos were not analyzed. Check the AI connection, then select them again.`), 'error');
      return;
    }
    // A new batch also supersedes a single photo whose local hash/decode is
    // still pending; its late callback must not cancel this preparation.
    nextTransientGeneration();
    const selectionGeneration = ++photoSelectionGeneration;
    const preparation = { selectionGeneration, provider: aiProvider, cancelled: false,
      message: copy('사진 중복을 확인하고 있어요…', 'Checking selected photos for duplicates…') };
    photoSelectionPending = preparation;
    setPhotoBatchProgress(preparation, preparation.message);
    updateAnalysisActions();
    const selection = await uniquePhotoFiles(selectedFiles, selectionGeneration);
    if (photoSelectionPending !== preparation || preparation.cancelled || !selection || selectionGeneration !== photoSelectionGeneration ||
      !byId('meal-dialog')?.open || providerDraftActive || aiProvider !== preparation.provider || !providerReady(preparation.provider)) {
      if (photoSelectionPending === preparation) {
        photoSelectionPending = null;
        setPhotoBatchProgress(null, '');
        updateAnalysisActions();
      }
      return;
    }
    photoSelectionPending = null;
    setPhotoBatchProgress(null, '');
    updateAnalysisActions();
    const files = selection.unique;
    if (!files.length) { showPhotoAlreadyIncluded(); return; }
    const generation = nextTransientGeneration();
    stopCamera(false);
    clearPhoto(false, false, false);
    const batch = {
      id: `photo-batch-${Date.now()}-${generation}`,
      generation, files, fingerprints: selection.fingerprints, selected: selectedFiles.length,
      duplicates: selection.duplicates,
      hashUnavailable: selection.hashUnavailable,
      limited: 0,
      analyzed: 0, succeeded: 0, failed: 0, unresolved: 0, inserted: 0, needsAmount: 0,
      cancelled: false, blocked: false, blockedMessage: '', controller: null, provider: aiProvider,
      unmatchedNames: []
    };
    photoBatch = batch;
    byId('food-summary')?.setAttribute('data-multi-photo-summary', '');
    positionFoodSummary();
    renderPhotoBatch(batch);
    setPhotoBatchProgress(batch, copy(`${files.length}장 사진을 차례로 분석해요.`, `Analyzing ${files.length} photos one at a time.`));
    if (batch.duplicates) {
      setStatus(copy(`같은 사진 ${batch.duplicates}장은 중복으로 제외했어요. 나머지 사진을 분석해요.`, `${batch.duplicates} identical photo(s) were excluded. Analyzing the rest.`));
    }
    updateAnalysisActions();
    emitPhotoBatchEvent('meal:photo-analysis-start', { batchId: batch.id, selected: batch.selected, total: files.length, provider: batch.provider });
    runPhotoBatch(batch);
  }

  function stopCamera(showStatus) {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    const video = byId('food-camera-video');
    if (video) {
      video.pause();
      video.srcObject = null;
      video.hidden = true;
    }
    const actions = byId('food-camera-actions');
    if (actions) actions.hidden = true;
    const camera = byId('food-camera');
    if (camera) camera.disabled = false;
    if (showStatus) setStatus(copy('카메라를 껐어요.', 'Camera stopped.'));
  }

  async function startCamera() {
    stopQrScan();
    if (isMobileDevice()) {
      const capture = byId('food-photo-capture');
      if (capture) {
        setStatus(copy('카메라를 열어 사진을 선택해 주세요.', 'Open the camera and choose a photo.'));
        capture.click();
        return;
      }
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus(copy('이 기기에서는 카메라 미리보기를 사용할 수 없어요. 사진 선택을 이용해 주세요.', 'Camera preview is not available here. Please choose a photo instead.'), 'error');
      return;
    }
    const generation = nextTransientGeneration();
    try {
      stopCamera(false);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!isCurrentGeneration(generation) || !byId('meal-dialog').open) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream = stream;
      const video = byId('food-camera-video');
      if (!video) {
        stopCamera(false);
        return;
      }
      video.srcObject = cameraStream;
      video.hidden = false;
      const actions = byId('food-camera-actions');
      if (actions) actions.hidden = false;
      const camera = byId('food-camera');
      if (camera) camera.disabled = true;
      await video.play();
      if (!isCurrentGeneration(generation) || cameraStream !== stream || !byId('meal-dialog').open) {
        if (cameraStream === stream) stopCamera(false);
        return;
      }
      setStatus(copy('카메라가 켜졌어요. 사진 찍기를 눌러 주세요.', 'Camera is on. Tap Take photo when ready.'));
    } catch (_error) {
      if (isCurrentGeneration(generation) && byId('meal-dialog').open) {
        stopCamera(false);
        setStatus(copy('카메라를 사용할 수 없어요. 권한을 확인하거나 사진 선택을 이용해 주세요.', 'Camera is unavailable. Check permission or choose a photo instead.'), 'error');
      }
    }
  }

  function snapshotCamera() {
    const video = byId('food-camera-video');
    if (!cameraStream || !video || !video.videoWidth || !video.videoHeight) {
      setStatus(copy('카메라 화면이 준비된 뒤 다시 눌러 주세요.', 'Wait for the camera preview, then try again.'), 'error');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const generation = nextTransientGeneration();
    canvas.toBlob((blob) => {
      if (!isCurrentGeneration(generation)) return;
      if (!blob) {
        setStatus(copy('사진을 만들지 못했어요. 다시 시도해 주세요.', 'The photo could not be created. Please try again.'), 'error');
        return;
      }
      showPhoto(new File([blob], 'meal-camera.jpg', { type: 'image/jpeg' }), generation);
      stopCamera(false);
    }, 'image/jpeg', 0.9);
  }

  function clearFoodValidation(control) {
    if (!control.hasAttribute('data-food-invalid')) return;
    control.removeAttribute('data-food-invalid');
    control.removeAttribute('aria-invalid');
    const described = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'meal-error');
    if (described.length) control.setAttribute('aria-describedby', described.join(' '));
    else control.removeAttribute('aria-describedby');
    const error = byId('meal-error');
    if (error?.hasAttribute('data-food-validation')) {
      error.removeAttribute('data-food-validation');
      error.textContent = '';
    }
  }

  function invalidFood(control, message) {
    control.setAttribute('data-food-invalid', '');
    control.setAttribute('aria-invalid', 'true');
    const described = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    described.add('meal-error');
    control.setAttribute('aria-describedby', [...described].join(' '));
    const error = byId('meal-error');
    if (error) { error.setAttribute('data-food-validation', ''); error.textContent = message; }
    control.focus();
    throw new Error(message);
  }

  function draftSignature() {
    const rows = [...document.querySelectorAll('#food-items [data-food-row]')].map(row => ({
      values: ['name', 'kcal', 'grams', 'density'].map(key => row.querySelector(`[data-food-${key}]`)?.value || ''),
      photoDraft: row.hasAttribute('data-food-photo-draft'), textDraft: row.hasAttribute('data-food-text-draft'),
      review: row.hasAttribute('data-food-review'), photo: row.dataset.foodPhotoFingerprint || ''
    }));
    const preview = byId('food-photo-preview');
    const photos = [...document.querySelectorAll('#food-photo-preview-list [data-photo-index]')].map(item => ({
      state: item.dataset.photoState || '', image: item.querySelector('img')?.getAttribute('src') || ''
    }));
    return JSON.stringify({ rows, photo: preview && !preview.hidden ? currentPhoto?.fingerprint || preview.getAttribute('src') || '' : '', photos });
  }

  function read(options = {}) {
    const foods = [];
    const rows = document.querySelectorAll('#food-items [data-food-row]');
    document.querySelectorAll('#food-items [data-food-invalid]').forEach(clearFoodValidation);
    for (const row of rows) {
      const nameControl = row.querySelector('[data-food-name]');
      const kcalControl = row.querySelector('[data-food-kcal]');
      const name = nameControl.value.trim();
      const gramsRaw = row.querySelector('[data-food-grams]').value.trim();
      const kcalRaw = kcalControl.value.trim();
      const densityRaw = row.querySelector('[data-food-density]').value.trim();
      if (kcalControl.validity.badInput) invalidFood(kcalControl, copy('총 칼로리는 0~20,000 kcal 사이의 숫자로 입력해 주세요.', 'Enter total calories as a number from 0 to 20,000 kcal.'));
      if (row.hasAttribute('data-food-review') && !name) invalidFood(nameControl, copy('메뉴에 국·찌개 이름을 입력하거나 해당 음식 칸을 삭제해 주세요.', 'Enter the soup or stew name in Menu, or remove that row.'));
      if (!name && !gramsRaw && !kcalRaw && !densityRaw) continue;
      if (!name) invalidFood(nameControl, copy('메뉴를 입력해 주세요.', 'Enter a menu name.'));
      if (name.length > 100) invalidFood(nameControl, copy('메뉴 이름은 100자 이내로 입력해 주세요.', 'Enter a menu name of 100 characters or fewer.'));
      const grams = finiteNumber(gramsRaw);
      const kcal = finiteNumber(kcalRaw);
      const density = finiteNumber(densityRaw);
      if (kcalRaw === '') invalidFood(kcalControl, copy('총 칼로리를 입력해 주세요. 0~20,000 kcal까지 입력할 수 있어요.', 'Enter total calories, from 0 to 20,000 kcal.'));
      if (!Number.isFinite(kcal) || kcal < 0 || kcal > MAX_KCAL) invalidFood(kcalControl, copy('총 칼로리는 0~20,000 kcal 사이의 숫자로 입력해 주세요.', 'Enter total calories as a number from 0 to 20,000 kcal.'));
      if ((gramsRaw !== '' && (!Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS)) || (densityRaw !== '' && (!Number.isFinite(density) || density < 0 || density > MAX_DENSITY))) {
        invalidFood(nameControl, copy('음식의 양 정보가 올바르지 않아요. 메뉴를 다시 입력해 주세요.', 'The saved portion data is invalid. Re-enter the menu name.'));
      }
      const item = { name, kcal };
      if (gramsRaw !== '') item.grams = grams;
      foods.push(item);
    }
    // A result drafted by AI stays editable until the user deliberately uses
    // the form's Save button.  This makes saving the explicit confirmation;
    // automatic analysis never records a meal by itself.
    if (!options.confirmAnalysis && document.querySelector('#food-items [data-food-photo-draft], #food-items [data-food-text-draft]')) {
      throw new Error(copy('AI 계산 결과를 확인한 뒤 저장을 눌러 주세요.', 'Review the AI result, then use Save.'));
    }
    const core = root.FastingCore;
    return core && typeof core.normalizeFoods === 'function' ? core.normalizeFoods(foods) : foods;
  }

  function open(foods, expanded, events) {
    initialize();
    const container = byId('food-items');
    if (!container) return;
    nextTransientGeneration();
    noteEdited = false;
    foodRevision += 1;
    noteRevision += 1;
    skipNextNoteAnalysisRevision = null;
    // Both manual fields are immediately editable, even for one menu whose
    // name matches the optional AI description above.
    manualNamesVisible = true;
    byId('food-summary')?.removeAttribute('data-multi-photo-summary');
    positionFoodSummary();
    setText(byId('food-text-status'), '');
    stopCamera(false);
    clearPhoto(false, false);
    setStatus('');
    container.replaceChildren();
    const source = Array.isArray(foods) ? foods : [];
    source.slice(0, MAX_FOODS).forEach((food) => addRow(food));
    if (source.length === 0) addRow();
    showRecentFoods(events);
    updateTextActions();
    updateTotal();
  }

  function initialize() {
    if (initialized || !byId('food-items')) return;
    initialized = true;
    endpoint = photoEndpoint();
    if (endpoint) {
      const settings = byId('settings-food-ai');
      if (settings) settings.hidden = false;
      const settingsOpen = byId('settings-food-ai-open');
      if (settingsOpen) settingsOpen.hidden = false;
      const panel = byId('food-ai-panel');
      if (panel) panel.hidden = false;
      try { aiProvider = normalizeProvider(root.localStorage.getItem(AI_PROVIDER_KEY)); } catch { aiProvider = 'cloudflare'; }
      savedProvider = aiProvider;
      byId('food-ai-provider')?.addEventListener('change', (event) => {
        setAiProvider(event.currentTarget.value);
      });
      let saved = '';
      try { saved = root.localStorage.getItem(codeKey()) || ''; } catch { /* optional persistence */ }
      setPhotoCode(CODE_PATTERN.test(saved) ? saved : '');
      const textAuto = byId('food-text-auto');
      if (textAuto) {
        byId('food-quota-check')?.addEventListener('click', async event => {
          const output = byId('food-quota-status');
          if (!photoCode) {
            root.dispatchEvent(new CustomEvent('meal:ai-settings'));
            setText(output, copy('먼저 AI 연결 코드를 등록해 주세요.', 'Connect your AI access code first.'));
            return;
          }
          const button = event.currentTarget, code = photoCode, provider = aiProvider;
          const controller = new AbortController();
          const timeout = root.setTimeout(() => controller.abort(), 10000);
          button.disabled = true;
          setText(output, copy('공유 한도를 확인하고 있어요…', 'Checking the shared limit…'));
          try {
            const response = await fetch(new URL('/meal-ai/quota', endpoint).href, { headers: { Authorization: `Bearer ${code}`, 'X-AI-Provider': provider }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
            if (!response.ok) throw new Error('Unavailable');
            const quota = await response.json();
            if (!Number.isInteger(quota.remaining) || !Number.isInteger(quota.dailyLimit) || quota.remaining < 0 || quota.remaining > quota.dailyLimit || quota.dailyLimit > 100000 || quota.shared !== true || !Number.isFinite(Date.parse(quota.resetsAtUtc))) throw new Error('Invalid response');
            if (photoCode !== code || aiProvider !== provider) return;
            const reset = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(quota.resetsAtUtc));
            setText(output, copy(`Cloudflare 중계 서버 공통 한도 ${quota.remaining}/${quota.dailyLimit}회 · UTC 초기화 ${reset}. 공급자별 실제 사용 가능 횟수는 다를 수 있어요.`, `Cloudflare relay shared limit ${quota.remaining}/${quota.dailyLimit} · UTC reset ${reset}. Actual provider availability may differ.`));
          } catch (_) {
            if (photoCode === code && aiProvider === provider) setText(output, copy('지금은 남은 횟수를 확인할 수 없어요. 음식은 직접 기록할 수 있어요.', 'Remaining analyses are unavailable. You can still log food manually.'));
          } finally { root.clearTimeout(timeout); button.disabled = false; }
        });
        byId('food-text-calculate')?.addEventListener('click', () => {
          if (analysisPending()) return;
          const note = byId('meal-note').value.trim();
          if (!note) { setText(byId('food-text-status'), copy('음식 이름과 양을 입력해 주세요.', 'Enter a food and portion.')); byId('meal-note').focus(); return; }
          if (!photoCode) {
            setText(byId('food-text-status'), copy('상단 설정에서 AI를 연결해 주세요.', 'Connect AI in the top Settings menu.'));
            return;
          }
          if (analysisRequest?.kind === 'text') return;
          noteEdited = false;
          analyze('text', note);
        });
        try {
          const stored = root.localStorage.getItem(TEXT_AUTO_KEY);
          textAuto.checked = stored !== '0';
        } catch { textAuto.checked = true; }
        savedTextAuto = textAuto.checked;
        textAuto.addEventListener('change', () => {
          if (!providerDraftActive) {
            savedTextAuto = textAuto.checked;
            try { root.localStorage.setItem(TEXT_AUTO_KEY, textAuto.checked ? '1' : '0'); } catch { /* optional persistence */ }
          }
          updateTextActions();
          if (providerDraftActive) {
            if (analysisRequest?.kind === 'text') cancelAnalysis();
            return;
          }
          if (textAuto.checked) analyzeNote();
          else if (analysisRequest?.kind === 'text') cancelAnalysis();
        });
        updateTextActions();
      }
      const qrInput = byId('food-ai-qr-file');
      const qrButton = byId('food-ai-scan');
      if (qrInput && qrButton && typeof root.jsQR === 'function') {
        qrButton.hidden = false;
        qrButton.addEventListener('click', () => startQrScan(qrInput, qrButton));
        const qrPhoto = byId('food-ai-qr-photo');
        if (qrPhoto) {
          qrPhoto.hidden = false;
          qrPhoto.addEventListener('click', () => { stopQrScan(); qrInput.click(); });
        }
        byId('food-ai-qr-stop')?.addEventListener('click', stopQrScan);
        qrInput.addEventListener('change', () => {
          const file = qrInput.files?.[0];
          qrInput.value = '';
          if (file) scanPhotoPairQr(file);
        });
      }
      if (document.readyState === 'complete') consumePhotoPairLink();
      else document.addEventListener('DOMContentLoaded', consumePhotoPairLink, { once: true });
      root.addEventListener('hashchange', consumePhotoPairLink);
      const codeInput = byId('food-ai-code');
      const connect = () => {
        const code = codeInput.value.trim();
        if (!CODE_PATTERN.test(code)) {
          setConnectionStatus(copy('사진 분석 연결 코드를 다시 확인해 주세요.', 'Check your photo analysis access code.'), 'error');
          return;
        }
        setPhotoCode(code);
        setConnectionStatus(accessCodeSavedMessage());
        if (!providerDraftActive) analyzePhoto();
      };
      byId('food-ai-connect')?.addEventListener('click', connect);
      codeInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); connect(); }
      });
      byId('food-ai-disconnect')?.addEventListener('click', () => {
        cancelAnalysis();
        setPhotoCode('');
        setConnectionStatus(copy('사진 분석을 껐어요. 음식은 직접 입력할 수 있어요.', 'Photo analysis is off. You can still enter food manually.'));
      });
    }
    root.addEventListener('dansik:language-changed', () => {
      updateProviderUi();
      updateTextActions();
    });
    const note = byId('meal-note');
    if (note) {
      let recentPointerId = null;
      const hideRecentAfterBlur = () => {
        const slot = byId('food-recent-slot');
        if (slot && document.activeElement !== note && !slot.contains(document.activeElement)) slot.hidden = true;
      };
      document.addEventListener('pointerdown', event => {
        if (document.activeElement === note && !note.contains(event.target)) recentPointerId = event.pointerId;
      }, true);
      const finishRecentPointer = event => {
        if (event.pointerId !== recentPointerId) return;
        recentPointerId = null;
        // Hiding suggestions between pointerdown and click moves the action
        // button away from the pointer. Collapse only after activation ends.
        root.setTimeout(hideRecentAfterBlur, 0);
      };
      document.addEventListener('pointerup', finishRecentPointer, true);
      document.addEventListener('pointercancel', finishRecentPointer, true);
      note.addEventListener('input', () => {
        noteRevision += 1;
        // A chip only suppresses the blur caused by that exact selection.
        if (skipNextNoteAnalysisRevision !== null && skipNextNoteAnalysisRevision !== noteRevision) skipNextNoteAnalysisRevision = null;
        noteEdited = true;
        if (analysisRequest?.kind === 'text') cancelAnalysis();
        discardDrafts('text');
        syncNoteDefaultNames();
        if (photoCode) setText(byId('food-text-status'), '');
      });
      note.addEventListener('focus', () => { const slot = byId('food-recent-slot'); if (slot?.children.length) slot.hidden = false; });
      note.addEventListener('blur', () => {
        const blurRevision = noteRevision;
        root.setTimeout(() => {
          const slot = byId('food-recent-slot');
          if (slot?.contains(document.activeElement)) return;
          if (recentPointerId === null) hideRecentAfterBlur();
          if (skipNextNoteAnalysisRevision === blurRevision) { skipNextNoteAnalysisRevision = null; return; }
          if (skipNextNoteAnalysisRevision !== null) skipNextNoteAnalysisRevision = null;
          analyzeNote();
        }, 0);
      });
      note.addEventListener('keydown', (event) => {
        const auto = byId('food-text-auto');
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && auto?.checked && !auto.disabled) {
          event.preventDefault();
          analyzeNote();
        }
      });
    }
    const add = byId('food-add');
    if (add) add.addEventListener('click', () => {
      showMenuNames();
      reviseFoods();
      addRow({})?.querySelector('[data-food-name]').focus();
    });
    byId('food-name-edit')?.addEventListener('click', () => {
      showMenuNames();
      byId('food-items')?.querySelector('[data-food-name]')?.focus();
    });
    byId('food-photo-pick')?.addEventListener('click', () => byId('food-photo-file')?.click());
    ['food-photo-file', 'food-photo-capture'].forEach((id) => {
      const picker = byId(id);
      if (!picker) return;
      if (id === 'food-photo-file') picker.multiple = true;
      picker.addEventListener('change', () => {
        if (id === 'food-photo-file') selectPhotos(picker.files);
        else selectPhoto(picker.files && picker.files[0]);
      });
    });
    const camera = byId('food-camera');
    if (camera) camera.addEventListener('click', startCamera);
    const snap = byId('food-camera-snap');
    if (snap) snap.addEventListener('click', snapshotCamera);
    const stop = byId('food-camera-stop');
    if (stop) stop.addEventListener('click', () => { nextTransientGeneration(); stopCamera(true); });
    const remove = byId('food-photo-remove');
    if (remove) remove.addEventListener('click', () => clearPhoto(true));
    byId('food-photo-analysis-cancel')?.addEventListener('click', () => {
      if (photoBatch || photoSelectionPending) cancelAnalysis();
    });
    byId('meal-analysis-stop')?.addEventListener('click', () => {
      noteEdited = false;
      nextTransientGeneration();
      setStatus(copy('분석을 중단했어요. 직접 입력한 내용은 저장할 수 있어요.', 'Analysis stopped. You can save the entries you added.'));
      byId('save-meal').focus({ preventScroll: true });
    });
    const dialog = byId('meal-dialog');
    if (dialog) dialog.addEventListener('close', () => {
      if (dialog.open) return; // Ignore a queued close from the previous draft.
      cancelAnalysis(); nextTransientGeneration(); stopCamera(false); clearPhoto(false, false);
    });
    byId('settings-dialog')?.addEventListener('close', stopQrScan);
    root.addEventListener('beforeunload', () => { cancelAnalysis(); nextTransientGeneration(); stopCamera(false); }, { once: true });
    root.addEventListener('pagehide', stopQrScan);
  }

  root.MealFoods = { open, read, prepareSave, draftSignature, hasPendingAnalysis: analysisPending, recentFoods, beginProviderDraft, commitProviderDraft, revertProviderDraft };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}(window));
