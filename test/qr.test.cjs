/* The QR encoder (js/qr.js) against patterns that were checked outside this
   repository: each one in test/fixtures/qr-golden.json was compared module for
   module with the "qrcode" npm package and read back with the "jsqr" decoder.
   These tests need no packages; they make sure the encoder keeps producing
   exactly those patterns, and that the structure every QR reader relies on is
   there. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { qrMatrix, qrSvg } = require("../js/qr.js");
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "qr-golden.json"), "utf8")).symbols;
const hex = q => q.rows.map(r => { let s = ""; for (let i = 0; i < r.length; i += 4) s += ((r[i] << 3) | ((r[i + 1] || 0) << 2) | ((r[i + 2] || 0) << 1) | (r[i + 3] || 0)).toString(16); return s; }).join("");

test("every verified pattern is reproduced exactly: versions 1–10 at both error-correction levels", () => {
  const seen = new Set();
  for (const g of golden) {
    const q = qrMatrix(g.text, { level: g.level });
    assert.ok(q, `${g.level}${g.version}: no symbol produced`);
    assert.deepEqual([q.version, q.level, q.mask, q.size], [g.version, g.level, g.mask, g.size], `${g.level}${g.version}: version, level, mask or size differ`);
    assert.equal(hex(q), g.hex, `${g.level}${g.version}: the pattern differs from the verified one`);
    seen.add(g.level + g.version);
  }
  for (const lv of ["M", "L"]) for (let v = 1; v <= 10; v++) assert.ok(seen.has(lv + v), `no verified pattern for ${lv}${v}`);
});

test("the structure every reader looks for is present", () => {
  const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  for (const text of ["A", "https://jerredcook.github.io/wc2026/#men&c=401929710~Jerred:2-0", "x".repeat(200)]) {
    const q = qrMatrix(text), n = q.size, at = (r, c) => q.rows[r][c];
    assert.equal(n, 17 + 4 * q.version);
    assert.equal(q.rows.length, n); assert.ok(q.rows.every(r => r.length === n));
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let r = 0; r < 7; r++) assert.equal(Array.from(q.rows[r0 + r].slice(c0, c0 + 7)).join(""), FINDER[r], "finder pattern");
    }
    for (let i = 0; i < 8; i++) { assert.equal(at(7, i), 0); assert.equal(at(i, 7), 0); assert.equal(at(7, n - 1 - i), 0); assert.equal(at(n - 8, i), 0); }   // separators
    for (let i = 8; i < n - 8; i++) { assert.equal(at(6, i), i % 2 ? 0 : 1, "timing row"); assert.equal(at(i, 6), i % 2 ? 0 : 1, "timing column"); }
    assert.equal(at(n - 8, 8), 1, "the always-dark module");
    /* The 15 format bits are written twice and must agree; unmasked, they name the level and mask. */
    const a = [], b = [];
    for (let i = 0; i <= 5; i++) a.push(at(i, 8)); a.push(at(7, 8), at(8, 8), at(8, 7)); for (let i = 9; i < 15; i++) a.push(at(8, 14 - i));
    for (let i = 0; i < 8; i++) b.push(at(8, n - 1 - i)); for (let i = 8; i < 15; i++) b.push(at(n - 15 + i, 8));
    assert.deepEqual(a, b, "the two copies of the format bits agree");
    const word = a.reduce((v, bit, i) => v | (bit << i), 0) ^ 0x5412;
    assert.equal(word >>> 10, ((q.level === "L" ? 1 : 0) << 3) | q.mask, "format bits name the level and mask used");
  }
});

test("size choices: the smallest symbol that fits, M before L, nothing past the limit", () => {
  assert.equal(qrMatrix("A").version, 1);
  assert.equal(qrMatrix("x".repeat(14)).version, 1); assert.equal(qrMatrix("x".repeat(15)).version, 2);
  assert.deepEqual([qrMatrix("x".repeat(213)).level, qrMatrix("x".repeat(213)).version], ["M", 10]);
  assert.equal(qrMatrix("x".repeat(214)).level, "L", "falls back to lighter error correction when M is full");
  assert.ok(qrMatrix("x".repeat(271))); assert.equal(qrMatrix("x".repeat(272)), null);
  assert.equal(qrMatrix("é".repeat(136)), null, "length is counted in bytes, not characters");
  assert.equal(qrMatrix("x", { level: "Q" }), null, "an unsupported level is refused, not guessed");
  assert.equal(qrMatrix("same").mask, qrMatrix("same").mask); assert.equal(hex(qrMatrix("same")), hex(qrMatrix("same")), "the same text always gives the same code");
});

test("the picture: dark on white with a quiet margin, whatever the theme, and safe to drop into the page", () => {
  const q = qrMatrix("https://jerredcook.github.io/wc2026/"), svg = qrSvg("https://jerredcook.github.io/wc2026/", { label: 'Scan "me" <now> & go' });
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size + 8} ${q.size + 8}" role="img"`), "four modules of margin on every side");
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/><path d="[Mhvz0-9 \-]+" fill="#000"\/><\/svg>$/);
  assert.match(svg, /aria-label="Scan &quot;me&quot; &lt;now&gt; &amp; go"/, "the label is escaped");
  const dark = q.rows.reduce((n, r) => n + r.reduce((a, b) => a + b, 0), 0);
  const drawn = [...svg.matchAll(/h(\d+)v1/g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(drawn, dark, "every dark module is drawn once");
  assert.equal(qrSvg("x".repeat(300)), "", "too long: nothing is drawn rather than a broken code");
});
