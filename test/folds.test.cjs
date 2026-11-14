/* The sections below the match card fold to one line each (sec in index.html):
   closed they show a title and a preview, the visitor's choice is remembered,
   and picking a team scrolls to the top of the match zone. Also the Install
   button's fallback for when the browser never offers its own prompt. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot } = require("./helpers/page.cjs");

const FOLDS = ["stories", "facts", "pool", "oppo", "fixtures", "results"];
const isOpen = (p, id) => /<details open/.test(p.html(id));

test("folds: every section below the match card is one folding section", async () => {
  const p = await boot({ hash: "#men" });
  for (const id of FOLDS) {
    const html = p.html(id);
    assert.equal((html.match(/<div class="card sec">/g) || []).length, 1, id + " is one folding card");
    assert.match(html, /<details[^>]*ontoggle="setOpen\('s\.[a-z]+',this\.open\)"><summary>/, id + " folds");
    assert.equal(isOpen(p, id), id === "facts", id + (id === "facts" ? " starts open" : " starts closed"));
  }
});

test("folds: a closed section still says something useful", async () => {
  const p = await boot({ hash: "#men" });
  const preview = id => (/<span class="ss">([^<]*)<\/span>/.exec(p.html(id)) || [])[1] || "";
  assert.match(preview("stories"), /\S{3,}/, "storylines previews its first line");
  assert.doesNotMatch(preview("stories"), /[<>]/, "the preview is plain text");
  assert.match(preview("pool"), /^\d+ players/);
  assert.match(preview("fixtures"), /^\d+ match(es)? · next \w+ \d+, (vs|at) /);
  assert.match(preview("results"), /^Last: [WDL] \d+–\d+ (vs|at) /);
  assert.match(preview("oppo"), /^\d+ players/);
  assert.match(p.html("facts"), /<span class="st">Did you know\?<span class="lv">/, "the fact's label sits in the title line");
});

test("folds: opening and closing is remembered on this device, and counted once", async () => {
  const p = await boot({ hash: "#men" });
  p.run("setOpen('s.pool', true)");
  assert.ok(isOpen(p, "pool") === false, "nothing is redrawn by the toggle itself");
  p.run("renderPool()");
  assert.ok(isOpen(p, "pool"), "the section stays open when it is drawn again");
  assert.deepEqual(JSON.parse(p.store["wc2026.usa.v1.open"]), { "s.pool": true });
  assert.equal(p.tracked.filter(x => /open-pool/.test(x)).length, 1);
  p.run("setOpen('s.pool', true)");   // the browser reports the state again each time the section is redrawn
  assert.equal(p.tracked.filter(x => /open-pool/.test(x)).length, 1, "being drawn open is not counted as opening");
  p.run("setOpen('s.facts', false); renderFacts()");
  assert.ok(!isOpen(p, "facts"), "a section that starts open can be closed");

  const again = await boot({ hash: "#men", storage: { "wc2026.usa.v1.open": p.store["wc2026.usa.v1.open"] } });
  assert.ok(isOpen(again, "pool") && !isOpen(again, "facts"), "the next visit starts the way this one ended");
  assert.ok(!isOpen(again, "results"), "sections never touched keep their starting state");
});

test("folds: nonsense in the remembered state is ignored", async () => {
  const p = await boot({ hash: "#men", storage: { "wc2026.usa.v1.open": '{"s.pool":1,"xi":true,"s.<b>":true,"__proto__":{"x":1}}' } });
  assert.ok(isOpen(p, "pool"));
  assert.equal(p.run("S.open.xi"), undefined, "only section keys are restored");
  const broken = await boot({ hash: "#men", storage: { "wc2026.usa.v1.open": "not json" } });
  assert.ok(isOpen(broken, "facts") && !isOpen(broken, "pool"));
});

test("picking a team scrolls to the top of the match zone", async () => {
  const p = await boot({ hash: "#men" });
  p.run("pickTeam('women')");
  await p.settle();
  assert.equal(p.el("match").scrolled, 1);
  assert.equal(p.el("hero").scrolled, 0);
});

test("install: when Chrome never offers its prompt, the button appears and shows the steps", async () => {
  const p = await boot({ hash: "#men" });
  assert.equal(p.el("installBtn").hidden, true, "hidden at first");
  assert.equal(await p.fire(t => t.ms === 3000), 1);
  assert.equal(p.el("installBtn").hidden, false, "shown after three seconds without a prompt");
  p.el("installBtn").listeners.click();
  assert.equal(p.el("how").open, true);
  assert.equal(p.el("howUrl").textContent, "test.local/wc2026");
  assert.ok(p.tracked.some(x => /install-how/.test(x)));
});

test("install: an iPhone keeps its own tip and gets no Install button", async () => {
  const p = await boot({ hash: "#men", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  await p.fire(t => t.ms === 3000);
  assert.equal(p.el("installBtn").hidden, true);
});
