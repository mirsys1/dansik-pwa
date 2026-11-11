(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FastingQr = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // Small QR Code encoder: byte mode, error correction level M, versions 1-5 (up to 84 bytes).
  // That is plenty for a sync-code link, and it keeps the encoder short enough to review.
  // The algorithm follows the QR Code (ISO/IEC 18004) layout; tests/qr.test.cjs decodes every
  // output with jsQR, so a wrong table or mask shows up as a failed read.
  const LEVEL_M_FORMAT = 0;
  const VERSIONS = {
    1: { ec: 10, blocks: [[1, 16]], align: [] },
    2: { ec: 16, blocks: [[1, 28]], align: [6, 18] },
    3: { ec: 26, blocks: [[1, 44]], align: [6, 22] },
    4: { ec: 18, blocks: [[2, 32]], align: [6, 26] },
    5: { ec: 24, blocks: [[2, 43]], align: [6, 30] }
  };

  // GF(256) with the QR polynomial 0x11D
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function divisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let rootPower = 1;
    for (let i = 0; i < degree; i += 1) {
      for (let j = 0; j < degree; j += 1) {
        result[j] = gfMul(result[j], rootPower);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      rootPower = gfMul(rootPower, 2);
    }
    return result;
  }
  function remainder(data, degree) {
    const gen = divisor(degree);
    const result = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      gen.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  function utf8(text) { return Array.from(new TextEncoder().encode(text)); }
  function pickVersion(length) {
    for (const version of Object.keys(VERSIONS).map(Number)) {
      const capacity = VERSIONS[version].blocks.reduce((sum, [count, size]) => sum + count * size, 0);
      if (length * 8 + 12 <= capacity * 8) return version;
    }
    throw new RangeError('QR_TOO_LONG');
  }
  function dataCodewords(bytes, version) {
    const config = VERSIONS[version];
    const capacity = config.blocks.reduce((sum, [count, size]) => sum + count * size, 0) * 8;
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    push(0b0100, 4); push(bytes.length, 8);
    bytes.forEach((byte) => push(byte, 8));
    push(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    return words;
  }
  function interleave(words, version) {
    const config = VERSIONS[version];
    const blocks = [];
    let offset = 0;
    for (const [count, size] of config.blocks) {
      for (let i = 0; i < count; i += 1) {
        const data = words.slice(offset, offset + size); offset += size;
        blocks.push({ data, ecc: remainder(data, config.ec) });
      }
    }
    const out = [];
    for (let i = 0; i < Math.max(...blocks.map((b) => b.data.length)); i += 1) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < config.ec; i += 1) blocks.forEach((b) => out.push(b.ecc[i]));
    return out;
  }

  function build(version, codewords) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; fixed[y][x] = true; };
    for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const positions = VERSIONS[version].align;
    positions.forEach((py, i) => positions.forEach((px, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const formatBits = (mask) => {
      const data = (LEVEL_M_FORMAT << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    formatBits(0);
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) for (let j = 0; j < 2; j += 1) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fixed[y][x] && index < codewords.length * 8) { modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0; index += 1; }
      }
    }
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    ];
    const applyMask = (mask) => { for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!fixed[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x]; };
    let best = 0, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      applyMask(mask); formatBits(mask);
      const score = penalty(modules);
      if (score < bestScore) { best = mask; bestScore = score; }
      applyMask(mask);
    }
    applyMask(best); formatBits(best);
    return { size, modules, mask: best };
  }

  function penalty(modules) {
    const size = modules.length;
    let score = 0, dark = 0;
    const lines = [];
    for (let y = 0; y < size; y += 1) { lines.push(modules[y]); lines.push(modules.map((row) => row[y])); }
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i += 1) {
        if (i < size && line[i] === line[i - 1]) run += 1;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      const text = line.map((m) => (m ? '1' : '0')).join('');
      for (const pattern of ['10111010000', '00001011101']) for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) score += 40;
    }
    for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
    }
    modules.forEach((row) => row.forEach((m) => { if (m) dark += 1; }));
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  }

  function encode(text) {
    const bytes = utf8(String(text));
    const version = pickVersion(bytes.length);
    const matrix = build(version, interleave(dataCodewords(bytes, version), version));
    return { version, size: matrix.size, modules: matrix.modules, mask: matrix.mask };
  }

  // Vector output: crisp at any size and one <path>, so it prints and zooms cleanly.
  function toSvg(code, { margin = 4, dark = '#111', light = '#fff' } = {}) {
    const total = code.size + margin * 2;
    let path = '';
    code.modules.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (!row[x]) continue;
        let end = x; while (end < row.length && row[end]) end += 1;
        path += `M${x + margin} ${y + margin}h${end - x}v1h-${end - x}z`;
        x = end;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img"><rect width="${total}" height="${total}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
  }

  // ───────── reading (browser only; needs the jsQR script)
  function decodePixels(data, width, height) {
    if (!root || typeof root.jsQR !== 'function') return null;
    const result = root.jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    return result ? result.data : null;
  }
  function readFrame(source, width, height, canvas, fraction, maxSize) {
    const side = Math.round(Math.min(width, height) * fraction);
    const cropWidth = fraction === 1 ? width : side, cropHeight = fraction === 1 ? height : side;
    const scale = Math.min(1, maxSize / Math.max(cropWidth, cropHeight));
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return decodePixels(pixels.data, pixels.width, pixels.height);
  }
  // Reads a QR code from a photo (resolves null when none is found).
  async function decodeFile(file) {
    if (!root || typeof root.jsQR !== 'function' || !file || file.size > 12 * 1024 * 1024) return null;
    try {
      // A data: URL, not a blob: URL: the page's img-src policy allows data: only.
      const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reader.onabort = reject; reader.readAsDataURL(file); });
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement('canvas');
      return readFrame(image, image.naturalWidth, image.naturalHeight, canvas, 1, 1600) || readFrame(image, image.naturalWidth, image.naturalHeight, canvas, 0.6, 1600);
    } catch (_) { return null; }
  }
  // Starts the rear camera in `video` and calls onResult(text) once for the first code seen.
  // Returns stop(). onError(reason) is called for permission problems or a 30 s timeout.
  async function startCamera(video, { onResult, onError, timeoutMs = 30000 }) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !root || typeof root.jsQR !== 'function') { onError('unsupported'); return () => {}; }
    let stopped = false, timer = null, stream = null;
    const stop = () => {
      stopped = true; clearTimeout(timer);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      video.pause(); video.srcObject = null;
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (_) { onError('permission'); return () => {}; }
    if (stopped) { stream.getTracks().forEach((track) => track.stop()); return stop; }
    video.srcObject = stream;
    const canvas = document.createElement('canvas');
    const deadline = Date.now() + timeoutMs;
    const read = () => {
      if (stopped) return;
      if (Date.now() >= deadline) { stop(); onError('timeout'); return; }
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        let text = null;
        try { text = readFrame(video, video.videoWidth, video.videoHeight, canvas, 0.95, 800); } catch (_) { stop(); onError('read'); return; }
        if (text) { stop(); onResult(text); return; }
      }
      timer = setTimeout(read, 220);
    };
    video.play().catch(() => {});
    read();
    return stop;
  }

  return { encode, toSvg, decodeFile, startCamera, decodePixels };
});
