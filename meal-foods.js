/* Food entry, photo analysis, and pairing. The caller saves meal data returned by read(). */
(function mealFoodsModule(root) {
  'use strict';

  const MAX_FOODS = 24;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_KCAL = 20000;
  const MAX_GRAMS = 10000;
  const MAX_DENSITY = 20000;
  const MAX_AI_BYTES = 1024 * 1024;
  const CODE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
  const PAIR_LINK = 'https://mirsys1.github.io/dansik-pwa/#photo-connect=';
  const TEXT_AUTO_KEY = 'dansik:meal-text-auto:v1';
  let cameraStream = null;
  let initialized = false;
  let transientGeneration = 0;
  let currentPhoto = null;
  let analysisRequest = null;
  let photoReadGeneration = null;
  let noteEdited = false;
  let endpoint = null;
  let photoCode = '';
  let quotaDay = '';
  let qrSession = null;
  // A text-analysis response is only allowed to change rows from the revision
  // it started with.  Direct edits always win over a delayed suggestion.
  let foodRevision = 0;
  let noteRevision = 0;
  let skipNextNoteAnalysisRevision = null;
  let manualNamesVisible = false;

  const byId = (id) => document.getElementById(id);
  const isEnglish = () => String(document.documentElement.lang || '').toLowerCase().startsWith('en');
  const copy = (korean, english) => (isEnglish() ? english : korean);
  const valueOrEmpty = (value) => value === undefined || value === null ? '' : String(value);

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

  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function setStatus(message) {
    setText(byId('food-photo-status'), message);
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
    const formatted = roundKcal(total).toLocaleString(isEnglish() ? 'en-US' : 'ko-KR', { maximumFractionDigits: 1 });
    const message = needsCorrection
      ? (calculated ? copy(`계산된 합계 ${formatted} kcal · 입력 확인 필요`, `Calculated subtotal ${formatted} kcal · review needed`)
        : copy('음식 이름과 칼로리를 확인하면 합계가 표시돼요.', 'Enter a food name and calories to show the total.'))
      : (calculated ? copy(`합계 ${formatted} kcal`, `Total ${formatted} kcal`) : '');
    setText(output, message);
    if (summary) summary.hidden = calculated === 0;
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
      : copy('계산 결과를 확인한 뒤 기록 저장을 누르세요.', 'Check the result, then save the meal.'));
    root.dispatchEvent(new CustomEvent('meal:foods-changed', { detail: { count: calculated, total: calculated ? roundKcal(total) : null, incomplete: needsCorrection } }));
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
      setStatus(copy(`음식은 최대 ${MAX_FOODS}개까지 추가할 수 있어요.`, `You can add up to ${MAX_FOODS} foods.`));
      return null;
    }
    if (rowCount() > 0) showMenuNames();

    const data = food && typeof food === 'object' ? food : {};
    const row = document.createElement('section');
    row.className = 'food-row';
    row.dataset.foodRow = 'true';
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
    const name = input('text', '', data.name, copy('예: 김밥 한 줄', 'e.g. one gimbap roll'));
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
      applyNoteDefaultName(row);
      kcal.removeAttribute('data-calculated');
      reviseFoods();
      updateTotal();
    });
    name.addEventListener('input', () => {
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
    const nameField = field(copy('메뉴 이름', 'Menu name'), name);
    nameField.dataset.foodNameField = 'true';
    fields.append(
      nameField,
      field(copy('총 칼로리 (kcal)', 'Total calories (kcal)'), kcal)
    );
    row.append(header, fields, grams, density);
    container.append(row);
    if (data.photoDraft || data.textDraft) {
      const draftKey = data.textDraft ? 'foodTextDraft' : 'foodPhotoDraft';
      row.dataset[draftKey] = 'true';
      if (data.kcalPer100g) kcal.dataset.calculated = 'true';
      row.addEventListener('input', () => { delete row.dataset[draftKey]; }, { once: true });
      if (data.estimated) {
        const estimate = document.createElement('small');
        estimate.className = 'food-ai-estimate';
        estimate.textContent = copy(' · AI 열량 참고값', ' · AI calorie estimate');
        heading.append(estimate);
        [name, density, kcal].forEach((control) => control.addEventListener('input', () => estimate.remove(), { once: true }));
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

  function updateTextActions() {
    const calculate = byId('food-text-calculate');
    const settings = byId('food-ai-settings-open');
    const auto = byId('food-text-auto');
    // With a working automatic connection the note stays intentionally quiet.
    // Manual calculation appears after opting out or an analysis error, and
    // setup remains one clear action away when the device is disconnected.
    if (calculate) calculate.hidden = !photoCode || Boolean(auto?.checked);
    if (settings) settings.hidden = Boolean(photoCode);
  }

  function setPhotoCode(code) {
    if (code) stopQrScan();
    photoCode = code;
    try {
      if (code) root.localStorage.setItem(codeKey(), code);
      else root.localStorage.removeItem(codeKey());
    } catch { /* storage can be unavailable in private browser sessions */ }
    const codeInput = byId('food-ai-code');
    if (codeInput) codeInput.value = '';
    const setup = byId('food-ai-setup');
    if (setup) setup.hidden = Boolean(code);
    const disconnect = byId('food-ai-disconnect');
    if (disconnect) disconnect.hidden = !code;
    const textAuto = byId('food-text-auto');
    if (textAuto) textAuto.disabled = !code;
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
    return copy('사진 분석을 연결했어요. 음식 사진을 찍거나 올려 보세요.', 'Photo analysis is connected. Take or add a food photo.');
  }

  function consumePhotoPairLink() {
    const link = root.location.href;
    if (!link.startsWith(PAIR_LINK)) return;
    root.history.replaceState(root.history.state, '', root.location.pathname);
    const message = connectFromQr(codeFromQrLink(link));
    if (byId('meal-dialog').open) setStatus(message);
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
    if (!video || !preview || !navigator.mediaDevices?.getUserMedia) {
      input.click();
      return;
    }
    if (qrSession) return;
    stopCamera(false);
    const session = { button, video, preview, stream: null, timer: null };
    qrSession = session;
    button.disabled = true;
    setStatus(copy('카메라를 여는 중이에요.', 'Opening the camera.'));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (qrSession !== session || !byId('meal-dialog').open) {
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
        setStatus(copy('카메라로 읽지 못했어요. QR 사진 찍기를 눌러 다시 시도해 주세요.', 'Could not scan with the camera. Try Take QR photo.'));
      };
      const read = () => {
        if (qrSession !== session) return;
        if (Date.now() >= deadline) { fail(); return; }
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          let result;
          try { result = readQrFrame(video, video.videoWidth, video.videoHeight, canvas, 0.95, 800); }
          catch { fail(); return; }
          if (result) {
            stopQrScan();
            setStatus(connectFromQr(codeFromQrLink(result.data)));
            return;
          }
        }
        session.timer = root.setTimeout(read, 220);
      };
      setStatus('');
      video.play().catch(fail);
      read();
    } catch {
      if (qrSession === session) {
        stopQrScan();
        setStatus(copy('카메라 권한을 확인하거나 QR 사진 찍기를 눌러 주세요.', 'Check camera permission or tap Take QR photo.'));
      }
    }
  }

  async function scanPhotoPairQr(file) {
    const button = byId('food-ai-scan');
    const generation = transientGeneration;
    const active = () => isCurrentGeneration(generation) && byId('meal-dialog').open;
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
      setStatus(connectFromQr(codeFromQrLink(result.data)));
    } catch {
      if (active()) setStatus(copy('QR을 읽지 못했어요. PC 화면의 QR 전체가 보이게 다시 찍어 주세요.', 'Could not read the QR code. Capture the entire code on your PC screen.'));
    } finally {
      button.disabled = false;
    }
  }

  function analysisPending() {
    return !!analysisRequest || photoReadGeneration !== null;
  }

  function updateAnalysisActions() {
    const pending = analysisPending();
    const stop = byId('meal-analysis-stop');
    if (stop) stop.hidden = !pending;
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

  function insertAnalyzedFoods(result, kind, status) {
    if (!Array.isArray(result?.foods) || !Array.isArray(result.unmatched)) throw new Error('Invalid analysis result');
    const fromText = kind === 'text';
    const allowedSource = (food) => food?.source === 'mfds' || (fromText && food?.source === 'ai');
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
    const unmatched = result.unmatched.filter((item) => !item?.choices?.length && !needsAmount(item)).slice(0, 3).map((item) => typeof item?.name === 'string' ? item.name.slice(0, 60) : '').filter(Boolean).join(', ');
    items.push(...needsReview);
    if (items.length) {
      discardDrafts('photo');
      discardDrafts('text');
      document.querySelectorAll('#food-items [data-food-row]').forEach((row) => {
        if ([...row.querySelectorAll('input')].every((control) => !control.value.trim() && !control.validity.badInput)) row.remove();
      });
    }
    const room = MAX_FOODS - rowCount();
    const inserted = items.slice(0, room);
    inserted.forEach((item) => addRow(item));
    if (!items.length || !room) {
      revealFoodEntry();
      status(unmatched
        ? copy(`칼로리를 계산하지 못했어요. 직접 입력: ${unmatched}`, `No calorie match. Enter manually: ${unmatched}`)
        : copy('자동으로 채울 음식이 없어요. 음식과 칼로리를 직접 입력해 주세요.', 'No food was filled. You can enter food and calories manually.'));
      return;
    }
    updateTotal();
    revealFoodEntry();
    const message = fromText
      ? copy('음식과 칼로리를 찾았어요. 결과를 확인한 뒤 기록 저장을 눌러 주세요.', 'Food and calories are ready. Review the result, then save the meal.')
      : copy('사진에서 음식을 찾았어요. 결과를 확인한 뒤 기록 저장을 눌러 주세요.', 'Food was found in the photo. Review the result, then save the meal.');
    const amount = inserted.some((item) => item.grams === null && Number.isFinite(item.kcalPer100g))
      ? copy(' 칼로리가 비어 있는 메뉴는 총 칼로리를 직접 입력해 주세요.', 'Enter total calories for any item without a calorie value.') : '';
    const review = needsReview.length ? copy(' 국·찌개는 실제로 먹은 종류를 골라 주세요.', ' Select the soup or stew you ate.') : '';
    const manual = unmatched ? copy(` 직접 입력: ${unmatched}`, ` Enter manually: ${unmatched}`) : '';
    const limited = items.length > room ? copy(' 입력 칸이 부족해 일부만 추가했어요.', ' Only some items fit in the form.') : '';
    status(message + amount + review + manual + limited);
  }

  function analysisError(code, kind) {
    if (kind === 'text') {
      const calculate = byId('food-text-calculate');
      if (calculate) calculate.hidden = false;
    }
    switch (code) {
      case 'AUTH':
        setPhotoCode('');
        return copy('연결 코드가 맞지 않아요. 다시 연결해 주세요.', 'The access code is invalid. Please reconnect.');
      case 'QUOTA':
        quotaDay = new Date().toISOString().slice(0, 10);
        return copy('오늘 무료 분석 한도에 도달했어요. UTC 자정 이후 다시 시도하거나 직접 입력해 주세요.', 'The daily free analysis limit is reached. Retry after midnight UTC or enter food manually.');
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

  async function analyze(kind, input) {
    if (!endpoint || !photoCode || !byId('meal-dialog').open) return;
    const fromText = kind === 'text';
    const status = fromText ? (message) => setText(byId('food-text-status'), message) : setStatus;
    if (quotaDay === new Date().toISOString().slice(0, 10)) {
      status(analysisError('QUOTA', kind));
      return;
    }
    cancelAnalysis();
    const controller = new AbortController();
    const request = { kind, controller, foodRevision, noteRevision };
    analysisRequest = request;
    updateAnalysisActions();
    const isActive = () => analysisRequest === request && byId('meal-dialog').open &&
      (!fromText || (request.foodRevision === foodRevision && request.noteRevision === noteRevision));
    const timeout = root.setTimeout(() => controller.abort(), 30000);
    status(fromText ? copy('입력한 음식의 칼로리를 계산하고 있어요…', 'Calculating calories from your note…')
      : copy('사진 속 음식과 양을 확인하고 있어요…', 'Identifying food and portions…'));
    try {
      const body = fromText ? input : await photoJpeg(input);
      if (!isActive()) return;
      if (!fromText && (!body || body.type !== 'image/jpeg' || !body.size || body.size > MAX_AI_BYTES)) {
        status(analysisError('IMAGE', kind));
        return;
      }
      const url = fromText ? new URL('/meal-text/analyze', endpoint).href : endpoint.href;
      const response = await fetch(url, {
        method: 'POST', body,
        headers: { Authorization: `Bearer ${photoCode}`, 'Content-Type': fromText ? 'text/plain;charset=UTF-8' : 'image/jpeg' },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
      });
      const result = await response.json();
      if (!isActive()) return;
      if (response.ok) insertAnalyzedFoods(result, kind, status);
      else status(analysisError(result?.code, kind));
    } catch {
      if (isActive()) status(analysisError('UNAVAILABLE', kind));
    } finally {
      root.clearTimeout(timeout);
      if (analysisRequest === request) {
        analysisRequest = null;
        updateAnalysisActions();
      }
    }
  }

  function analyzePhoto() {
    const photo = currentPhoto;
    if (photo && isCurrentGeneration(photo.generation)) return analyze('photo', photo.preview);
  }

  function analyzeNote() {
    if (analysisRequest?.kind === 'photo' || photoReadGeneration !== null) return;
    if (!noteEdited || !photoCode || !byId('food-text-auto')?.checked) return;
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

  function clearPhoto(showStatus, invalidate) {
    if (invalidate !== false) nextTransientGeneration();
    currentPhoto = null;
    discardDrafts('photo');
    const preview = byId('food-photo-preview');
    const remove = byId('food-photo-remove');
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
      preview.alt = '';
    }
    if (remove) remove.hidden = true;
    ['food-photo-file', 'food-photo-capture'].forEach((id) => {
      const control = byId(id);
      if (control) control.value = '';
    });
    if (showStatus) setStatus(copy('사진을 지웠어요.', 'Photo removed.'));
  }

  function showPhoto(file, generation) {
    if (!isCurrentGeneration(generation)) return;
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setStatus(copy('이미지 파일만 올릴 수 있어요.', 'Please choose an image file.'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus(copy('사진은 12MB 이하로 올려 주세요.', 'Choose an image smaller than 12 MB.'));
      return;
    }
    if (photoCode && endpoint) {
      photoReadGeneration = generation;
      updateAnalysisActions();
    }
    const finishReading = () => {
      if (photoReadGeneration !== generation) return;
      photoReadGeneration = null;
      updateAnalysisActions();
    };
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => {
      finishReading();
      if (isCurrentGeneration(generation)) setStatus(copy('사진을 읽지 못했어요. 다른 사진을 선택해 주세요.', 'The photo could not be read. Please choose another one.'));
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
        currentPhoto = { preview, generation };
        if (photoCode) analyzePhoto();
        else setStatus(endpoint
          ? copy('연결하면 선택한 사진에서 음식을 자동으로 채워요.', 'Connect to fill in food from the selected photo.')
          : copy('사진은 이 입력 화면에서만 참고용으로 사용돼요. 음식과 칼로리를 확인해 주세요.', 'This photo is temporary reference only. Please confirm the food and calories.'));
      }).catch(() => {
        if (!isCurrentGeneration(generation)) return;
        finishReading();
        clearPhoto(false, false);
        setStatus(copy('사진을 표시하지 못했어요. 다른 사진을 선택해 주세요.', 'The photo could not be displayed. Please choose another one.'));
      });
    };
    reader.readAsDataURL(file);
  }

  function selectPhoto(file) {
    const generation = nextTransientGeneration();
    stopCamera(false);
    clearPhoto(false, false);
    showPhoto(file, generation);
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
      setStatus(copy('이 기기에서는 카메라 미리보기를 사용할 수 없어요. 사진 선택을 이용해 주세요.', 'Camera preview is not available here. Please choose a photo instead.'));
      return;
    }
    const generation = nextTransientGeneration();
    try {
      stopCamera(false);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!isCurrentGeneration(generation)) {
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
      if (!isCurrentGeneration(generation)) {
        if (cameraStream === stream) stopCamera(false);
        return;
      }
      setStatus(copy('카메라가 켜졌어요. 사진 찍기를 눌러 주세요.', 'Camera is on. Tap Take photo when ready.'));
    } catch (_error) {
      if (isCurrentGeneration(generation)) {
        stopCamera(false);
        setStatus(copy('카메라를 사용할 수 없어요. 권한을 확인하거나 사진 선택을 이용해 주세요.', 'Camera is unavailable. Check permission or choose a photo instead.'));
      }
    }
  }

  function snapshotCamera() {
    const video = byId('food-camera-video');
    if (!cameraStream || !video || !video.videoWidth || !video.videoHeight) {
      setStatus(copy('카메라 화면이 준비된 뒤 다시 눌러 주세요.', 'Wait for the camera preview, then try again.'));
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
        setStatus(copy('사진을 만들지 못했어요. 다시 시도해 주세요.', 'The photo could not be created. Please try again.'));
        return;
      }
      showPhoto(new File([blob], 'meal-camera.jpg', { type: 'image/jpeg' }), generation);
      stopCamera(false);
    }, 'image/jpeg', 0.9);
  }

  function read(options = {}) {
    const foods = [];
    const rows = document.querySelectorAll('#food-items [data-food-row]');
    for (const row of rows) {
      const name = row.querySelector('[data-food-name]').value.trim();
      const gramsRaw = row.querySelector('[data-food-grams]').value.trim();
      const kcalRaw = row.querySelector('[data-food-kcal]').value.trim();
      const densityRaw = row.querySelector('[data-food-density]').value.trim();
      if (row.hasAttribute('data-food-note-default') && !name && kcalRaw !== '') {
        byId('meal-note')?.focus();
        throw new Error(copy('위에 음식 설명을 입력하거나 메뉴명을 따로 입력해 주세요.', 'Describe your food above, or choose Edit names to enter a menu name.'));
      }
      if (row.hasAttribute('data-food-review') && !name) throw new Error(copy('국·찌개 종류를 고르거나 해당 음식 칸을 삭제해 주세요.', 'Choose the soup or stew, or remove that row.'));
      if (name && densityRaw && !gramsRaw && !kcalRaw) throw new Error(copy(`${name}의 총 칼로리를 입력해 주세요.`, `Enter the total calories for ${name}.`));
      if (!name && !gramsRaw && !kcalRaw && !densityRaw) continue;
      const grams = finiteNumber(gramsRaw);
      const kcal = finiteNumber(kcalRaw);
      const density = finiteNumber(densityRaw);
      if (!name || name.length > 100 || kcalRaw === '' || !Number.isFinite(kcal) || kcal < 0 || kcal > MAX_KCAL || (gramsRaw !== '' && (!Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS)) || (densityRaw !== '' && (!Number.isFinite(density) || density < 0 || density > MAX_DENSITY))) {
        throw new Error(copy('메뉴 이름과 0 이상 총 칼로리를 확인해 주세요.', 'Check each menu name and enter non-negative total calories.'));
      }
      const item = { name, kcal };
      if (gramsRaw !== '') item.grams = grams;
      foods.push(item);
    }
    // A result drafted by AI stays editable until the user deliberately uses
    // the form's Save button.  This makes saving the explicit confirmation;
    // automatic analysis never records a meal by itself.
    if (!options.confirmAnalysis && document.querySelector('#food-items [data-food-photo-draft], #food-items [data-food-text-draft]')) {
      throw new Error(copy('AI 계산 결과를 확인한 뒤 기록 저장을 눌러 주세요.', 'Review the AI result, then use Save meal.'));
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
    manualNamesVisible = false;
    if (photoCode) setText(byId('food-text-status'), '');
    stopCamera(false);
    clearPhoto(false, false);
    setStatus('');
    container.replaceChildren();
    const source = Array.isArray(foods) ? foods : [];
    source.slice(0, MAX_FOODS).forEach((food) => addRow(food));
    if (source.length === 0) addRow();
    showRecentFoods(events);
    const choices = byId('food-photo-choices');
    if (choices) choices.hidden = true;
    updateTotal();
  }

  function initialize() {
    if (initialized || !byId('food-items')) return;
    initialized = true;
    endpoint = photoEndpoint();
    if (endpoint) {
      const settings = byId('settings-food-ai');
      if (settings) settings.hidden = false;
      const panel = byId('food-ai-panel');
      if (panel) panel.hidden = false;
      const manualHelp = byId('food-photo-manual-help');
      if (manualHelp) manualHelp.hidden = true;
      let saved = '';
      try { saved = root.localStorage.getItem(codeKey()) || ''; } catch { /* optional persistence */ }
      setPhotoCode(CODE_PATTERN.test(saved) ? saved : '');
      const textAuto = byId('food-text-auto');
      if (textAuto) {
        byId('food-text-options').hidden = false;
        byId('food-quota-check')?.addEventListener('click', async event => {
          const output = byId('food-quota-status');
          if (!photoCode) {
            root.dispatchEvent(new CustomEvent('meal:ai-settings'));
            setText(output, copy('먼저 AI 연결 코드를 등록해 주세요.', 'Connect your AI access code first.'));
            return;
          }
          const button = event.currentTarget, code = photoCode;
          const controller = new AbortController();
          const timeout = root.setTimeout(() => controller.abort(), 10000);
          button.disabled = true;
          setText(output, copy('공유 한도를 확인하고 있어요…', 'Checking the shared limit…'));
          try {
            const response = await fetch(new URL('/meal-ai/quota', endpoint).href, { headers: { Authorization: `Bearer ${code}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
            if (!response.ok) throw new Error('Unavailable');
            const quota = await response.json();
            if (!Number.isInteger(quota.remaining) || !Number.isInteger(quota.dailyLimit) || quota.remaining < 0 || quota.remaining > quota.dailyLimit || quota.dailyLimit > 100000 || quota.shared !== true || !Number.isFinite(Date.parse(quota.resetsAtUtc))) throw new Error('Invalid response');
            if (photoCode !== code) return;
            const reset = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(quota.resetsAtUtc));
            setText(output, copy(`앱 공유 한도 ${quota.remaining}/${quota.dailyLimit}회 · 초기화 ${reset}. 실제 서비스 사용 가능 횟수는 다를 수 있어요.`, `App shared limit ${quota.remaining}/${quota.dailyLimit} · resets ${reset}. Actual service availability may differ.`));
          } catch (_) {
            if (photoCode === code) setText(output, copy('지금은 남은 횟수를 확인할 수 없어요. 음식은 직접 기록할 수 있어요.', 'Remaining analyses are unavailable. You can still log food manually.'));
          } finally { root.clearTimeout(timeout); button.disabled = false; }
        });
        byId('food-text-calculate')?.addEventListener('click', () => {
          const note = byId('meal-note').value.trim();
          if (!note) { setText(byId('food-text-status'), copy('음식 이름과 양을 입력해 주세요.', 'Enter a food and portion.')); byId('meal-note').focus(); return; }
          if (!photoCode) {
            root.dispatchEvent(new CustomEvent('meal:ai-settings'));
            setText(byId('food-text-status'), copy('AI 연결 코드를 등록한 뒤 다시 눌러 주세요. 음식은 직접 기록할 수도 있어요.', 'Connect an AI access code and try again, or record food manually.'));
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
        textAuto.addEventListener('change', () => {
          try { root.localStorage.setItem(TEXT_AUTO_KEY, textAuto.checked ? '1' : '0'); } catch { /* optional persistence */ }
          updateTextActions();
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
          setStatus(copy('사진 분석 연결 코드를 다시 확인해 주세요.', 'Check your photo analysis access code.'));
          return;
        }
        setPhotoCode(code);
        setStatus(copy('사진을 찍거나 올리면 분석이 시작돼요.', 'Take or select a photo to start analysis.'));
        analyzePhoto();
      };
      byId('food-ai-connect')?.addEventListener('click', connect);
      codeInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); connect(); }
      });
      byId('food-ai-disconnect')?.addEventListener('click', () => {
        cancelAnalysis();
        setPhotoCode('');
        setStatus(copy('사진 분석을 껐어요. 음식은 직접 입력할 수 있어요.', 'Photo analysis is off. You can still enter food manually.'));
      });
    }
    const note = byId('meal-note');
    if (note) {
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
          if (slot) slot.hidden = true;
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
    byId('food-photo-add')?.addEventListener('click', () => {
      const choices = byId('food-photo-choices');
      if (!choices) return;
      choices.hidden = !choices.hidden;
      byId('food-photo-add').setAttribute('aria-expanded', String(!choices.hidden));
    });
    byId('food-photo-pick')?.addEventListener('click', () => byId('food-photo-file')?.click());
    byId('food-ai-settings-open')?.addEventListener('click', () => root.dispatchEvent(new CustomEvent('meal:ai-settings')));
    ['food-photo-file', 'food-photo-capture'].forEach((id) => {
      const picker = byId(id);
      if (picker) picker.addEventListener('change', () => selectPhoto(picker.files && picker.files[0]));
    });
    const camera = byId('food-camera');
    if (camera) camera.addEventListener('click', startCamera);
    const snap = byId('food-camera-snap');
    if (snap) snap.addEventListener('click', snapshotCamera);
    const stop = byId('food-camera-stop');
    if (stop) stop.addEventListener('click', () => { nextTransientGeneration(); stopCamera(true); });
    const remove = byId('food-photo-remove');
    if (remove) remove.addEventListener('click', () => clearPhoto(true));
    byId('meal-analysis-stop')?.addEventListener('click', () => {
      noteEdited = false;
      nextTransientGeneration();
      setStatus(copy('분석을 중단했어요. 직접 입력한 내용은 저장할 수 있어요.', 'Analysis stopped. You can save the entries you added.'));
      byId('save-meal').focus({ preventScroll: true });
    });
    const dialog = byId('meal-dialog');
    if (dialog) dialog.addEventListener('close', () => { nextTransientGeneration(); stopCamera(false); clearPhoto(false, false); });
    root.addEventListener('beforeunload', () => { nextTransientGeneration(); stopCamera(false); }, { once: true });
    root.addEventListener('pagehide', stopQrScan);
  }

  root.MealFoods = { open, read, prepareSave, recentFoods };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}(window));
