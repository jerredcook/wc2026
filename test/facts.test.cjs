/* "Did you know?": the facts themselves (js/facts.js), the order they are
   shown in (factOrder in js/core.js), and the card on the front page.
   Run: node --test */
process.env.TZ = "America/New_York";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, clone, fixture } = require("./helpers/page.cjs");
const { FACTS } = require("../js/facts.js");
const { factOrder } = require("../js/core.js");

test("facts: each one is complete, short enough for a phone, and plain text", () => {
  assert.ok(FACTS.length >= 30, "a few taps should not exhaust them");
  const seen = new Set();
  for (const f of FACTS) {
    assert.ok(f.lv === "new" || f.lv === "deep", `"${f.h}" has no level`);
    assert.ok(f.h && f.h.length <= 60, `headline too long: "${f.h}"`);
    assert.ok(f.t && f.t.length >= 60 && f.t.length <= 260, `"${f.h}" is ${f.t && f.t.length} characters: keep it to two or three sentences`);
    assert.ok(!/[<>]|&\w+;/.test(f.h + f.t), `"${f.h}" contains markup: facts are plain text`);
    assert.ok(/[.!?:\d]$/.test(f.t), `"${f.h}" does not end as a sentence`);
    assert.ok(!seen.has(f.h), `"${f.h}" is listed twice`); seen.add(f.h);
    if (f.until !== undefined) assert.match(f.until, /^20\d\d-\d\d-\d\d$/, `"${f.h}": until must be a date`);
    if (f.opp !== undefined) assert.ok(Array.isArray(f.opp) && f.opp.length, `"${f.h}": opp must list opponents`);
  }
  assert.ok(FACTS.filter(f => f.lv === "new").length >= 10, "enough for someone new to the sport");
  assert.ok(FACTS.filter(f => f.lv === "deep").length >= 10, "enough for someone who follows it");
});

const F = [
  { lv: "new", h: "n1", t: "" }, { lv: "new", h: "n2", t: "" }, { lv: "new", h: "n3", t: "" }, { lv: "new", h: "legs", t: "", leg: true },
  { lv: "deep", h: "d1", t: "" }, { lv: "deep", h: "d2", t: "" }, { lv: "deep", h: "d3", t: "" }, { lv: "deep", h: "d4", t: "" }, { lv: "deep", h: "d5", t: "" },
  { lv: "deep", h: "haiti1", t: "", opp: ["Haiti"] }, { lv: "deep", h: "haiti2", t: "", opp: ["Haiti"] },
  { lv: "deep", h: "dated", t: "", until: "2027-03-20" },
];
const names = l => l.map(f => f.h);

test("factOrder: every fact is shown once, whatever the day", () => {
  for (let day = 0; day < 40; day++) assert.deepEqual(names(factOrder(F, { day })).sort(), names(F).sort());
  assert.deepEqual(factOrder([], { day: 3 }), []);
  assert.deepEqual(factOrder(undefined), []);
});

test("factOrder: the next opponent's facts come first, then the one about two-leg ties", () => {
  for (let day = 20700; day < 20720; day++) {
    const l = names(factOrder(F, { day, opp: "Haiti", leg: true }));
    assert.deepEqual(l.slice(0, 2).sort(), ["haiti1", "haiti2"]);
    assert.equal(l[2], "legs");
  }
  assert.deepEqual(names(factOrder(F, { day: 1, opp: "HAITI" })).slice(0, 2).sort(), ["haiti1", "haiti2"], "the name is matched loosely");
  const other = names(factOrder(F, { day: 1, opp: "Mexico" }));
  assert.ok(other.indexOf("haiti1") >= 0, "against anyone else they are ordinary facts");
  assert.equal(other[0].slice(0, 1) === "n" || other[0] === "legs", true, "and the list starts with one for newcomers");
});

test("factOrder: newcomers' facts and deep cuts take turns", () => {
  const l = factOrder(F, { day: 5 });
  const nNew = F.filter(f => f.lv === "new").length;
  for (let i = 0; i < nNew * 2; i++) assert.equal(l[i].lv, i % 2 ? "deep" : "new", `position ${i + 1}`);
});

test("factOrder: the same all day, different the next day", () => {
  assert.deepEqual(names(factOrder(F, { day: 20770 })), names(factOrder(F, { day: 20770 })));
  const days = new Set(); for (let d = 20770; d < 20790; d++) days.add(names(factOrder(F, { day: d })).join());
  assert.ok(days.size >= 18, `twenty days gave only ${days.size} different orders`);
  const firsts = new Set(); for (let d = 20770; d < 20800; d++) firsts.add(factOrder(F, { day: d })[0].h);
  assert.equal(firsts.size, 4, "each of the newcomers' facts gets a turn at the front");
});

test("factOrder: a fact past its review date is left out", () => {
  assert.ok(names(factOrder(F, { day: 1, today: "2027-03-20" })).includes("dated"));
  assert.ok(!names(factOrder(F, { day: 1, today: "2027-03-21" })).includes("dated"));
  assert.ok(names(factOrder(F, { day: 1 })).includes("dated"), "with no date to compare, nothing is dropped");
});

test("the card: before Haiti v USA it opens on a fact about Haiti, and says so", async () => {
  const p = await boot();
  const t = p.text("facts");
  assert.match(t, /^Did you know\?\s*About Haiti/);
  assert.match(t, /Gaetjens|Zoff/);
  assert.match(t, /1 of \d\d$/);
  assert.match(p.html("facts"), /<button class="fb" onclick="nextFact\(\)">Another one/);
});

test("the card: Another one moves on, is counted, and comes back round to the start", async () => {
  const p = await boot();
  const first = p.text("facts"), n = +/1 of (\d+)/.exec(first)[1];
  const seen = new Set([first]);
  for (let i = 2; i <= n; i++) {
    p.run("nextFact()");
    const t = p.text("facts");
    assert.match(t, new RegExp(`${i} of ${n}$`));
    assert.ok(!seen.has(t), `fact ${i} was shown before`); seen.add(t);
  }
  assert.equal(p.tracked.filter(x => /fact-next/.test(x)).length, n - 1);
  assert.match(p.text("facts").slice(0, 60), /The basics|Deep cut|About Haiti/);
  p.run("nextFact()");
  assert.equal(p.text("facts"), first, "after the last one it starts again");
  assert.equal(n, FACTS.length, "nothing in the list is past its review date on the test's clock");
});

test("the card: the third fact before a two-leg tie explains legs, labelled for newcomers", async () => {
  const p = await boot();
  p.run("nextFact(); nextFact()");
  assert.match(p.text("facts"), /^Did you know\?\s*The basics\s*One tie, two matches/);
});

test("the card: against another opponent it opens on the basics, and Haiti's facts are deep cuts", async () => {
  const p = await boot({ hash: "#women" });
  assert.match(p.text("facts"), /^Did you know\?\s*The basics/);
  let found = false;
  for (let i = 0; i < FACTS.length; i++) { if (/Gaetjens/.test(p.text("facts"))) { assert.match(p.text("facts"), /^Did you know\?\s*Deep cut/); found = true; } p.run("nextFact()"); }
  assert.ok(found);
});

test("the card: a fact's text is shown as text, never as markup", async () => {
  const p = await boot();
  p.run(`FACTS.unshift({ lv: "deep", opp: ["Haiti"], h: "<b>bold</b>", t: "<img src=x onerror=alert(1)> & more" }, { lv: "deep", opp: ["Haiti"], h: "x", t: "y" }); S.fact = 0; renderFacts()`);
  let html = ""; for (let i = 0; i < 4; i++) { html += p.html("facts"); p.run("nextFact()"); }
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.ok(!/<img|<b>bold/.test(html));
});

test("the card: without the facts file (an old offline copy) the section is simply absent", async () => {
  const p = await boot({ noFacts: true });
  assert.equal(p.html("facts"), "");
  assert.match(p.text("hero"), /Haiti/);
  assert.deepEqual(p.tracked.filter(t => /error/.test(t)), []);
});

test("the card: nothing is shown until the schedule has loaded, so the first fact does not change under the reader", async () => {
  const p = await boot({ data: { men: null, women: null } });
  assert.equal(p.html("facts"), "");
});
