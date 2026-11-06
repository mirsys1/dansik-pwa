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

  const byId = (id) => document.getElementById(id);
  const isEnglish = () => String(document.documentElement.lang || '').toLowerCase().startsWith('en');
  const copy = (korean, english) => (isEnglish() ? english : korean);
  const valueOrEmpty = (value) => value === undefined || value === null ? '' : String(value);

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

  function updateTotal() {
    const output = byId('food-total');
    const rows = document.querySelectorAll('#food-items [data-food-kcal]');
    let total = 0;
    let calculated = 0;
    let missingAmount = false;
    rows.forEach((control) => {
      const kcal = finiteNumber(control.value.trim());
      if (Number.isFinite(kcal) && kcal >= 0) {
        total += kcal;
        calculated++;
      } else {
        const row = control.closest('[data-food-row]');
        if (row.querySelector('[data-food-name]').value.trim() && row.querySelector('[data-food-density]').value !== '') missingAmount = true;
      }
    });
    const formatted = roundKcal(total).toLocaleString(isEnglish() ? 'en-US' : 'ko-KR', { maximumFractionDigits: 1 });
    if (missingAmount) {
      setText(output, calculated ? copy(`계산된 합계 ${formatted} kcal · 양 입력 필요`, `Calculated subtotal ${formatted} kcal · amount needed`)
        : copy('먹은 양을 입력하면 합계가 표시돼요.', 'Enter the amount eaten to show the total.'));
    } else setText(output, copy(`합계 ${formatted} kcal`, `Total ${formatted} kcal`));
  }

  // The calorie path opens below the short meal form. Keep the first row's
  // label clear of the fixed dialog header as well as the editable fields
  // clear of the save bar, without moving focus or opening the keyboard.
  function revealFoodEntry() {
    const foods = byId('meal-foods');
    const scroller = document.querySelector('#meal-dialog .meal-form-body');
    const target = foods?.querySelector('.food-row, .food-fields, [data-food-name]');
    if (!foods?.open || !scroller || !target) return;
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

    const data = food && typeof food === 'object' ? food : {};
    const row = document.createElement('section');
    row.className = 'food-row';
    row.dataset.foodRow = 'true';

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
    const name = input('text', '', data.name, copy('예: 현미밥', 'e.g. brown rice'));
    name.maxLength = 100;
    name.dataset.foodName = 'true';
    const grams = input('number', '', data.grams, data.photoDraft && data.grams === null && Number.isFinite(data.kcalPer100g)
      ? copy('먹은 양 입력', 'Enter amount') : copy('선택', 'Optional'));
    grams.inputMode = 'decimal';
    grams.min = '0';
    grams.max = String(MAX_GRAMS);
    grams.step = 'any';
    grams.dataset.foodGrams = 'true';
    const kcal = input('number', '', data.kcal, copy('kcal', 'kcal'));
    kcal.inputMode = 'decimal';
    kcal.min = '0';
    kcal.max = String(MAX_KCAL);
    kcal.step = 'any';
    kcal.dataset.foodKcal = 'true';
    const density = input('number', '', data.kcalPer100g, copy('선택', 'Optional'));
    density.inputMode = 'decimal';
    density.min = '0';
    density.max = String(MAX_DENSITY);
    density.step = 'any';
    density.dataset.foodDensity = 'true';

    grams.addEventListener('input', () => computeKcal(row));
    density.addEventListener('input', () => computeKcal(row));
    kcal.addEventListener('input', () => {
      kcal.removeAttribute('data-calculated');
      updateTotal();
    });
    fields.append(
      field(copy('음식 이름', 'Food name'), name),
      field(copy('칼로리', 'Calories'), kcal)
    );
    const more = document.createElement('details');
    more.className = 'food-row-more';
    const moreSummary = document.createElement('summary');
    moreSummary.textContent = copy('양·100g당 칼로리로 계산', 'Calculate from amount and kcal per 100 g');
    const moreFields = document.createElement('div');
    moreFields.className = 'food-fields food-fields-more';
    moreFields.append(
      field(copy('양 (g)', 'Amount (g)'), grams),
      field(copy('100g당 kcal', 'kcal per 100g'), density)
    );
    more.append(moreSummary, moreFields);
    more.open = data.grams !== undefined || data.kcalPer100g !== undefined || Boolean(data.photoDraft);
    row.append(header, fields, more);
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
      name.addEventListener('input', () => {
        density.value = '';
        if (kcal.hasAttribute('data-calculated')) kcal.value = '';
        kcal.removeAttribute('data-calculated');
        updateTotal();
      });
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

  function setPhotoCode(code) {
    if (code) stopQrScan();
    photoCode = code;
    try {
      if (code) root.localStorage.setItem(codeKey(), code);
      else root.localStorage.removeItem(codeKey());
    } catch { /* storage can be unavailable in private browser sessions */ }
    byId('food-ai-code').value = '';
    byId('food-ai-setup').hidden = Boolean(code);
    byId('food-ai-disconnect').hidden = !code;
    const textAuto = byId('food-text-auto');
    if (textAuto) textAuto.disabled = !code;
    setText(byId('food-text-status'), code ? '' : copy('섭취한 음식에서 분석 연결 코드를 등록하면 사용할 수 있어요.', 'Connect with your analysis code under Foods eaten.'));
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
      status(unmatched
        ? copy(`칼로리를 계산하지 못했어요. 직접 입력: ${unmatched}`, `No calorie match. Enter manually: ${unmatched}`)
        : copy('자동으로 채울 음식이 없어요. 음식과 칼로리를 직접 입력해 주세요.', 'No food was filled. You can enter food and calories manually.'));
      return;
    }
    if (fromText) byId('meal-foods').open = true;
    const message = fromText
      ? copy('음식 목록을 채웠어요. 먹은 양과 AI 열량 참고값을 확인한 뒤 저장해 주세요.', 'Check the filled foods, portions, and AI calorie estimates before saving.')
      : copy('사진만으로는 양을 정확히 알 수 없어요. 음식과 먹은 양을 확인한 뒤 저장해 주세요.', 'A photo cannot determine exact portions. Check the food and amounts before saving.');
    const amount = inserted.some((item) => item.grams === null && Number.isFinite(item.kcalPer100g))
      ? copy(' 양이 비어 있는 음식은 먹은 양(g)을 입력하면 칼로리가 계산돼요.', 'Enter the amount eaten (g) for any blank portion to calculate its calories.') : '';
    const review = needsReview.length ? copy(' 국·찌개는 실제로 먹은 종류를 골라 주세요.', ' Select the soup or stew you ate.') : '';
    const manual = unmatched ? copy(` 직접 입력: ${unmatched}`, ` Enter manually: ${unmatched}`) : '';
    const limited = items.length > room ? copy(' 입력 칸이 부족해 일부만 추가했어요.', ' Only some items fit in the form.') : '';
    status(message + amount + review + manual + limited);
  }

  function analysisError(code, kind) {
    switch (code) {
      case 'AUTH':
        setPhotoCode('');
        return copy('연결 코드가 맞지 않아요. 다시 연결해 주세요.', 'The access code is invalid. Please reconnect.');
      case 'QUOTA':
        quotaDay = new Date().toISOString().slice(0, 10);
        return copy('오늘 무료 분석 한도에 도달했어요. 음식은 직접 입력할 수 있어요.', 'Today’s free analysis limit is reached. You can still enter food manually.');
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
    const request = { kind, controller };
    analysisRequest = request;
    updateAnalysisActions();
    const isActive = () => analysisRequest === request && byId('meal-dialog').open;
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
    if (!analysisPending()) analyzeNote();
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

  function read() {
    const foods = [];
    const rows = document.querySelectorAll('#food-items [data-food-row]');
    for (const row of rows) {
      const name = row.querySelector('[data-food-name]').value.trim();
      const gramsRaw = row.querySelector('[data-food-grams]').value.trim();
      const kcalRaw = row.querySelector('[data-food-kcal]').value.trim();
      const densityRaw = row.querySelector('[data-food-density]').value.trim();
      if (row.hasAttribute('data-food-review') && !name) throw new Error(copy('국·찌개 종류를 고르거나 해당 음식 칸을 삭제해 주세요.', 'Choose the soup or stew, or remove that row.'));
      if (name && densityRaw && !gramsRaw && !kcalRaw) throw new Error(copy(`${name}의 먹은 양(g)이나 칼로리를 입력해 주세요.`, `Enter the amount eaten (g) or calories for ${name}.`));
      if (!name && !gramsRaw && !kcalRaw && !densityRaw) continue;
      const grams = finiteNumber(gramsRaw);
      const kcal = finiteNumber(kcalRaw);
      const density = finiteNumber(densityRaw);
      if (!name || name.length > 100 || kcalRaw === '' || !Number.isFinite(kcal) || kcal < 0 || kcal > MAX_KCAL || (gramsRaw !== '' && (!Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS)) || (densityRaw !== '' && (!Number.isFinite(density) || density < 0 || density > MAX_DENSITY))) {
        throw new Error(copy('각 음식의 이름과 0 이상 칼로리를 입력해 주세요. 양은 0보다 커야 해요.', 'Enter a name and non-negative calories for each food. Amount must be greater than zero.'));
      }
      const item = { name, kcal };
      if (gramsRaw !== '') item.grams = grams;
      foods.push(item);
    }
    const core = root.FastingCore;
    return core && typeof core.normalizeFoods === 'function' ? core.normalizeFoods(foods) : foods;
  }

  function open(foods, expanded) {
    initialize();
    const container = byId('food-items');
    if (!container) return;
    nextTransientGeneration();
    noteEdited = false;
    if (photoCode) setText(byId('food-text-status'), '');
    stopCamera(false);
    clearPhoto(false, false);
    setStatus('');
    container.replaceChildren();
    const source = Array.isArray(foods) ? foods : [];
    source.slice(0, MAX_FOODS).forEach((food) => addRow(food));
    if (source.length === 0) addRow();
    const hasFoods = source.length > 0;
    const mealDetails = byId('meal-details');
    if (mealDetails) mealDetails.open = Boolean(expanded || hasFoods);
    const details = byId('meal-foods');
    if (details) details.open = Boolean(expanded || hasFoods);
    const tools = byId('food-tools');
    // Show the two essential fields first. Photo/AI and quantity-based
    // calculation stay one explicit choice away, so the calorie entry path
    // does not begin with a long tool panel or depend on extra scrolling.
    if (tools) tools.open = false;
    updateTotal();
    if (expanded) requestAnimationFrame(revealFoodEntry);
  }

  function initialize() {
    if (initialized || !byId('food-items')) return;
    initialized = true;
    byId('meal-foods')?.addEventListener('toggle', () => {
      if (byId('meal-foods')?.open) requestAnimationFrame(revealFoodEntry);
    });
    endpoint = photoEndpoint();
    if (endpoint) {
      byId('food-ai-panel').hidden = false;
      byId('food-photo-manual-help').hidden = true;
      let saved = '';
      try { saved = root.localStorage.getItem(codeKey()) || ''; } catch { /* optional persistence */ }
      setPhotoCode(CODE_PATTERN.test(saved) ? saved : '');
      const textAuto = byId('food-text-auto');
      if (textAuto) {
        byId('food-text-options').hidden = false;
        try { textAuto.checked = root.localStorage.getItem(TEXT_AUTO_KEY) === '1'; } catch { /* optional persistence */ }
        textAuto.addEventListener('change', () => {
          try { root.localStorage.setItem(TEXT_AUTO_KEY, textAuto.checked ? '1' : '0'); } catch { /* optional persistence */ }
          if (textAuto.checked) analyzeNote();
          else if (analysisRequest?.kind === 'text') cancelAnalysis();
        });
        const note = byId('meal-note');
        note.addEventListener('input', () => {
          noteEdited = true;
          if (analysisRequest?.kind === 'text') cancelAnalysis();
          discardDrafts('text');
          if (photoCode) setText(byId('food-text-status'), '');
        });
        note.addEventListener('blur', analyzeNote);
        note.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing && textAuto.checked && !textAuto.disabled) {
            event.preventDefault();
            analyzeNote();
          }
        });
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
      byId('food-ai-connect').addEventListener('click', connect);
      codeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); connect(); }
      });
      byId('food-ai-disconnect').addEventListener('click', () => {
        cancelAnalysis();
        setPhotoCode('');
        setStatus(copy('사진 분석을 껐어요. 음식은 직접 입력할 수 있어요.', 'Photo analysis is off. You can still enter food manually.'));
      });
    }
    const add = byId('food-add');
    if (add) add.addEventListener('click', () => addRow()?.querySelector('[data-food-name]').focus());
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

  root.MealFoods = { open, read, prepareSave };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}(window));
