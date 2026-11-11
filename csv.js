(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./core.js') : root.FastingCore,
    typeof require === 'function' ? require('./i18n.js') : root.FastingI18n
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingCsv = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Core, I18n) {
  'use strict';

// Core & I18n injected by UMD wrapper above.


// Files exported in either app language are accepted, so a backup survives a language change.
const HEADERS = [['식사 ID', '식사 종류', '시각 (ISO 8601)', '메모'], ['Meal ID', 'Meal type', 'Time (ISO 8601)', 'Note']];
const HEADER = HEADERS[0];
const TYPES = { 아침: 'breakfast', 점심: 'lunch', 저녁: 'dinner', 간식: 'snack', Breakfast: 'breakfast', Lunch: 'lunch', Dinner: 'dinner', Snack: 'snack' };
const MAX_CHARS = 64 * 1024 * 1024;

// row/detail let the UI rewrite the message in the active language.
function fail(row, message) { throw Object.assign(new TypeError(`${row}행: ${message}`), { row, detail: message }); }

function parseRows(text) {
  const rows = [];
  let row = [];
  let parts = [];
  let segment = 0;
  let quoted = false;
  let closed = false;
  let start = true;
  function finishField(end) {
    if (end > segment) parts.push(text.slice(segment, end));
    row.push(parts.length < 2 ? (parts[0] || '') : parts.join(''));
    parts = []; segment = end + 1; start = true; closed = false;
  }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (i > segment) parts.push(text.slice(segment, i));
        if (text[i + 1] === '"') { parts.push('"'); i += 1; segment = i + 1; }
        else { quoted = false; closed = true; segment = i + 1; }
      }
      continue;
    }
    if (closed) {
      if (ch === ',') { finishField(i); continue; }
      if (ch === '\r' || ch === '\n') {
        const end = i;
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        finishField(end); rows.push(row);
        if (rows.length > Core.MAX_EVENTS + 1) fail(rows.length, '식사 기록이 최대 개수(100,000건)를 넘어요.');
        row = []; segment = i + 1; continue;
      }
      fail(rows.length + 1, 'CSV 큰따옴표 형식이 올바르지 않습니다.');
    }
    if (start && ch === '"') { quoted = true; start = false; segment = i + 1; continue; }
    if (ch === '"') fail(rows.length + 1, 'CSV 큰따옴표 형식이 올바르지 않습니다.');
    if (ch === ',') { finishField(i); continue; }
    if (ch === '\r' || ch === '\n') {
      const end = i;
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      finishField(end); rows.push(row);
      if (rows.length > Core.MAX_EVENTS + 1) fail(rows.length, '식사 기록이 최대 개수(100,000건)를 넘어요.');
      row = []; segment = i + 1; continue;
    }
    start = false;
  }
  if (quoted) fail(rows.length + 1, 'CSV 큰따옴표 형식이 올바르지 않습니다.');
  if (!start || row.length) {
    finishField(text.length); rows.push(row);
    if (rows.length > Core.MAX_EVENTS + 1) fail(rows.length, '식사 기록이 최대 개수(100,000건)를 넘어요.');
  }
  return rows;
}

function undoFormulaPrefix(value) {
  if (value[0] !== "'") return value;
  const protectedValue = value.slice(1);
  return /^[\t\r\n]|^\s*[=+@\-]/.test(protectedValue) ? protectedValue : value;
}

function parseMealCsv(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length === 0) throw new TypeError('CSV 파일이 비어 있습니다.');
  if (text.length > MAX_CHARS) throw new TypeError('CSV 파일 크기가 올바르지 않습니다.');
  const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  if (source.length === 0) throw new TypeError('CSV 파일이 비어 있습니다.');
  const rows = parseRows(source);
  const header = rows[0];
  if (!header || !HEADERS.some(names => header.length === names.length && names.every((value, index) => value === header[index]))) fail(1, 'CSV 헤더가 올바르지 않습니다.');
  const events = [];
  const ids = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]; const rowNumber = i + 1;
    if (row.length !== HEADER.length) fail(rowNumber, 'CSV 열 개수가 올바르지 않습니다.');
    const id = undoFormulaPrefix(row[0]);
    const typeName = undoFormulaPrefix(row[1]);
    const type = Object.hasOwn(TYPES, typeName) ? TYPES[typeName] : undefined;
    const atText = undoFormulaPrefix(row[2]);
    const at = Date.parse(atText);
    const note = undoFormulaPrefix(row[3]);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(atText) || !Number.isSafeInteger(at) || new Date(at).toISOString() !== atText) fail(rowNumber, '식사 시각이 올바르지 않습니다.');
    if (at > now) fail(rowNumber, '식사 시각은 현재 시각보다 미래일 수 없습니다.');
    try { Core.validateEvent({ id, type, at, note }, now); }
    catch (error) { fail(rowNumber, error.message); }
    if (ids.has(id)) fail(rowNumber, '식사 기록 ID가 중복되었습니다.');
    ids.add(id); events.push({ id, type, at, note });
  }
  return events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\t\r\n]|^\s*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function toCsv(state, i18n = I18n.create('ko')) {
  return '\uFEFF' + [i18n.t('csv.header'), ...state.events.map(event => [event.id, i18n.meal(event.type), new Date(event.at).toISOString(), event.note])].map(row => row.map(csvCell).join(',')).join('\r\n');
}

  return { parseMealCsv, toCsv, csvCell, HEADERS };
});
