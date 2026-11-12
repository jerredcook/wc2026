/* The canary's checks, against recorded feed data, plus the build fingerprint.
   The canary itself talks to the real feeds and the live site, so it is run by
   its own workflow (canary.yml), not here. These tests make sure each check
   passes on good input and fails, with a readable reason, on bad input. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkKnownMatch, checkNextMatch, checkCors, checkNews, checkData, checkBuildFile, report, KNOWN, FRESH_FOR } from "../scripts/canary.mjs";
import { fingerprint, CODE } from "../scripts/build-id.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = f => JSON.parse(readFileSync(path.join(ROOT, "test", "fixtures", f), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));

test("known match: the recorded feed passes; a changed feed fails with the reason", () => {
  const G = fixture("summary-finished-usa-canada.json");
  assert.equal(String(G.header.id), KNOWN.id, "the canary's known match is the one recorded in the fixtures");
  assert.deepEqual(checkKnownMatch(G), []);

  assert.match(checkKnownMatch({}).join(), /match header/);
  const renamed = clone(G); renamed.header.competitions[0].competitors.forEach(c => { c.points = c.score; delete c.score; });
  assert.match(checkKnownMatch(renamed).join(), /score reads/);
  const live = clone(G); live.header.competitions[0].status.type.state = "in";
  assert.match(checkKnownMatch(live).join(), /not full time/);
  const noEvents = clone(G); delete noEvents.keyEvents; delete noEvents.header.competitions[0].details;
  assert.match(checkKnownMatch(noEvents).join(), /no goals or cards/);
  assert.match(checkKnownMatch({ header: { competitions: [{ competitors: null }] } }).join(), /parser threw/);
});

test("next match: an upcoming match reads; an unknown state or a missing header does not", () => {
  assert.deepEqual(checkNextMatch(fixture("summary-prematch-haiti-usa.json"), "660"), []);
  assert.match(checkNextMatch({}, "660").join(), /match header/);
  const odd = fixture("summary-prematch-haiti-usa.json"); odd.header.competitions[0].status.type.state = "postponed-somehow";
  assert.match(checkNextMatch(odd, "660").join(), /match state reads/);
});

test("cross-origin: the feed must allow a web page to read it", () => {
  assert.deepEqual(checkCors("*"), []);
  assert.deepEqual(checkCors("https://jerredcook.github.io"), []);
  assert.equal(checkCors(null).length, 1);
  assert.equal(checkCors("https://www.espn.com").length, 1);
});

test("news: a list passes, even an empty one; anything else fails", () => {
  const ok = { articles: [{ headline: "USA name squad", links: { web: { href: "https://www.espn.com/x" } } }] };
  assert.deepEqual(checkNews(ok), []);
  assert.deepEqual(checkNews({ articles: [] }), []);
  assert.equal(checkNews({}).length, 1);
  assert.equal(checkNews(null).length, 1);
  assert.match(checkNews({ articles: [{ headline: "x", links: { web: { href: "http://insecure" } } }] }).join(), /https link/);
});

test("live data: fresh passes; old, unstamped or malformed fails", () => {
  const now = Date.parse("2026-11-12T15:00:00Z");
  const d = hoursAgo => ({ ...fixture("data-men.json"), checked: new Date(now - hoursAgo * 36e5).toISOString() });
  assert.deepEqual(checkData(d(2), now), []);
  assert.deepEqual(checkData(d(23), now), []);
  assert.match(checkData(d(25), now).join(), /last checked 25 hours ago/);
  assert.match(checkData(fixture("data-men.json"), now).join(), /does not say when/);
  assert.match(checkData({ fixtures: [] }, now).join(), /missing or malformed/);
  assert.match(checkData(null, now).join(), /missing or malformed/);
  assert.ok(FRESH_FOR < 30 * 36e5, "the canary fires before the app starts warning visitors (30 hours)");
});

test("build file: needs a fingerprint, and the live core file needs its version line", () => {
  const core = readFileSync(path.join(ROOT, "js", "core.js"), "utf8");
  assert.deepEqual(checkBuildFile({ code: "abc123" }, core), []);
  assert.equal(checkBuildFile(null, core).length, 1);
  assert.equal(checkBuildFile({ code: "" }, core).length, 1);
  assert.equal(checkBuildFile({ code: "abc" }, "nothing here").length, 1);
});

test("report: lists every check and fails if any one did", () => {
  const good = report([{ name: "a", problems: [] }, { name: "b", problems: [] }]);
  assert.equal(good.ok, true); assert.match(good.text, /All 2 checks passed/);
  const bad = report([{ name: "a", problems: [] }, { name: "b", problems: ["it broke"] }]);
  assert.equal(bad.ok, false); assert.match(bad.text, /✗ b\n    it broke/); assert.match(bad.text, /1 of 2 checks failed/);
});

test("build fingerprint: changes when the app's code changes, and only then", () => {
  const files = Object.fromEntries(CODE.map(f => [f, "contents of " + f]));
  const read = f => { assert.ok(f in files, "unexpected file " + f); return files[f]; };
  const a = fingerprint(read);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(fingerprint(read), a, "the same code gives the same fingerprint");
  for (const f of CODE) {
    const changed = fingerprint(x => x === f ? files[x] + " " : files[x]);
    assert.notEqual(changed, a, `a change to ${f} must change the fingerprint`);
  }
  assert.ok(CODE.includes("index.html") && CODE.includes("js/core.js") && CODE.includes("sw.js"));
  assert.ok(!CODE.some(f => f.startsWith("data/")), "data refreshes must not look like a new build");
  assert.match(fingerprint(), /^[0-9a-f]{16}$/, "it runs against the real files");
});
