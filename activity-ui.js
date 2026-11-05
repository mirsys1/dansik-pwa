(function () {
  'use strict';
  const A = window.FastingActivity, C = window.FastingCore;
  const text = (ko, en) => document.documentElement.lang === 'en' ? en : ko;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let snapshot, opener, syncing = false, healthSteps = null;
  function estimate(interval, prefs, allowActivity = true) {
    if (!interval || prefs.energyMode !== 'activity') return C.calculateCalories(interval?.durationMs ?? null, prefs);
    const result = A.estimate(allowActivity ? prefs.activitySamples || [] : [], interval.from, interval.to, prefs.activitySource || '', C.normalizeProfile(prefs), interval.durationMs);
    result.activityOmitted = !allowActivity;
    return result;
  }
  function describe(value, prefs) {
    if (prefs.energyMode !== 'activity') return '';
    const warning = value.activityOmitted ? text('중지 이력이 있어 활동 합산 제외','Activity excluded because paused windows are unknown') : value.calculationStatus === 'overlap-detected' ? text('겹친 활동 기록은 합산 제외','Overlapping activity excluded') : value.activeKcal == null ? text('활동 자료 없음 · 기초 소비만 표시','Activity missing · basal only') : text('기록된 활동만 포함 · 미기록 활동은 알 수 없음','Recorded activity only · unrecorded activity unknown');
    return `${text('기초','Basal')} ${Math.round(value.basalKcal || 0)} + ${text('활동','Activity')} ${value.activeKcal == null ? '—' : Math.round(value.activeKcal)} kcal · ${warning}${value.activity?.excludedBoundary ? text(' · 구간 경계에 걸친 기록 제외',' · boundary-crossing records excluded') : ''} · ${prefs.activitySource || text('출처 미선택','No source selected')}`;
  }
  window.FastingEnergy = { estimate, describe };
  const dialog = document.getElementById('activity-dialog');
  function local(at) { return C.formatLocalInput(at, snapshot.prefs.timeZone === 'auto' ? undefined : snapshot.prefs.timeZone); }
  function status(message) { document.getElementById('activity-status').textContent = message; }
  async function save(patch) {
    const result = await window.desktop.action({type:'prefs',patch});
    if (!result.ok) throw Error(result.error);
    snapshot = result;
    return result;
  }
  async function render() {
    snapshot = await window.desktop.getState();
    const p = snapshot.prefs, samples = p.activitySamples || [], sources = [...new Set(samples.map(x=>x.source))];
    const now = Date.now(), z = p.timeZone === 'auto' ? undefined : p.timeZone, d = C.tzParts(now,z);
    const start = C.parseLocalInput(`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}T00:00`,z);
    const today = A.estimate(samples,start,now,p.activitySource || '',C.normalizeProfile(p));
    document.getElementById('activity-content').innerHTML = `<div class="dialog-heading"><h2 id="activity-title">${text('활동·건강 데이터','Activity & health data')}</h2><button type="button" class="icon-button" id="activity-close" aria-label="${text('닫기','Close')}">✕</button></div>
      <p class="field-help">${window.nativeHealth?.available ? text('아이폰 건강에서 읽기 권한을 허용하면 활동 에너지를 가져와요.','Allow read access to import active energy from Apple Health.') : text('PWA는 건강앱에 직접 접근할 수 없어요. 건강 데이터 파일을 가져오거나 활동 소비량을 입력하세요. 자동 읽기는 HealthKit 연결 iOS 앱에서 지원해요.','PWA cannot directly access health apps. Import a health data file or enter active energy. Automatic reads require the HealthKit iOS app.')}</p>
      <label for="activity-mode">${text('소비량 계산 방식','Energy calculation')}</label><select id="activity-mode"><option value="estimate">${text('기존 신체·활동 수준 추정','Existing profile estimate')}</option><option value="activity">${text('기초대사량 + 기록된 활동','Basal energy + recorded activity')}</option></select>
      <label for="activity-source">${text('합산할 데이터 출처 한 개','One source to include')}</label><select id="activity-source"><option value="">${text('출처 선택','Select a source')}</option>${sources.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select><button type="button" class="primary-button" id="activity-apply">${text('계산 방식 적용','Apply calculation')}</button>
      <div class="activity-day"><strong>${text('오늘 0시부터 현재까지','Today, midnight to now')}</strong><p>${text('기초','Basal')} ${Math.round(today.basalKcal)} + ${text('활동','Activity')} ${today.activeKcal==null?'—':Math.round(today.activeKcal)} = <b>${today.totalKcal} kcal</b></p><p class="field-help">${esc(describe(today,{...p,energyMode:'activity'}))}</p><p class="field-help">${text('단식 구간의 소비량과는 별도예요. 선택한 출처의 기록만 포함하며 걸음 수를 다시 칼로리로 더하지 않아요.','Separate from fasting-interval energy. Includes only the selected source; steps are not added again as calories.')}</p></div>
      <p>${text('선택 출처의 오늘 걸음','Today’s steps from selected source')}: ${today.activity?.steps ?? '—'}${healthSteps?.date===C.localDay(now)?` · ${text('아이폰 건강(기기 날짜)','Apple Health (device date)')} ${esc(healthSteps.date)}: ${healthSteps.steps}`:''}</p>
      <p class="field-help">${samples.length} ${text('개 기록','records')} · ${text('활동 기록이 없거나 겹치면 합산에서 제외돼요. 하루 합계를 단식 시간에 비례 배분하지 않아요.','Missing or overlapping records are excluded. Daily totals are not prorated into fasting intervals.')}</p>
      <div class="data-actions"><button type="button" id="activity-native" class="outline-button" ${window.nativeHealth?.available?'':'disabled'}>${text('건강앱에서 새로 읽기','Refresh Apple Health')}</button><label class="outline-button" for="activity-file">${text('파일 가져오기','Import file')}</label><input id="activity-file" type="file" accept=".xml,.json" hidden><button type="button" class="outline-button" id="activity-export">${text('활동 백업','Export activity')}</button></div>
      <p class="field-help">${text('아이폰 건강 내보내기의 압축을 푼 export.xml 또는 이 앱의 활동 JSON(20MB 이하). 활동 에너지만 읽으며 식사 기록은 변경하지 않아요. 활동 기록은 식사 백업과 별도로 보관하세요.','Use unzipped Apple Health export.xml or this app’s activity JSON (up to 20 MB). Only active energy is read; meals stay unchanged. Back up activity separately from meals.')}</p>
      <details><summary>${text('활동 소비량 직접 기록','Enter active energy')}</summary><form id="activity-manual"><label for="activity-start">${text('시작','Start')}</label><input id="activity-start" type="datetime-local" required value="${local(now-3600000)}"><label for="activity-end">${text('종료','End')}</label><input id="activity-end" type="datetime-local" required value="${local(now)}"><label for="activity-kcal">${text('활동 칼로리(kcal) — 휴식 칼로리 제외','Active kcal — excludes resting energy')}</label><input id="activity-kcal" type="number" required min="0" max="100000" step="0.1"><label for="activity-steps">${text('걸음 수(참고용·선택)','Steps (context only, optional)')}</label><input id="activity-steps" type="number" min="0" max="1000000" step="1"><button class="primary-button" type="submit">${text('이 구간 기록','Save interval')}</button></form></details>
      <p id="activity-status" role="status" aria-live="polite"></p><button type="button" class="text-button" id="activity-clear">${text('선택한 출처 기록 삭제','Delete selected source')}</button>`;
    document.getElementById('activity-mode').value = p.energyMode || 'estimate';
    document.getElementById('activity-source').value = p.activitySource || '';
    document.getElementById('activity-close').onclick = ()=>dialog.close();
    document.getElementById('activity-apply').onclick = async()=>{try{await save({energyMode:document.getElementById('activity-mode').value,activitySource:document.getElementById('activity-source').value});await render();status(text('적용했어요.','Applied.'));}catch(e){status(e.message);}};
    document.getElementById('activity-native').onclick = ()=>syncHealth();
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
        } else {const parsed=JSON.parse(body);incoming=Array.isArray(parsed)?parsed:parsed.samples;}
        await importSamples(incoming);
      }catch(error){status(error.message);}
    };
    document.getElementById('activity-manual').onsubmit = async e=>{e.preventDefault();try{const start=C.parseLocalInput(document.getElementById('activity-start').value,z),end=C.parseLocalInput(document.getElementById('activity-end').value,z);if(end>Date.now())throw Error(text('미래의 활동은 기록할 수 없어요.','Future activity cannot be recorded.'));const sample={id:'manual:'+start+':'+end,source:'manual',start,end,kcal:Number(document.getElementById('activity-kcal').value)};const steps=document.getElementById('activity-steps').value;if(steps)sample.steps=Number(steps);await importSamples([sample]);}catch(error){status(error.message);}};
    document.getElementById('activity-export').onclick = ()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({version:1,samples:p.activitySamples||[]},null,2)],{type:'application/json'}));a.href=url;a.download='dansik-activity.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    let deletionSource = null;
    document.getElementById('activity-clear').onclick = async()=>{try{const source=document.getElementById('activity-source').value;if(!source)return;if(deletionSource!==source){deletionSource=source;status(text('선택 출처의 활동 기록을 지우려면 삭제 버튼을 한 번 더 누르세요. 식사 기록은 유지돼요.','Press delete again to remove the selected activity source. Meal records stay unchanged.'));return;}await save({activitySamples:samples.filter(s=>s.source!==source),activitySource:'',energyMode:'estimate'});await render();status(text('선택한 출처를 삭제했어요.','Selected source deleted.'));}catch(error){status(error.message);}};
  }
  async function importSamples(incoming) {
    const valid=A.normalizeSamples(incoming);if(!valid.length)throw Error(text('활동 에너지 기록이 없거나 읽기 권한이 없어요.','No active-energy records, or no read access.'));
    const current=await window.desktop.getState(), merged=A.mergeSamples(current.prefs.activitySamples||[],valid);
    await save({activitySamples:merged,activitySource:current.prefs.activitySource||valid[0].source});await render();status(text('가져왔어요. 출처를 선택한 뒤 계산 방식을 적용하세요.','Imported. Select a source and apply the calculation mode.'));
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
  document.addEventListener('click',async e=>{const button=e.target.closest('[data-open-activity]');if(!button)return;opener=button;await render();if(!dialog.open)dialog.showModal();});
  dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});
  window.addEventListener('focus',async()=>{const s=await window.desktop.getState();if(s.prefs.energyMode==='activity'&&s.prefs.activitySource?.startsWith('apple-health:'))syncHealth();});
})();
