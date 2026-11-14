// The American Outlaws concept page (ao.html, js/ao.js, data/ao/chapters.json).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("ao: the chapter snapshot is well formed", () => {
  const d = JSON.parse(read("data/ao/chapters.json"));
  assert.match(d.captured, /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
  assert.ok(d.chapters.length > 150, "the whole chapter list is there");
  const slugs = new Set();
  for (const c of d.chapters) {
    assert.ok(c.slug && c.name && c.state, "every chapter has a slug, name and state");
    assert.ok(!slugs.has(c.slug), "duplicate chapter " + c.slug); slugs.add(c.slug);
    if (c.lat != null) assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, c.slug + " has sane coordinates");
    for (const p of c.parties || []) {
      assert.match(p.date, /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/, c.slug + " watch party dates match the fixture feed's format");
      assert.ok(p.title, c.slug + " watch party has a title");
    }
  }
  assert.ok(d.chapters.some(c => c.slug === "middlesex-county" && c.parties && c.parties.length), "the default chapter has watch parties");
});

test("ao: the concept page loads its script after the hub and stays out of search", () => {
  const html = read("ao.html");
  assert.ok(html.indexOf('src="js/ao.js"') > html.indexOf("function render()"), "js/ao.js loads after the main script");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /id="aoWatch"/); assert.match(html, /id="aoChapters"/);
  for (const m of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|png|svg|webmanifest|json))"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), "missing file: " + m[1]);
});

test("ao: the concept page is up to date with the front page it is generated from", () => {
  const r = require("node:child_process").spawnSync(process.execPath, [path.join(root, "scripts/build-ao.mjs"), "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr || "build-ao --check failed");
});
