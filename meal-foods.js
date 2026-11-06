/* Food entry and temporary meal-photo controls.  This file intentionally has
 * no storage or image-analysis dependency: the caller persists read() data. */
(function mealFoodsModule(root) {
  'use strict';

  const MAX_FOODS = 24;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_KCAL = 20000;
  const MAX_GRAMS = 10000;
  const MAX_DENSITY = 20000;
  const MAX_AI_BYTES = 1024 * 1024;
  const CODE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
  let cameraStream = null;
  let initialized = false;
  let transientGeneration = 0;
  let currentPhoto = null;
  let photoRequest = null;
  let endpoint = null;
  let photoCode = '';
  let quotaDay = '';

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
    cancelAnalysis();
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
    rows.forEach((control) => {
      const kcal = finiteNumber(control.value.trim());
      if (Number.isFinite(kcal) && kcal >= 0) total += kcal;
    });
    const formatted = roundKcal(total).toLocaleString(isEnglish() ? 'en-US' : 'ko-KR', { maximumFractionDigits: 1 });
    setText(output, copy(`합계 ${formatted} kcal`, `Total ${formatted} kcal`));
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
    const grams = input('number', '', data.grams, copy('선택', 'Optional'));
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
      field(copy('양 (g)', 'Amount (g)'), grams),
      field(copy('칼로리', 'Calories'), kcal),
      field(copy('100g당 kcal', 'kcal per 100g'), density)
    );
    row.append(header, fields);
    container.append(row);
    if (data.photoDraft) {
      row.dataset.foodPhotoDraft = 'true';
      if (data.kcalPer100g) kcal.dataset.calculated = 'true';
      row.addEventListener('input', () => { delete row.dataset.foodPhotoDraft; }, { once: true });
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
    photoCode = code;
    try {
      if (code) root.localStorage.setItem(codeKey(), code);
      else root.localStorage.removeItem(codeKey());
    } catch { /* storage can be unavailable in private browser sessions */ }
    byId('food-ai-code').value = '';
    byId('food-ai-setup').hidden = Boolean(code);
    byId('food-ai-disconnect').hidden = !code;
  }

  function cancelAnalysis() {
    photoRequest?.abort();
    photoRequest = null;
  }

  function discardPhotoDrafts() {
    const rows = document.querySelectorAll('#food-items [data-food-photo-draft]');
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

  function insertPhotoFoods(result) {
    if (!Array.isArray(result?.foods) || !Array.isArray(result.unmatched)) throw new Error('Invalid photo result');
    const items = result.foods.slice(0, MAX_FOODS).flatMap((food) => {
      if (!food || food.source !== 'mfds' || typeof food.name !== 'string') return [];
      const name = food.name.trim();
      const { grams, kcalPer100g } = food;
      const kcal = roundKcal(grams * kcalPer100g / 100);
      return name && name.length <= 100 && Number.isFinite(grams) && grams > 0 && grams <= MAX_GRAMS &&
        Number.isFinite(kcalPer100g) && kcalPer100g > 0 && kcalPer100g <= MAX_DENSITY && kcal <= MAX_KCAL
        ? [{ name, grams, kcalPer100g, kcal, photoDraft: true }] : [];
    });
    const needsReview = result.unmatched.slice(0, MAX_FOODS).flatMap((item) => {
      if (!Array.isArray(item?.choices)) return [];
      const choices = item.choices.slice(0, 60).filter((choice) => typeof choice?.name === 'string' && choice.name.length <= 100 &&
        Number.isFinite(choice.kcalPer100g) && choice.kcalPer100g > 0 && choice.kcalPer100g <= MAX_DENSITY);
      const grams = Number.isFinite(item.grams) && item.grams > 0 && item.grams <= MAX_GRAMS ? item.grams : null;
      return choices.length ? [{ grams, choices, photoDraft: true }] : [];
    });
    const unmatched = result.unmatched.filter((item) => !item?.choices?.length).slice(0, 3).map((item) => typeof item?.name === 'string' ? item.name.slice(0, 60) : '').filter(Boolean).join(', ');
    items.push(...needsReview);
    if (items.length) {
      document.querySelectorAll('#food-items [data-food-row]').forEach((row) => {
        if ([...row.querySelectorAll('input')].every((control) => !control.value.trim() && !control.validity.badInput)) row.remove();
      });
    }
    const room = MAX_FOODS - rowCount();
    items.slice(0, room).forEach((item) => addRow(item));
    if (!items.length || !room) {
      setStatus(unmatched
        ? copy(`칼로리를 계산하지 못했어요. 직접 입력: ${unmatched}`, `No calorie match. Enter manually: ${unmatched}`)
        : copy('자동으로 채울 음식이 없어요. 음식과 칼로리를 직접 입력해 주세요.', 'No food was filled. You can enter food and calories manually.'));
      return;
    }
    const message = copy('사진만으로는 양을 정확히 알 수 없어요. 음식과 먹은 양을 확인한 뒤 저장해 주세요.', 'A photo cannot determine exact portions. Check the food and amounts before saving.');
    const review = needsReview.length ? copy(' 국·찌개는 실제로 먹은 종류를 골라 주세요.', ' Select the soup or stew you ate.') : '';
    const manual = unmatched ? copy(` 직접 입력: ${unmatched}`, ` Enter manually: ${unmatched}`) : '';
    const limited = items.length > room ? copy(' 입력 칸이 부족해 일부만 추가했어요.', ' Only some items fit in the form.') : '';
    setStatus(message + review + manual + limited);
  }

  function analysisError(code) {
    switch (code) {
      case 'AUTH':
        setPhotoCode('');
        return copy('연결 코드가 맞지 않아요. 다시 연결해 주세요.', 'The access code is invalid. Please reconnect.');
      case 'QUOTA':
        quotaDay = new Date().toISOString().slice(0, 10);
        return copy('오늘 무료 분석 한도에 도달했어요. 음식은 직접 입력할 수 있어요.', 'Today’s free photo limit is reached. You can still enter food manually.');
      case 'IMAGE':
        return copy('사진을 분석할 수 없어요. 다른 사진을 선택해 주세요.', 'This photo could not be analyzed. Try a different photo.');
      case 'NO_FOOD':
        return copy('사진에서 음식을 찾지 못했어요. 직접 입력하거나 다른 사진을 선택해 주세요.', 'No food was found. Enter it manually or choose a different photo.');
      default:
        return copy('지금은 사진 분석을 할 수 없어요. 음식은 직접 입력할 수 있어요.', 'Photo analysis is unavailable. You can still enter food manually.');
    }
  }

  async function analyzePhoto() {
    const photo = currentPhoto;
    if (!endpoint || !photoCode || !photo || !isCurrentGeneration(photo.generation) || !byId('meal-dialog').open) return;
    if (quotaDay === new Date().toISOString().slice(0, 10)) {
      setStatus(analysisError('QUOTA'));
      return;
    }
    cancelAnalysis();
    const request = new AbortController();
    photoRequest = request;
    const isActive = () => photoRequest === request && isCurrentGeneration(photo.generation) && byId('meal-dialog').open;
    const timeout = root.setTimeout(() => request.abort(), 30000);
    setStatus(copy('사진 속 음식과 양을 확인하고 있어요…', 'Identifying food and portions…'));
    try {
      const blob = await photoJpeg(photo.preview);
      if (!isActive()) return;
      if (!blob || blob.type !== 'image/jpeg' || !blob.size || blob.size > MAX_AI_BYTES) {
        setStatus(analysisError('IMAGE'));
        return;
      }
      const response = await fetch(endpoint.href, {
        method: 'POST', body: blob,
        headers: { Authorization: `Bearer ${photoCode}`, 'Content-Type': 'image/jpeg' },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: request.signal
      });
      const result = await response.json();
      if (!isActive()) return;
      if (response.ok) insertPhotoFoods(result);
      else setStatus(analysisError(result?.code));
    } catch {
      if (isActive()) setStatus(analysisError('UNAVAILABLE'));
    } finally {
      root.clearTimeout(timeout);
      if (photoRequest === request) photoRequest = null;
    }
  }

  function clearPhoto(showStatus, invalidate) {
    if (invalidate !== false) nextTransientGeneration();
    currentPhoto = null;
    discardPhotoDrafts();
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
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => {
      if (isCurrentGeneration(generation)) setStatus(copy('사진을 읽지 못했어요. 다른 사진을 선택해 주세요.', 'The photo could not be read. Please choose another one.'));
    };
    reader.onload = () => {
      if (!isCurrentGeneration(generation)) return;
      const preview = byId('food-photo-preview');
      const remove = byId('food-photo-remove');
      if (!preview || typeof reader.result !== 'string') return;
      preview.src = reader.result;
      preview.alt = copy('입력한 음식 사진 미리보기', 'Selected food photo preview');
      const ready = typeof preview.decode === 'function' ? preview.decode() : Promise.resolve();
      ready.then(() => {
        if (!isCurrentGeneration(generation)) return;
        preview.hidden = false;
        if (remove) remove.hidden = false;
        currentPhoto = { preview, generation };
        if (photoCode) analyzePhoto();
        else setStatus(endpoint
          ? copy('연결하면 선택한 사진에서 음식을 자동으로 채워요.', 'Connect to fill in food from the selected photo.')
          : copy('사진은 이 입력 화면에서만 참고용으로 사용돼요. 음식과 칼로리를 확인해 주세요.', 'This photo is temporary reference only. Please confirm the food and calories.'));
      }).catch(() => {
        if (!isCurrentGeneration(generation)) return;
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
    stopCamera(false);
    clearPhoto(false, false);
    setStatus('');
    container.replaceChildren();
    const source = Array.isArray(foods) ? foods : [];
    source.slice(0, MAX_FOODS).forEach((food) => addRow(food));
    if (source.length === 0) addRow();
    const details = byId('meal-foods');
    if (details) details.open = Boolean(expanded) || source.length > 0;
    updateTotal();
  }

  function initialize() {
    if (initialized || !byId('food-items')) return;
    initialized = true;
    endpoint = photoEndpoint();
    if (endpoint) {
      byId('food-ai-panel').hidden = false;
      byId('food-photo-manual-help').hidden = true;
      let saved = '';
      try { saved = root.localStorage.getItem(codeKey()) || ''; } catch { /* optional persistence */ }
      setPhotoCode(CODE_PATTERN.test(saved) ? saved : '');
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
    const dialog = byId('meal-dialog');
    if (dialog) dialog.addEventListener('close', () => { nextTransientGeneration(); stopCamera(false); clearPhoto(false, false); });
    root.addEventListener('beforeunload', () => { nextTransientGeneration(); stopCamera(false); }, { once: true });
  }

  root.MealFoods = { open, read };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}(window));
