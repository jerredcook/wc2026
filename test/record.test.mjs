/* The live-match recorder's decisions: what to keep, when something has
   changed, which match to record and how often to look. The recording itself
   (scripts/record-live.mjs talking to the real feed) is run by hand or by the
   record-live workflow. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { KEEP, slim, glance, signature, pick, nextWait } from "../scripts/record-live.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = f => JSON.parse(readFileSync(path.join(ROOT, "test", "fixtures", f), "utf8"));
const { parseSummary } = createRequire(import.meta.url)(path.join(ROOT, "js", "core.js"));
const clone = o => JSON.parse(JSON.stringify(o));

test("slim keeps everything the app reads: a slimmed recording parses exactly like the full feed", () => {
  for (const f of ["summary-finished-usa-canada.json", "summary-prematch-haiti-usa.json"]) {
    const G = { ...fixture(f), news: { big: "x".repeat(5000) }, odds: [1, 2, 3], videos: [] };
    const S = slim(G);
    assert.deepEqual(Object.keys(S).filter(k => !KEEP.includes(k)), []);
    assert.deepEqual(parseSummary(S, "660"), parseSummary(G, "660"), f);
  }
  /* Every part of the feed that the app's code mentions is on the keep list. */
  const code = readFileSync(path.join(ROOT, "js", "core.js"), "utf8") + readFileSync(path.join(ROOT, "index.html"), "utf8");
  const read = new Set([...code.matchAll(/\bG\.([a-zA-Z]+)\b/g)].map(m => m[1]).filter(k => !["map", "md"].includes(k)));
  for (const k of read) assert.ok(KEEP.includes(k), `the app reads G.${k}, so the recorder must keep it`);
  assert.deepEqual(slim(null), {});
});

test("glance reads the state, score and counts from the feed", () => {
  const g = glance(fixture("summary-finished-usa-canada.json"));
  assert.equal(g.state, "post");
  assert.deepEqual(g.teams.map(t => `${t.name} ${t.score}`), ["United States 1", "Canada 0"]);
  assert.ok(g.events > 0 && g.starters === 22);
  const pre = glance(fixture("summary-prematch-haiti-usa.json"));
  assert.equal(pre.state, "pre"); assert.equal(pre.events, 0); assert.ok(pre.date);
  assert.equal(glance({}).state, "?");
});

test("signature changes on a goal, a card, a substitution, half time and full time, but not as the clock runs", () => {
  const base = fixture("summary-finished-usa-canada.json");
  const at = (clock, change) => { const G = clone(base); G.header.competitions[0].status = { displayClock: clock, period: 2, type: { state: "in", shortDetail: clock } }; if (change) change(G); return signature(glance(G)); };
  const s67 = at("67'");
  assert.equal(at("68'"), s67, "a minute passing is not a change");
  assert.equal(at("90'+3'"), s67, "nor is stoppage time");
  assert.notEqual(at("68'", G => { G.header.competitions[0].competitors[1].score = "1"; }), s67, "a goal");
  assert.notEqual(at("68'", G => { G.keyEvents.push({ type: { text: "Yellow Card" } }); }), s67, "a card");
  assert.notEqual(at("68'", G => { G.rosters[0].roster.find(p => !p.subbedIn).subbedIn = true; }), s67, "a substitution");
  assert.notEqual(at("HT", G => { G.header.competitions[0].status.type.shortDetail = "HT"; }), s67, "half time");
  assert.notEqual(signature(glance(base)), s67, "full time");
});

test("pick: a match in progress first, else the next to start within 90 minutes, else none", () => {
  const now = Date.parse("2026-11-13T00:00:00Z"), g = (state, date) => ({ state, date });
  const tonight = g("pre", "2026-11-13T00:30Z"), friday = g("pre", "2026-11-14T02:00Z"), saturday = g("pre", "2026-11-14T21:30Z");
  assert.equal(pick([tonight, friday, saturday], now), 0);
  assert.equal(pick([friday, saturday, tonight], now), 2);
  assert.equal(pick([tonight, friday, saturday], Date.parse("2026-11-12T16:00:00Z")), -1, "hours away: nothing to record");
  assert.equal(pick([g("post", "2026-11-13T00:30Z"), g("in", "2026-11-14T02:00Z"), saturday], now), 1, "a match in progress wins");
  assert.equal(pick([g("post", "2026-11-13T00:30Z"), friday, saturday], Date.parse("2026-11-13T03:00:00Z")), -1, "finished: nothing to record");
  assert.equal(pick([tonight], Date.parse("2026-11-13T00:40:00Z")), 0, "kickoff time has passed but the feed still says 'pre': record it");
  assert.equal(pick([null, tonight], now), 1, "a match that could not be read is skipped");
  assert.equal(pick([], now), -1);
});

test("nextWait: every 30 seconds in play and near kickoff, slowly before that, a minute after full time", () => {
  const min = 6e4;
  assert.equal(nextWait("in", -40 * min), 30e3);
  assert.equal(nextWait("pre", 10 * min), 30e3);
  assert.equal(nextWait("pre", -2 * min), 30e3, "late kickoff");
  assert.equal(nextWait("pre", 8 * 60 * min), 10 * min, "hours ahead: every ten minutes");
  assert.equal(nextWait("pre", 20 * min), 6 * min, "never sleeps past the last quarter hour before kickoff");
  assert.equal(nextWait("post", -120 * min), 60e3);
});
