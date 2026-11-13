/* Cutting a live recording down to a test fixture (scripts/make-replay.mjs):
   the cut must not change anything the app reads, and it must keep the moments
   where the match card changes. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { trim, shape, makeReplay } from "../scripts/make-replay.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const core = require(path.join(ROOT, "js", "core.js"));
const { replay } = require(path.join(ROOT, "test", "helpers", "page.cjs"));
const fixture = f => JSON.parse(readFileSync(path.join(ROOT, "test", "fixtures", f), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));
const finished = fixture("summary-finished-usa-canada.json"), prematch = fixture("summary-prematch-haiti-usa.json");
const as = (G, status, score) => { const c = clone(G); c.header.competitions[0].status = status; if (score) c.header.competitions[0].competitors.forEach((x, i) => { x.score = score[i]; }); return c; };

test("trim: the app reads the same match from the cut-down feed as from the full one", () => {
  for (const [G, ids] of [[finished, ["660", "206"]], [prematch, ["660", "2654"]]]) {
    for (const id of ids) assert.deepEqual(core.parseSummary(trim(G), id), core.parseSummary(G, id));
  }
  assert.ok(JSON.stringify(trim(finished)).length < JSON.stringify(finished).length / 4, "and it is a fraction of the size");
});

test("trim: test mode still finds the teams, crest, round, leg and stadium", () => {
  const T = trim(prematch), c = T.header.competitions[0], full = prematch.header.competitions[0];
  assert.equal(c.date, full.date);
  assert.deepEqual(c.competitors.map(x => [x.id, x.homeAway, x.team.displayName, x.team.abbreviation]), full.competitors.map(x => [x.id, x.homeAway, x.team.displayName, x.team.abbreviation]));
  const crest = t => (t.logos && t.logos[0] && t.logos[0].href) || t.logo || "";
  const night = fixture("replay-curacao-panama.json").frames[0].summary.header.competitions[0];
  for (const [cut, whole] of [[c, full], [trim({ header: { competitions: [night] } }).header.competitions[0], night]]) {
    assert.deepEqual(cut.competitors.map(x => crest(x.team)), whole.competitors.map(x => crest(x.team)), "each side keeps the crest it had");
  }
  assert.ok(night.competitors.every(x => /^https:/.test(crest(x.team))), "the recorded match has crests");
  assert.equal(T.header.season.name, prematch.header.season.name);
  assert.equal(T.header.league.name, prematch.header.league.name);
  assert.equal((c.leg || {}).displayValue, (full.leg || {}).displayValue);
  assert.equal(T.gameInfo.venue.fullName, prematch.gameInfo.venue.fullName);
});

test("shape: a new minute is not a new moment; a goal, a card, a break and full time are", () => {
  const live = (clock, detail) => ({ displayClock: clock, type: { state: "in", shortDetail: detail || clock } });
  const a = as(finished, live("20'")), b = as(finished, live("21'"));
  assert.equal(shape(a), shape(b));
  assert.notEqual(shape(a), shape(as(finished, live("45'+3'", "HT"))), "half time");
  assert.notEqual(shape(a), shape(as(finished, live("20'"), ["2", "0"])), "a goal");
  assert.notEqual(shape(a), shape(as(finished, { type: { state: "in", shortDetail: "20'" } })), "the running clock going missing");
  assert.notEqual(shape(a), shape(finished), "full time");
  const fewer = clone(a); fewer.keyEvents = fewer.keyEvents.filter(k => !/card/.test(k.type.type));
  assert.notEqual(shape(a), shape(fewer), "a card");
  const noSubs = clone(a); noSubs.keyEvents = noSubs.keyEvents.filter(k => k.type.type !== "substitution");
  assert.equal(shape(a), shape(noSubs), "a substitution is not shown on the card, so it is not a moment");
});

test("makeReplay: keeps the moments that differ, stores unchanged parts once, and rebuilds them in full", () => {
  const live = clock => ({ displayClock: clock, type: { state: "in", shortDetail: clock } });
  const snaps = [as(finished, live("20'"), ["0", "0"]), as(finished, live("21'"), ["0", "0"]), as(finished, live("30'"), ["1", "0"]), finished]
    .map((summary, i) => ({ recordedAt: `2026-11-12T00:0${i}:00.000Z`, league: "fifa.friendly", event: "401905188", summary }));
  const R = makeReplay(snaps, [{ t: "2026-11-12T00:00:00.000Z", state: "in" }, { t: "2026-11-12T00:03:00.000Z", state: "post" }]);
  assert.deepEqual(R.frames.map(f => f.at.slice(14, 16)), ["00", "02", "03"], "the 21st minute changed nothing");
  assert.deepEqual(Object.keys(R.frames[1].summary), ["header"], "only the part that changed is stored again");
  assert.equal(R.match, "United States v Canada");
  assert.equal(R.wentLive, "2026-11-12T00:00:00.000Z");
  assert.equal(R.finished, "2026-11-12T00:03:00.000Z");
});

test("the recorded match in the fixtures: complete, in order, and each moment readable in full", () => {
  const R = replay("replay-curacao-panama.json");
  assert.equal(R.match, "Curaçao v Panama");
  assert.ok(R.frames.length >= 10 && R.looks > 200);
  assert.deepEqual(R.frames.map(f => f.at), R.frames.map(f => f.at).slice().sort(), "frames are in the order recorded");
  const states = R.frames.map(f => core.parseSummary(f.summary, "11678").state);
  assert.equal(states[0], "pre"); assert.equal(states[states.length - 1], "post");
  assert.ok(states.includes("in"));
  for (const f of R.frames) {
    const L = core.parseSummary(f.summary, "11678");
    assert.ok(L && L.series && L.last5.length === 2, `the parts stored once are carried into ${f.at}`);
    if (L.state !== "pre") assert.ok(L.us === 0 && L.them === 0 && L.xi.length === 2 && L.stats, `score, lineups and numbers at ${f.at}`);
  }
  assert.ok(readFileSync(path.join(ROOT, "test", "fixtures", "replay-curacao-panama.json")).length < 120e3, "the fixture stays small");
});
