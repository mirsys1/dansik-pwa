(function () {
  'use strict';
  const A = window.FastingActivity, C = window.FastingCore;
  const text = (ko, en) => document.documentElement.lang === 'en' ? en : ko;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let snapshot, opener, syncing = false, healthSteps = null, activityScrollObserver = null;
  function estimate(interval, prefs, allowActivity = true) {
    if (!interval) return C.calculateCalories(null, prefs);
    return withActivity(interval, prefs, allowActivity);
  }
  function withActivity(interval, prefs, allowActivity = true) {
    const result = A.estimate(allowActivity ? prefs.activitySamples || [] : [], interval.from, interval.to, prefs.activitySource || '', C.normalizeProfile(prefs), interval.durationMs);
    result.activityOmitted = !allowActivity;
    return result;
  }
  function today(prefs, now) {
    return forDay(C.localDay(now, prefs.timeZone), prefs, now);
  }
  function forDay(date, prefs, now) {
    const { from, until } = C.dayRange(date, prefs.timeZone);
    const to = Math.max(from, Math.min(until, now));
    // Daily energy always uses basal energy plus the selected source's recorded activity.
    // Switching between a population model and a measured source would make new activity reduce the total.
    return { ...withActivity({ from, to }, prefs), from, until, to };
  }
  function sourceName(source) {
    return source === 'manual' ? text('직접 기록','Manual records') : source;
  }
  function activityNote(value, prefs) {
    const basis = prefs.profileConfirmed === true ? '' : text('신체 정보 미확인 · 기본값 기준 · ','Body profile unconfirmed · default values used · ');
    const warning = value.activityOmitted ? text('중지 이력이 있어 활동 합산 제외','Activity excluded because paused windows are unknown') : value.calculationStatus === 'overlap-detected' ? text('활동 기록이 겹쳐 합산을 보류했어요. 활동 기록 관리를 확인해 주세요.','Overlapping activity was not totaled. Check activity record management.') : value.activeKcal == null ? text('활동 자료 없음 · 기초 소비만 표시','Activity missing · basal only') : text('기록된 활동만 포함 · 미기록 활동은 알 수 없음','Recorded activity only · unrecorded activity unknown');
    const excluded = value.activity?.excludedBoundary || 0;
    return `${basis}${warning}${excluded ? text(` · 시간 경계에 걸친 ${excluded}개 기록 제외`, ` · ${excluded} boundary-crossing record(s) excluded`) : ''} · ${sourceName(prefs.activitySource) || text('출처 미선택','No source selected')}`;
  }
  function describe(value, prefs) {
    return `${text('기초','Basal')} ${Math.round(value.basalKcal || 0)} + ${text('활동','Activity')} ${value.activeKcal == null ? '—' : Math.round(value.activeKcal)} kcal · ${activityNote(value, prefs)}`;
  }
  window.FastingEnergy = { estimate, describe, today, forDay, activityNote };
  const dialog = document.getElementById('activity-dialog');
  const workoutDialog = document.getElementById('workout-dialog');
  let workoutOpener, workoutOpening = false, workoutSaving = false;
  function local(at) { return C.formatLocalInput(at, snapshot.prefs.timeZone === 'auto' ? undefined : snapshot.prefs.timeZone); }
  function status(message) { document.getElementById('activity-status').textContent = message; }
  async function save(patch) {
    return saveActivity({ type: 'prefs', patch });
  }
  async function saveActivity(action) {
    const result = await window.desktop.action(action);
    if (!result.ok) throw Error(result.error);
    snapshot = result;
    return result;
  }
  async function render() {
    snapshot = await window.desktop.getState();
    const p = snapshot.prefs, samples = p.activitySamples || [], sources = [...new Set(samples.map(x=>x.source))];
    const now = Date.now(), daily = today(p, now);
    const content = document.getElementById('activity-content');
    const expanded = new Set(dialog.open ? [...content.querySelectorAll('details[open]')].map(el => el.id) : []);
    const wasOpen = id => expanded.has(id) ? 'open' : '';
    const previousScroll = dialog.open ? content.querySelector('.activity-body')?.scrollTop || 0 : 0;
    const previousFocus = dialog.open && content.contains(document.activeElement) ? document.activeElement.id : '';
    const locale = document.documentElement.lang;
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const sourceOptions = sources.map(source => `<option value="${esc(source)}">${esc(sourceName(source))}</option>`).join('');
    const chooseSource = `<option value="">${text('출처 선택','Select a source')}</option>${sourceOptions}`;
    const recordedKcal = daily.activeKcal == null
      ? daily.calculationStatus === 'overlap-detected' ? text('계산 보류','On hold') : text('기록 없음','No records')
      : `${number.format(daily.activeKcal)} kcal`;
    const recordedSteps = daily.activity?.steps == null ? '—' : number.format(daily.activity.steps);
    const hasNative = Boolean(window.nativeHealth?.available);
    content.innerHTML = `
      <header class="dialog-heading">
        <h2 id="activity-title" tabindex="-1">${text('활동·건강 데이터','Activity & health data')}</h2>
        <button type="button" class="icon-button" id="activity-close" aria-label="${text('닫기','Close')}">✕</button>
      </header>
      <div class="activity-body">
        <section class="activity-day" aria-labelledby="activity-day-title">
          <h3 id="activity-day-title">${text('오늘 기록된 활동','Recorded activity today')}</h3>
          <dl class="activity-today-metrics">
            <div><dt>${text('활동 칼로리','Active calories')}</dt><dd>${recordedKcal}</dd></div>
            <div><dt>${text('걸음 수','Steps')}</dt><dd>${recordedSteps}</dd></div>
          </dl>
          <p class="activity-selected-source">${text('합산 출처','Source used')} · ${esc(sourceName(p.activitySource) || text('선택 안 함','Not selected'))}</p>
          ${daily.calculationStatus === 'overlap-detected' ? `<p class="field-help">${text('시간이 겹친 활동 기록이 있어 합산을 보류했어요.','Totals are on hold because activity times overlap.')}</p>` : ''}
        </section>
        <div class="activity-front-actions">
          <button type="button" class="primary-button" data-activity-manual aria-haspopup="dialog" aria-controls="workout-dialog">${text('운동 칼로리 입력','Log exercise calories')}</button>
          <p class="field-help" id="activity-connection-note">${hasNative
            ? text('건강 앱 읽기를 허용하면 활동 기록을 가져올 수 있어요.','Allow read access to import activity from Apple Health.')
            : text('웹앱에서는 건강 앱을 자동으로 읽을 수 없어요. 파일이나 아이폰 단축어로 가져올 수 있어요.','This web app cannot directly access health apps. Import a file or use an iPhone shortcut.')}</p>
        </div>
        <details id="activity-import" class="activity-group" ${wasOpen('activity-import')}>
          <summary><span><strong>${text('건강 기록 가져오기','Import health activity')}</strong><small>${text('파일 또는 아이폰 단축어','File or iPhone shortcut')}</small></span></summary>
          <div class="activity-group-body">
            <div class="data-actions">
              <button type="button" id="activity-native" class="outline-button" ${hasNative ? '' : 'hidden disabled'}>${text('건강 앱에서 읽기','Refresh Apple Health')}</button>
              <button type="button" id="activity-choose-file" class="outline-button">${text('파일 선택','Choose file')}</button>
              <input id="activity-file" type="file" accept=".xml,.json" hidden>
            </div>
            <p class="field-help">${text('건강 앱에서 내보낸 XML이나 활동 백업 JSON을 선택하세요. 최대 20MB까지 가져올 수 있어요.','Choose an Apple Health XML export or an activity JSON backup, up to 20 MB.')}</p>
            <details id="activity-transfer" ${wasOpen('activity-transfer')}>
              <summary>${text('아이폰 단축어 붙여넣기','Paste from iPhone Shortcuts')}</summary>
              <p class="field-help">${text('단축어에서 복사한 활동 기록을 붙여넣으세요. 미리보기에서 확인한 뒤 가져올 수 있어요.','Paste the activity records copied from a shortcut. Review the preview before you import.')}</p>
              <button type="button" id="activity-read-clipboard" class="outline-button">${text('클립보드에서 읽기','Read clipboard')}</button>
              <label for="activity-paste">${text('활동 데이터 (JSON)','Activity data (JSON)')}</label>
              <textarea id="activity-paste" rows="4" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
              <div class="data-actions">
                <button type="button" id="activity-preview-transfer" class="outline-button">${text('미리보기','Preview data')}</button>
                <button type="button" id="activity-confirm-transfer" class="primary-button" hidden>${text('확인한 활동 가져오기','Confirm activity import')}</button>
              </div>
              <p id="activity-transfer-preview" class="field-help" role="status"></p>
              <details id="activity-transfer-help" class="transfer-help" ${wasOpen('activity-transfer-help')}>
                <summary>${text('단축어 설정 방법','Shortcut setup')}</summary>
                <ol>
                  <li>${text('단축어 앱에서 건강 샘플 찾기를 추가하세요. 활동 에너지와 출처 하나를 선택하고 최근 기록으로 범위를 좁히세요.','In Shortcuts, add Find Health Samples. Choose active energy, one source, and a recent date range.')}</li>
                  <li>${text('각 기록을 아래 JSON 형식의 사전으로 만들어 목록에 모으세요. 시작·종료는 시간대가 포함된 ISO 8601 형식으로 입력하세요.','Build a dictionary for each record in the format below. Use ISO 8601 times with a time zone for start and end.')}</li>
                  <li>${text('전체 사전을 JSON 텍스트로 바꿔 복사하세요. 여기에서 붙여넣고 미리보기를 확인하세요.','Copy the entire dictionary as JSON. Paste it here and review the preview.')}</li>
                </ol>
                <pre>{"format":"dansik-shortcuts-v1","samples":[{"id":"${text('기록 ID','record ID')}","source":"${text('출처','source')}","type":"active-energy","start":"2026-11-06T08:00:00+09:00","end":"2026-11-06T08:30:00+09:00","value":120,"unit":"kcal"}]}</pre>
              </details>
            </details>
          </div>
        </details>
        <details id="activity-calculation" class="activity-group" ${wasOpen('activity-calculation')}>
          <summary><span><strong>${text('칼로리 계산 기준','Calorie calculation')}</strong><small>${text('기초대사량과 기록된 활동','Basal energy and recorded activity')}</small></span></summary>
          <div class="activity-group-body">
            <label for="activity-source">${text('합산할 활동 출처','Activity source to include')}</label>
            <select id="activity-source">${chooseSource}</select>
            <p class="field-help">${text('활동은 선택한 출처 하나만 합산해요. 걸음 수는 참고용으로 표시해요.','Only the selected source is counted. Step totals are for reference.')}</p>
            <p id="activity-basis" class="field-help">${text('하루 소비와 단식 구간 모두 기초대사량에 선택한 활동 기록을 더해 계산해요.','Daily and fasting totals both use basal energy plus records from the selected activity source.')}</p>
            <button type="button" class="outline-button" id="activity-apply">${text('계산 기준 저장','Save calculation settings')}</button>
            ${healthSteps?.date === C.localDay(now) ? `<p class="field-help">${text('아이폰 건강 앱의 오늘 걸음','Today’s Apple Health steps')} · ${number.format(healthSteps.steps)}</p>` : ''}
          </div>
        </details>
        <details id="activity-management" class="activity-group" ${wasOpen('activity-management')}>
          <summary><span><strong>${text('활동 기록 관리','Manage activity records')}</strong><small>${text('백업과 삭제','Backup and deletion')} · ${number.format(samples.length)} ${text('개 기록','records')}</small></span></summary>
          <div class="activity-group-body">
            <p class="field-help">${text('활동 기록은 식사 기록과 별도로 백업돼요.','Activity and meal records are backed up separately.')}</p>
            <button type="button" class="outline-button" id="activity-export">${text('활동 JSON 백업','Export activity JSON')}</button>
            <label for="activity-delete-source">${text('삭제할 활동 출처','Source to delete')}</label>
            <select id="activity-delete-source">${chooseSource}</select>
            <div class="data-actions">
              <button type="button" class="danger-button" id="activity-clear">${text('선택한 활동 기록 삭제','Delete selected activity')}</button>
              <button type="button" class="outline-button" id="activity-cancel-clear" hidden>${text('삭제 취소','Cancel deletion')}</button>
            </div>
          </div>
        </details>
      </div>
      <p class="activity-scroll-cue" id="activity-scroll-cue" role="note" hidden><span aria-hidden="true">↓</span>${text('아래에 더 있는 항목을 보려면 스크롤하세요.','Scroll to see more options below.')}</p>
      <footer class="activity-footer">
        <p id="activity-status" role="status" aria-live="polite"></p>
        <button type="button" class="outline-button" id="activity-done">${text('완료','Done')}</button>
      </footer>`;
    const body = content.querySelector('.activity-body');
    const scrollCue = content.querySelector('#activity-scroll-cue');
    const updateScrollCue = () => {
      const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
      const canScroll = maxScroll > 2;
      const atEnd = body.scrollTop >= maxScroll - 2;
      const showCue = canScroll && !atEnd;
      scrollCue.hidden = !showCue;
      dialog.toggleAttribute('data-activity-scrollable', showCue);
    };
    body.scrollTop = previousScroll;
    body.addEventListener('scroll', updateScrollCue, { passive: true });
    content.querySelectorAll('details').forEach(details => details.addEventListener('toggle', () => requestAnimationFrame(updateScrollCue)));
    activityScrollObserver?.disconnect();
    if (window.ResizeObserver) {
      activityScrollObserver = new ResizeObserver(updateScrollCue);
      activityScrollObserver.observe(body);
    }
    requestAnimationFrame(updateScrollCue);
    if (previousFocus && previousFocus !== 'activity-confirm-transfer') {
      document.getElementById(previousFocus)?.focus({ preventScroll: true });
    } else if (previousFocus === 'activity-confirm-transfer') {
      content.querySelector('#activity-transfer > summary')?.focus({ preventScroll: true });
    }
    document.getElementById('activity-source').value = p.activitySource || '';
    document.getElementById('activity-close').onclick = ()=>dialog.close();
    document.getElementById('activity-done').onclick = () => dialog.close();
    document.getElementById('activity-apply').onclick = async()=>{try{const activitySource=document.getElementById('activity-source').value;await save({activitySource,...(!activitySource&&p.energyMode==='activity'?{energyMode:'estimate'}:{})});await render();status(text('적용했어요.','Applied.'));}catch(e){status(e.message);}};
    document.getElementById('activity-native').onclick = ()=>syncHealth();
    document.getElementById('activity-choose-file').onclick = () => document.getElementById('activity-file').click();
    let transfer = null;
    const paste = document.getElementById('activity-paste');
    const preview = document.getElementById('activity-transfer-preview');
    const confirmTransfer = document.getElementById('activity-confirm-transfer');
    function invalidateTransfer() { transfer=null;confirmTransfer.hidden=true;preview.textContent=''; }
    paste.addEventListener('input',invalidateTransfer);
    document.getElementById('activity-read-clipboard').onclick = async()=>{
      invalidateTransfer();
      try {
        if(!navigator.clipboard?.readText)throw Error('clipboard unavailable');
        const value=await navigator.clipboard.readText();
        if(value.length>20*1024*1024)throw Error('clipboard too large');
        paste.value=value;
        preview.textContent=text('읽었어요. 내용을 확인하고 미리보기를 누르세요. 아직 저장하지 않았어요.','Clipboard loaded. Check the content and preview it. Nothing has been saved.');
      }catch(_){preview.textContent=text('클립보드를 읽지 못했어요. 입력 칸을 길게 눌러 직접 붙여넣으세요.','Cannot read clipboard. Paste into the text field manually.');}
    };
    document.getElementById('activity-preview-transfer').onclick = ()=>{
      invalidateTransfer();
      try {
        const parsed=A.parseTransfer(paste.value);
        if(!parsed.length)throw Error(text('활동 에너지 기록이 없어요.','No active-energy records.'));
        const range=parsed.reduce((r,s)=>({start:Math.min(r.start,s.start),end:Math.max(r.end,s.end)}),{start:Infinity,end:-Infinity});
        const sources=[...new Set(parsed.map(s=>s.source))];
        transfer=parsed;
        const sourceSummary=sources.slice(0,3).join(', ')+(sources.length>3?` (+${sources.length-3})`:'');
        preview.textContent=`${parsed.length} ${text('개 기록','records')} · ${local(range.start)} → ${local(range.end)} · ${sourceSummary} · ${text('기존 기록과 중복은 병합하며 출처 하나만 계산해요.','Duplicates merge with existing records; only one source is used for energy.')}`;
        confirmTransfer.hidden=false;
      }catch(error){preview.textContent=error.message;}
    };
    confirmTransfer.onclick=async()=>{
      if(!transfer)return;
      const parsed=transfer;
      transfer=null;confirmTransfer.hidden=true;
      try{await importSamples(parsed);}catch(error){preview.textContent=error.message;}
    };
    document.getElementById('activity-file').onchange = async e=>{
      try {const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw Error(text('파일은 20MB 이하여야 해요.','File must be 20 MB or smaller.'));
        const body=await file.text();let incoming;
        if(file.name.toLowerCase().endsWith('.xml')){
          const xml=new DOMParser().parseFromString(body,'application/xml');if(xml.querySelector('parsererror'))throw Error(text('XML 형식을 확인해 주세요.','Invalid XML.'));
          incoming=[...xml.querySelectorAll('Record')].filter(r=>r.getAttribute('type')==='HKQuantityTypeIdentifierActiveEnergyBurned').map(r=>{
            const g=n=>r.getAttribute(n)||'',start=Date.parse(g('startDate')),end=Date.parse(g('endDate')),unit=g('unit');
            if(!['kcal','kJ','J','cal'].includes(unit))throw Error('Unsupported energy unit');
            let hash=2166136261;for(const c of g('device'))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
            return {id:[g('startDate'),g('endDate'),g('creationDate')].join('|'),source:'apple-export:'+g('sourceName').slice(0,100)+':'+hash,start,end,kcal:Number(g('value'))*({kcal:1,kJ:1/4.184,J:1/4184,cal:1/1000}[unit])};
          });
        } else incoming=A.parseTransfer(body);
        await importSamples(incoming);
      }catch(error){status(error.message);}
    };
    document.getElementById('activity-export').onclick = ()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({version:1,samples:p.activitySamples||[]},null,2)],{type:'application/json'}));a.href=url;a.download='dansik-activity.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const deleteSource = document.getElementById('activity-delete-source');
    const clear = document.getElementById('activity-clear');
    const cancelClear = document.getElementById('activity-cancel-clear');
    deleteSource.value = p.activitySource || '';
    let deletionSource = null;
    function resetDeletion() {
      deletionSource = null;
      clear.textContent = text('선택한 활동 기록 삭제','Delete selected activity');
      clear.disabled = !deleteSource.value;
      cancelClear.hidden = true;
    }
    resetDeletion();
    deleteSource.onchange = () => { resetDeletion(); status(''); };
    cancelClear.onclick = () => { resetDeletion(); status(''); clear.focus(); };
    clear.onclick = async () => {
      try {
        const source = deleteSource.value;
        if (!source) return;
        if (deletionSource !== source) {
          deletionSource = source;
          clear.textContent = text('삭제 확인','Confirm deletion');
          cancelClear.hidden = false;
          status(text(`‘${sourceName(source)}’ 활동 기록을 삭제할까요? 식사 기록은 유지돼요.`, `Delete activity records from “${sourceName(source)}”? Meal records stay unchanged.`));
          return;
        }
        clear.disabled = cancelClear.disabled = deleteSource.disabled = true;
        await saveActivity({ type: 'activity-remove', source });
        await render();
        status(text('선택한 출처를 삭제했어요.','Selected source deleted.'));
        dialog.querySelector('#activity-management > summary')?.focus({ preventScroll: true });
      } catch (error) {
        cancelClear.disabled = deleteSource.disabled = false;
        resetDeletion();
        status(error.message);
      }
    };
  }
  async function importSamples(incoming) {
    if (!incoming.length) throw Error(text('활동 에너지 기록이 없거나 읽기 권한이 없어요.','No active-energy records, or no read access.'));
    await saveActivity({ type: 'activity-add', samples: incoming });
    await render();
    status(text('가져왔어요. 출처를 선택한 뒤 계산 방식을 적용하세요.','Imported. Select a source and apply the calculation mode.'));
  }

  function showWorkoutResult(title, message) {
    const content = document.getElementById('workout-content');
    content.innerHTML = `<header class="dialog-heading">
      <h2 id="workout-title" tabindex="-1"></h2>
    </header><p class="workout-result" role="status"></p>
    <div class="dialog-actions"><button type="button" class="primary-button" id="workout-done">${text('확인','Done')}</button></div>`;
    content.querySelector('h2').textContent = title;
    content.querySelector('.workout-result').textContent = message;
    content.querySelector('#workout-done').onclick = () => workoutDialog.close();
    if (!workoutDialog.open) workoutDialog.showModal();
    workoutDialog.scrollTop = 0;
    content.querySelector('h2').focus({ preventScroll: true });
  }

  function workoutInclusion(sample, prefs, now) {
    if (prefs.activitySource !== 'manual') {
      return text('현재 다른 활동 출처를 사용 중이에요. 활동·건강 데이터에서 ‘직접 기록’을 선택하면 반영돼요.',
        'Your totals use another source. Select Manual records in Activity & health data to include this workout.');
    }
    const zone = prefs.timeZone;
    const date = C.localDay(sample.end - 1, zone);
    if (C.localDay(sample.start, zone) !== date) {
      return text('자정을 넘긴 운동을 저장했어요. 이 기록은 날짜별 소비 칼로리 합계에는 포함되지 않아요.',
        'The workout crosses midnight, so it is saved but excluded from the daily calorie totals.');
    }
    const daily = forDay(date, prefs, now);
    if (daily.calculationStatus === 'overlap-detected') {
      return text('같은 날의 활동 기록이 겹쳐 있어 소비 칼로리 합계는 보류 중이에요.',
        'The daily calorie total is unavailable because activity records for that day overlap.');
    }
    return date === C.localDay(now, zone)
      ? text('오늘 소비 칼로리에 반영했어요.', 'Included in today’s calories burned.')
      : text(`${date} 소비 칼로리에 반영했어요.`, `Included in calories burned for ${date}.`);
  }

  async function openWorkout(button) {
    if (workoutOpening || workoutDialog.open) return;
    workoutOpening = true;
    workoutOpener = button;
    try {
      const current = await window.desktop.getState();
      const zone = current.prefs.timeZone === 'auto' ? undefined : current.prefs.timeZone;
      const content = document.getElementById('workout-content');
      content.innerHTML = `<form id="activity-manual">
        <header class="dialog-heading">
          <h2 id="workout-title" tabindex="-1">${text('운동 칼로리 입력','Log exercise calories')}</h2>
          <button type="button" class="icon-button" id="workout-close" aria-label="${text('닫기','Close')}">✕</button>
        </header>
        <div class="workout-body">
        <label for="activity-kcal">${text('활동 칼로리','Active calories')}</label>
        <div class="workout-kcal"><input id="activity-kcal" type="number" inputmode="decimal" required min="0" max="100000" step="0.1" aria-describedby="workout-kcal-help"><span aria-hidden="true">kcal</span></div>
        <p class="field-help" id="workout-kcal-help">${text('운동 앱의 활동 칼로리(kcal)를 입력하세요. 휴식 칼로리는 제외해요.','Enter active kcal from your exercise app, excluding resting calories.')}</p>
        <div class="workout-end">
          <div><span>${text('운동 종료','Finished')}</span><strong id="workout-end-summary"></strong></div>
          <button type="button" class="outline-button" id="workout-end-toggle" aria-controls="workout-end-edit" aria-expanded="false">${text('시간 변경','Change time')}</button>
        </div>
        <div id="workout-end-edit" hidden>
          <label for="activity-end">${text('종료 날짜와 시간','Finish date and time')}</label>
          <input id="activity-end" type="datetime-local">
          <button type="button" class="text-button" id="workout-use-now">${text('방금으로 설정','Set to now')}</button>
        </div>
        <fieldset class="workout-duration">
          <legend>${text('운동한 시간','Workout duration')}</legend>
          <div class="workout-presets">
            ${[15, 30, 60, 'custom'].map(value => `<label class="workout-preset"><input type="radio" name="workout-duration" value="${value}"><span>${value === 'custom' ? text('직접','Custom') : text(`${value}분`, `${value} min`)}</span></label>`).join('')}
          </div>
          <div id="workout-custom-wrap" hidden>
            <label for="workout-custom">${text('운동 시간 (분)','Duration (minutes)')}</label>
            <input id="workout-custom" type="number" inputmode="numeric" min="1" max="1440" step="1" required disabled>
          </div>
        </fieldset>
        <p id="workout-range" class="field-help" aria-live="polite" hidden></p>
        <details class="workout-optional">
          <summary>${text('걸음 수 추가 (선택)','Add steps (optional)')}</summary>
          <label for="activity-steps">${text('걸음 수','Steps')}</label>
          <input id="activity-steps" type="number" inputmode="numeric" min="0" max="1000000" step="1">
        </details>
        <p id="workout-error" class="form-error" role="alert" hidden></p>
        </div>
        <footer class="dialog-actions">
          <button type="button" class="outline-button" id="workout-cancel">${text('취소','Cancel')}</button>
          <button type="submit" class="primary-button" id="workout-save">${text('저장','Save')}</button>
        </footer>
      </form>`;
      const find = selector => content.querySelector(selector);
      const form = find('form'), kcal = find('#activity-kcal'), finish = find('#activity-end');
      const custom = find('#workout-custom'), customWrap = find('#workout-custom-wrap');
      const endSummary = find('#workout-end-summary'), rangeSummary = find('#workout-range'), error = find('#workout-error');
      const endToggle = find('#workout-end-toggle'), endEdit = find('#workout-end-edit');
      const submit = find('#workout-save'), closeButtons = [find('#workout-close'), find('#workout-cancel')];
      const clock = new Intl.DateTimeFormat(document.documentElement.lang, { hour: 'numeric', minute: '2-digit', timeZone: zone });
      const dateLabel = new Intl.DateTimeFormat(document.documentElement.lang, { month: 'short', day: 'numeric', timeZone: zone });
      const finishText = at => C.localDay(at, zone) === C.localDay(Date.now(), zone)
        ? text(`오늘 ${clock.format(at)}`, `Today, ${clock.format(at)}`)
        : `${dateLabel.format(at)} ${clock.format(at)}`;
      let nowPreset = null;
      const finishNow = () => {
        nowPreset = Math.floor(Date.now() / 60000) * 60000;
        finish.value = C.formatLocalInput(nowPreset, zone);
      };
      const finishTime = () => nowPreset ?? C.parseLocalInput(finish.value, zone);
      const validFinish = at => Number.isFinite(at) && C.formatLocalInput(at, zone) === finish.value;
      const minutes = () => {
        const selected = find('input[name="workout-duration"]:checked');
        if (!selected) return NaN;
        return selected.value === 'custom' ? custom.valueAsNumber : Number(selected.value);
      };
      function update() {
        const usingCustom = find('input[name="workout-duration"]:checked')?.value === 'custom';
        customWrap.hidden = custom.disabled = !usingCustom;
        const end = finishTime();
        const duration = minutes();
        endSummary.textContent = validFinish(end) ? finishText(end) : text('시간을 확인해 주세요','Check the time');
        rangeSummary.hidden = !validFinish(end) || !Number.isInteger(duration) || duration < 1 || duration > 1440;
        if (!rangeSummary.hidden) {
          rangeSummary.textContent = `${finishText(end - duration * 60000)} → ${clock.format(end)}`;
        }
      }
      function setEndEditor(open) {
        endEdit.hidden = !open;
        endToggle.setAttribute('aria-expanded', String(open));
      }
      function setError(message) {
        error.hidden = !message;
        error.textContent = message;
      }
      closeButtons.forEach(button => { button.onclick = () => workoutDialog.close(); });
      endToggle.onclick = () => setEndEditor(endEdit.hidden);
      find('#workout-use-now').onclick = () => { finishNow(); setEndEditor(false); update(); endToggle.focus(); };
      finish.addEventListener('input', () => { nowPreset = null; });
      form.addEventListener('input', () => { setError(''); update(); });
      form.addEventListener('change', update);
      form.addEventListener('invalid', event => {
        if (event.target.id === 'activity-steps') event.target.closest('details').open = true;
      }, true);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (workoutSaving) return;
        const now = Date.now(), end = finishTime(), duration = minutes();
        if (!validFinish(end) || end > now) {
          setEndEditor(true);
          setError(text('현재 시각 이전의 올바른 종료 시각을 선택해 주세요.','Choose a valid finish time no later than now.'));
          finish.focus();
          return;
        }
        if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
          setError(text('운동한 시간을 선택해 주세요.','Select how long you exercised.'));
          find('input[name="workout-duration"]').focus();
          return;
        }
        const start = end - duration * 60000;
        const sample = { id: `manual:${start}:${end}`, source: 'manual', start, end, kcal: kcal.valueAsNumber };
        const steps = find('#activity-steps').valueAsNumber;
        if (Number.isFinite(steps)) sample.steps = steps;
        workoutSaving = submit.disabled = true;
        closeButtons.forEach(button => { button.disabled = true; });
        submit.textContent = text('저장 중…','Saving…');
        try {
          const result = await saveActivity({ type: 'activity-add', samples: [sample], manual: true });
          const message = workoutInclusion(sample, result.prefs, now);
          showWorkoutResult(text('운동 기록을 저장했어요','Exercise saved'), message);
          if (dialog.open) {
            try {
              await render();
              status(text('운동 기록을 저장했어요.','Exercise saved.'));
            } catch (_) { /* The save already succeeded. */ }
          }
        } catch (cause) {
          setError(cause.message);
        } finally {
          workoutSaving = submit.disabled = false;
          closeButtons.forEach(button => { button.disabled = false; });
          submit.textContent = text('저장','Save');
        }
      });
      finishNow();
      update();
      workoutDialog.showModal();
      workoutDialog.scrollTop = 0;
      find('h2').focus({ preventScroll: true });
    } catch (error) {
      showWorkoutResult(text('운동 입력을 열지 못했어요','Could not open workout entry'), error.message);
    } finally { workoutOpening = false; }
  }
  async function syncHealth() {
    if(syncing||!window.nativeHealth?.available)return;
    syncing=true;
    try {
      const id=window.crypto?.randomUUID ? window.crypto.randomUUID() : `health-${Date.now()}-${Math.random().toString(16).slice(2)}`,now=Date.now();
      const samples=await new Promise((resolve,reject)=>{
        const handler=e=>{if(e.detail?.id!==id)return;cleanup();if(e.detail.ok){healthSteps=Number.isSafeInteger(e.detail.stepsToday)&&e.detail.stepsToday>=0?{steps:e.detail.stepsToday,date:e.detail.stepsDate}:null;resolve(e.detail.samples);}else reject(Error(e.detail.error||'Health read failed'));};
        const timeout=setTimeout(()=>{cleanup();reject(Error(text('건강앱 읽기 시간이 초과됐어요.','Health read timed out.')));},60000);
        function cleanup(){clearTimeout(timeout);window.removeEventListener('dansik-health-result',handler);}
        window.addEventListener('dansik-health-result',handler);
        try {window.webkit.messageHandlers.health.postMessage({id,action:'read',from:now-7*86400000,to:now});}catch(error){cleanup();reject(error);}
      });
      if (!samples.length) { await render(); status(text('활동 에너지 자료가 없어요. 걸음 수는 별도로 표시하며 칼로리로 중복 환산하지 않아요.','No active-energy data. Steps are shown separately without converting them to calories.')); }
      else await importSamples(samples);
    }catch(error){if(dialog.open)status(error.message);}finally{syncing=false;}
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-open-activity], [data-activity-manual]');
    if (!button) return;
    if (button.hasAttribute('data-activity-manual') && workoutDialog) {
      openWorkout(button);
      return;
    }
    opener = button;
    await render();
    if (!dialog.open) {
      dialog.showModal();
      document.getElementById('activity-title')?.focus({ preventScroll: true });
    }
  });
  dialog.addEventListener('close',()=>{activityScrollObserver?.disconnect();if(opener?.isConnected)opener.focus({preventScroll:true});});
  workoutDialog?.addEventListener('cancel', event => { if (workoutSaving) event.preventDefault(); });
  workoutDialog?.addEventListener('close', () => {
    const target = workoutOpener?.isConnected ? workoutOpener : dialog.querySelector('[data-activity-manual]');
    target?.focus({ preventScroll: true });
    workoutOpener = null;
  });
  window.addEventListener('focus',async()=>{const s=await window.desktop.getState();if(s.prefs.activitySource?.startsWith('apple-health:'))syncHealth();});
})();
