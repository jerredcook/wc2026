/* Cap Day QR codes: a small QR encoder, so the app can draw a code for a link it
   has just made (a score challenge) without sending that link to anyone's
   server or loading a library.

   Scope, on purpose: byte mode only, versions 1–10 (up to 271 bytes, far more
   than a challenge link needs), error correction M where it fits and L where it
   does not. Pure functions: no DOM, no network. Loaded by index.html as a plain
   script and by the tests through require().

   Checked against the widely used "qrcode" package (identical modules for every
   version, level and mask) and decoded back with a separate QR reader; the
   expected patterns in test/fixtures/qr-golden.json come from that check. */
"use strict";

const { qrMatrix, qrSvg } = (() => {
  /* ── Reed–Solomon over GF(256), polynomial 0x11d ── */
  const EXP = new Array(510), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = EXP[i + 255] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  }
  function remainder(data, n) {
    const g = generator(n), r = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ r.shift(); r.push(0);
      if (f) for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f);
    }
    return r;
  }

  /* ── Tables (ISO/IEC 18004), versions 1–10 ──
     Per level and version: [error-correction codewords per block,
     blocks in group 1, data codewords in each, blocks in group 2, data codewords in each]. */
  const BLOCKS = {
    M: [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
    L: [null, [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  };
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const LEVEL_BITS = { L: 1, M: 0 };
  const MAX_VERSION = 10;
  const dataCodewords = (v, lv) => { const b = BLOCKS[lv][v]; return b[1] * b[2] + b[3] * b[4]; };
  const capacity = (v, lv) => dataCodewords(v, lv) - (v < 10 ? 2 : 3);   // minus the mode and length header

  const utf8 = s => { const e = unescape(encodeURIComponent(String(s))), out = []; for (let i = 0; i < e.length; i++) out.push(e.charCodeAt(i)); return out; };

  /* The data codewords: mode, length, the bytes, a terminator and padding. */
  function encodeData(bytes, v, lv) {
    const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const total = dataCodewords(v, lv) * 8;
    put(0, Math.min(4, total - bits.length));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; out.length < total / 8; pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }

  /* Split into blocks, add error correction to each, and interleave. */
  function withErrorCorrection(data, v, lv) {
    const [ec, n1, d1, n2, d2] = BLOCKS[lv][v], blocks = [];
    let at = 0;
    for (let i = 0; i < n1 + n2; i++) { const len = i < n1 ? d1 : d2, d = data.slice(at, at + len); at += len; blocks.push({ d, e: remainder(d, ec) }); }
    const out = [];
    for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
    return out;
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  /* The symbol with everything except the data: finder, timing and alignment
     patterns, and the reserved format and version areas. `fn` marks those cells. */
  function blank(v) {
    const size = 17 + 4 * v;
    const m = Array.from({ length: size }, () => new Uint8Array(size)), fn = Array.from({ length: size }, () => new Uint8Array(size));
    const set = (r, c, dark) => { if (r >= 0 && r < size && c >= 0 && c < size) { m[r][c] = dark ? 1 : 0; fn[r][c] = 1; } };
    const finder = (r0, c0) => { for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) { const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3)); set(r0 + dr, c0 + dc, ring !== 2 && ring !== 4); } };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const a = ALIGN[v];
    for (const r of a) for (const c of a) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, 0); if (!fn[i][8]) set(i, 8, 0); }          // format areas, filled in later
    for (let i = 0; i < 8; i++) { set(8, size - 1 - i, 0); set(size - 1 - i, 8, 0); }
    set(size - 8, 8, 1);                                                                               // the always-dark module
    if (v >= 7) {
      let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const bit = (bits >>> i) & 1, p = size - 11 + (i % 3), q = Math.floor(i / 3); set(q, p, bit); set(p, q, bit); }
    }
    return { size, m, fn };
  }

  function placeData(sym, codewords) {
    const { size, m, fn } = sym;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                                    // the vertical timing column is skipped
      for (let n = 0; n < size; n++) {
        const up = ((right + 1) & 2) === 0, r = up ? size - 1 - n : n;
        for (const c of [right, right - 1]) {
          if (fn[r][c]) continue;
          m[r][c] = i < codewords.length * 8 ? (codewords[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
          i++;
        }
      }
    }
  }

  function writeFormat(sym, lv, mask) {
    const { size, m } = sym, data = (LEVEL_BITS[lv] << 3) | mask;
    let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412, bit = i => (bits >>> i) & 1;
    for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
  }

  /* How hard a symbol is to read: lower is better (the standard's four rules). */
  function penalty(sym) {
    const { size, m } = sym;
    let p = 0, dark = 0;
    const line = get => {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && get(i) === get(i - 1)) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      for (let i = 0; i + 10 < size; i++) {
        const s = k => get(i + k);
        const core = k => s(k) && !s(k + 1) && s(k + 2) && s(k + 3) && s(k + 4) && !s(k + 5) && s(k + 6);
        if (core(0) && !s(7) && !s(8) && !s(9) && !s(10)) p += 40;
        if (!s(0) && !s(1) && !s(2) && !s(3) && core(4)) p += 40;
      }
    };
    for (let r = 0; r < size; r++) { line(i => m[r][i]); line(i => m[i][r]); }
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      dark += m[r][c];
      if (r + 1 < size && c + 1 < size && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
    }
    return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  }

  /* text → { version, level, mask, size, rows } where rows[r][c] is 1 for a dark
     module; null if the text is too long. opts.level ("M" or "L") and opts.mask
     (0–7) force a choice; otherwise the smallest symbol and the most readable
     mask are picked. */
  function qrMatrix(text, opts) {
    const o = opts || {}, bytes = utf8(text);
    let v = 0, lv = null;
    for (const level of o.level ? [o.level] : ["M", "L"]) {
      if (!BLOCKS[level]) return null;
      for (let ver = o.version || 1; ver <= (o.version || MAX_VERSION); ver++) if (bytes.length <= capacity(ver, level)) { v = ver; lv = level; break; }
      if (v) break;
    }
    if (!v) return null;
    const codewords = withErrorCorrection(encodeData(bytes, v, lv), v, lv);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      if (o.mask != null && o.mask !== mask) continue;
      const sym = blank(v);
      placeData(sym, codewords);
      for (let r = 0; r < sym.size; r++) for (let c = 0; c < sym.size; c++) if (!sym.fn[r][c] && MASKS[mask](r, c)) sym.m[r][c] ^= 1;
      writeFormat(sym, lv, mask);
      const score = penalty(sym);
      if (!best || score < best.score) best = { score, mask, sym };
    }
    return { version: v, level: lv, mask: best.mask, size: best.sym.size, rows: best.sym.m };
  }

  /* An SVG picture of the code: always dark on white with the required quiet
     margin, whatever the page's theme, because that is what cameras expect. */
  function qrSvg(text, opts) {
    const q = qrMatrix(text, opts);
    if (!q) return "";
    const quiet = 4, n = q.size + quiet * 2;
    let d = "";
    for (let r = 0; r < q.size; r++) {
      for (let c = 0; c < q.size; c++) {
        if (!q.rows[r][c]) continue;
        let len = 1; while (c + len < q.size && q.rows[r][c + len]) len++;
        d += `M${c + quiet} ${r + quiet}h${len}v1h-${len}z`;
        c += len;
      }
    }
    const label = String((opts && opts.label) || "QR code").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  return { qrMatrix, qrSvg };
})();

if (typeof module === "object" && module.exports) module.exports = { qrMatrix, qrSvg };
