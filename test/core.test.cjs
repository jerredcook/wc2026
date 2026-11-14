/* Core match logic, checked against real recorded feed data.
   Run: node --test test/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../js/core.js");
const finished = require("./fixtures/summary-finished-usa-canada.json");   // USA 1–0 Canada, Oct 6 2026
const prematch = require("./fixtures/summary-prematch-haiti-usa.json");    // Haiti v USA, before kickoff
const USA = "660";

test("outcome: win, draw, loss, and a shootout decides a level score", () => {
  assert.equal(core.outcome(2, 1), "W");
  assert.equal(core.outcome(0, 0), "D");
  assert.equal(core.outcome(0, 3), "L");
  assert.equal(core.outcome(1, 1, [4, 3]), "W");
  assert.equal(core.outcome(1, 1, [2, 4]), "L");
});

test("winExpectancy: even teams are 50/50, the two sides sum to 1, missing points give null", () => {
  assert.equal(core.winExpectancy(1500, 1500), 0.5);
  const a = core.winExpectancy(1705.47, 1280.91), b = core.winExpectancy(1280.91, 1705.47);
  assert.ok(a > 0.8 && a < 0.9, "USA v Haiti should be about 84%");
  assert.ok(Math.abs(a + b - 1) < 1e-9);
  assert.equal(core.winExpectancy(null, 1500), null);
});

test("compInfo: each competition gets the right kind", () => {
  const kind = comp => core.compInfo({ comp }).kind;
  assert.equal(kind("International Friendly"), "friendly");
  assert.equal(kind("Women's International Friendly"), "friendly");
  assert.equal(kind("Concacaf Nations League"), "competitive");
  assert.equal(kind("Concacaf W Championship"), "qualifier");
  assert.equal(kind("Gold Cup"), "tournament");
  assert.equal(kind("SheBelieves Cup"), "tournament");
  assert.equal(kind("FIFA Women's World Cup"), "tournament");
  assert.equal(core.compInfo({ comp: "FIFA Women's World Cup" }).name, "Women's World Cup");
  assert.equal(core.compInfo({ comp: "Some New Cup" }).name, "Some New Cup", "unknown competitions keep their own name");
});

test("matchLine: first leg, second leg, single knockout, friendly", () => {
  const base = { comp: "Concacaf Nations League", round: "Quarterfinals", opp: { name: "Haiti" } };
  assert.match(core.matchLine({ ...base, leg: "1st Leg" }), /first of two matches against Haiti/);
  assert.match(core.matchLine({ ...base, leg: "2nd Leg" }, { us: 2, them: 0 }), /USA leads 2–0 from the first/);
  assert.match(core.matchLine({ ...base, leg: "2nd Leg" }, { us: 0, them: 1 }), /USA trails 1–0/);
  assert.match(core.matchLine({ ...base, leg: "2nd Leg" }, { us: 1, them: 1 }), /is level 1–1/);
  assert.match(core.matchLine({ comp: "Concacaf W Championship", round: "Quarterfinals", leg: "", opp: { name: "El Salvador" } }), /single knockout match against El Salvador/);
  assert.match(core.matchLine({ comp: "International Friendly", round: "", leg: "", opp: { name: "Jamaica" } }), /friendly against Jamaica/);
});

test("callVerdict: graded at full time, tracked while live", () => {
  assert.match(core.callVerdict({ us: 2, them: 0 }, 2, 0, "post"), /Spot on/);
  assert.match(core.callVerdict({ us: 3, them: 0 }, 2, 0, "post"), /Right result/);
  assert.match(core.callVerdict({ us: 0, them: 1 }, 2, 0, "post"), /Not this time/);
  assert.match(core.callVerdict({ us: 2, them: 1 }, 1, 0, "in"), /Still alive/);
  assert.match(core.callVerdict({ us: 1, them: 0 }, 1, 0, "in"), /On the money/);
  assert.match(core.callVerdict({ us: 1, them: 0 }, 1, 1, "in"), /Busted/);
  assert.equal(core.callVerdict({ us: 1, them: 0 }, null, null, "pre"), "");
});

test("formScore: goals outweigh assists, starts outweigh sub appearances", () => {
  const p = rec => ({ rec });
  assert.ok(core.formScore(p([{ st: "S", g: 1 }])) > core.formScore(p([{ st: "S", a: 1 }])));
  assert.ok(core.formScore(p([{ st: "S" }])) > core.formScore(p([{ st: "I" }])));
  assert.equal(core.formScore(p([{ st: "X" }, { st: "B" }])), 0);
});

test("parseSummary, finished match: score, goal with assist, cards, lineups, stats", () => {
  const L = core.parseSummary(finished, USA);
  assert.equal(L.state, "post");
  assert.deepEqual([L.us, L.them], [1, 0]);
  const goals = L.events.filter(e => e.icon === "⚽");
  assert.equal(goals.length, 1, "one goal in a 1–0");
  assert.deepEqual({ who: goals[0].who, min: goals[0].min, us: goals[0].us, note: goals[0].note },
    { who: "Justin Ellis", min: "29'", us: true, note: "assist Alex Freeman" });
  assert.equal(L.events.filter(e => e.icon === "🟨").length, 4);
  assert.equal(L.events.filter(e => e.us).length, 3, "three of the five events are the USA's");
  assert.equal(L.xi.length, 2);
  for (const t of L.xi) assert.equal(t.start.length, 11, t.name + " should list eleven starters");
  assert.equal(L.xi.find(t => t.us).formation, "4-2-3-1");
  assert.equal(L.stats.us.possessionPct, "51.2");
  assert.ok(L.tv.includes("TNT"));
});

test("parseSummary: goals shown never exceed the score", () => {
  for (const [G, id] of [[finished, USA], [finished, "206"], [prematch, USA]]) {
    const L = core.parseSummary(G, id);
    assert.ok(L.events.filter(e => e.icon === "⚽").length <= (L.us || 0) + (L.them || 0));
  }
});

test("parseSummary: the same match from the other side mirrors the score", () => {
  const L = core.parseSummary(finished, "206");   // Canada
  assert.deepEqual([L.us, L.them], [0, 1]);
  assert.equal(L.events.filter(e => e.us).length, 2);
});

test("parseSummary, before kickoff: no score or events, but the series and recent form are there", () => {
  const L = core.parseSummary(prematch, USA);
  assert.equal(L.state, "pre");
  assert.equal(L.events.length, 0);
  assert.equal(L.xi.length, 0, "no lineups before they are announced");
  assert.match(L.series, /USA leads series/);
  assert.ok(L.meetings.length >= 1);
  assert.equal(L.last5.length, 2);
  const us = L.last5.find(t => t.us);
  assert.equal(us.games.length, 5);
  const dates = us.games.map(g => g.date);
  assert.deepEqual(dates, dates.slice().sort().reverse(), "recent form is newest first");
  for (const g of us.games) {
    const [f, a] = g.score.split("–").map(Number);
    assert.equal(g.res, f > a ? "W" : f < a ? "L" : "D", `score ${g.score} must read from the team's side next to ${g.res}`);
  }
  assert.ok(L.tv.includes("TBS"));
});

test("statsReady: the match numbers wait until they mean something", () => {
  const s = (us, them) => ({ us, them });
  assert.equal(core.statsReady(null), false);
  assert.equal(core.statsReady(s({ possessionPct: "0", totalShots: "0" }, { possessionPct: "0", totalShots: "0" })), false, "all zero at kickoff");
  assert.equal(core.statsReady(s({ possessionPct: "0", totalPasses: "0" }, { possessionPct: "100", totalPasses: "1" })), false, "one pass: 0% against 100%");
  assert.equal(core.statsReady(s({ possessionPct: "46.9" }, { possessionPct: "53.1" })), true, "both sides have had the ball");
  assert.equal(core.statsReady(s({ possessionPct: "0", foulsCommitted: "1" }, { possessionPct: "100" })), true, "something has been counted");
  assert.equal(core.statsReady(s({ totalShots: "3" }, { totalShots: "0" })), true, "a feed with no possession figure at all");
  assert.equal(core.statsReady(s({}, {})), false);
});

test("parseSummary: during a break the clock says so, not the minute play stopped", () => {
  const withStatus = status => { const G = JSON.parse(JSON.stringify(finished)); G.header.competitions[0].status = status; return core.parseSummary(G, USA).clock; };
  /* The feed's own answers during Curaçao v Panama, Nov 12 2026. */
  assert.equal(withStatus({ displayClock: "45'+3'", period: 1, type: { name: "STATUS_HALFTIME", state: "in", shortDetail: "HT" } }), "Half time");
  assert.equal(withStatus({ displayClock: "45'+1'", period: 1, type: { name: "STATUS_FIRST_HALF", state: "in", shortDetail: "45'+1'" } }), "45'+1'");
  assert.equal(withStatus({ type: { name: "STATUS_SECOND_HALF", state: "in", shortDetail: "90'+5'" } }), "90'+5'", "no running clock in the answer: fall back to the status");
  assert.equal(withStatus({ displayClock: "120'", type: { state: "in", shortDetail: "Pens" } }), "Pens", "any other break is named as the feed names it");
  assert.equal(withStatus({ type: { state: "post", shortDetail: "FT" } }), "FT");
});

test("parseSummary: a broken or empty payload returns null instead of throwing", () => {
  assert.equal(core.parseSummary({}, USA), null);
  assert.equal(core.parseSummary({ header: {} }, USA), null);
});

/* ── Score challenge: everything in a link is untrusted ── */
const { cleanName, packChallenge, parseChallenge, mergeRivals, callDistance, rankCalls, MAX_RIVALS, MAX_NAME } = require("../js/core.js");

test("cleanName: keeps ordinary names, strips anything that could be markup or break a link", () => {
  assert.equal(cleanName("  Jerred  "), "Jerred");
  assert.equal(cleanName("Zoë"), "Zoë");
  assert.equal(cleanName("O’Brien"), "O’Brien");
  assert.equal(cleanName("Mary-Jo   St. John"), "Mary-Jo St. John");
  assert.equal(cleanName("李雷"), "李雷");
  assert.equal(cleanName('<script>alert("x")</script>'), "scriptalertxscri");
  assert.equal(cleanName("a~b:c&d#e=f/g?h"), "abcdefgh");
  assert.equal(cleanName("😀😀"), "", "emoji are not letters");
  assert.equal(Array.from(cleanName("x".repeat(50))).length, MAX_NAME);
  assert.equal(cleanName("é".normalize("NFD")), "é", "accents typed as two characters are joined");
  for (const v of [null, undefined, "", "   ", "~~~", 42, {}]) assert.equal(typeof cleanName(v), "string");
});

test("a challenge survives the trip through a link", () => {
  const calls = [{ n: "Jerred", us: 2, them: 0 }, { n: "Zoë M.", us: 1, them: 1 }, { n: "O’Brien", us: 0, them: 15 }];
  const packed = packChallenge("401929710", calls);
  assert.equal(packed, "401929710~Jerred:2-0~Zo%C3%AB%20M.:1-1~O%E2%80%99Brien:0-15");
  assert.match(packed, /^[A-Za-z0-9~:%.\-]+$/, "only characters that are safe after a # in a link");
  assert.deepEqual(parseChallenge(packed), { id: "401929710", calls });
  assert.equal(packChallenge("1", Array.from({ length: 20 }, (_, i) => ({ n: "P" + i, us: 0, them: 0 }))).split("~").length - 1, MAX_RIVALS + 1, "at most you plus eight friends");
});

test("parseChallenge: refuses what it cannot trust and keeps what it can", () => {
  for (const bad of [null, undefined, 42, "", "garbage", "401929710", "x~Sam:1-0", "-1~Sam:1-0", "1234567890123~Sam:1-0", "1~", "1~:1-0", "1~Sam", "1~Sam:1", "1~Sam:a-b", "1~Sam:16-0", "1~Sam:0-99", "1~Sam:1-0-2", "1~%E0%A4%A:1-0", "1~😀:1-0", "1~Sam:1-0" + "~x:1-0".repeat(200)]) {
    assert.equal(parseChallenge(bad), null, JSON.stringify(String(bad).slice(0, 30)));
  }
  assert.deepEqual(parseChallenge("1~Sam:1-0~bad~Pat:99-0~Lee:2-2").calls.map(c => c.n), ["Sam", "Lee"], "bad entries are dropped, good ones kept");
  assert.deepEqual(parseChallenge("1~Sam:1-0~SAM:3-3~sam:4-4").calls, [{ n: "Sam", us: 1, them: 0 }], "one call per name");
  assert.equal(parseChallenge("1~" + encodeURIComponent("<b>Sam</b>") + ":1-0").calls[0].n, "bSamb", "names are cleaned on the way in too");
  assert.equal(parseChallenge("1" + "~P:1-0".replace("P", "Q") + Array.from({ length: 30 }, (_, i) => "~N" + i + ":1-0").join("")).calls.length, MAX_RIVALS + 1);
  assert.equal(typeof parseChallenge("007~Sam:01-00").calls[0].us, "number");
});

test("mergeRivals: newest first, one per name, never yourself, at most eight", () => {
  const have = [{ n: "Sam", us: 1, them: 0 }, { n: "Pat", us: 0, them: 0 }];
  assert.deepEqual(mergeRivals(have, [{ n: "Lee", us: 2, them: 2 }, { n: "sam", us: 3, them: 3 }], "Jerred"),
    [{ n: "Lee", us: 2, them: 2 }, { n: "sam", us: 3, them: 3 }, { n: "Pat", us: 0, them: 0 }], "a new call from Sam replaces the old one");
  assert.deepEqual(mergeRivals([], [{ n: "JERRED", us: 2, them: 0 }], "Jerred"), [], "your own call coming back is not a rival");
  assert.deepEqual(mergeRivals(undefined, [{ n: "Sam", us: 1, them: 0, extra: "x" }], ""), [{ n: "Sam", us: 1, them: 0 }], "only the three known fields are stored");
  assert.equal(mergeRivals(have, Array.from({ length: 20 }, (_, i) => ({ n: "N" + i, us: 0, them: 0 })), "").length, MAX_RIVALS);
});

test("rankCalls: result first, then goal difference, then goals; equal calls share a place", () => {
  const d = (us, them) => callDistance({ us, them }, 2, 1);
  assert.deepEqual(d(2, 1), [0, 0, 0]);
  assert.deepEqual(d(1, 0), [0, 0, 2], "right result and margin, both scores off by one");
  assert.deepEqual(d(3, 0), [0, 2, 2]);
  assert.deepEqual(d(1, 1), [1, 1, 1], "a draw called when it was a win");
  const r = rankCalls([{ n: "Draw", us: 1, them: 1 }, { n: "Big", us: 3, them: 0 }, { n: "Exact", us: 2, them: 1 }, { n: "Margin", us: 1, them: 0 }, { n: "Twin", us: 1, them: 0 }, { n: "Loss", us: 0, them: 2 }], 2, 1);
  assert.deepEqual(r.map(c => [c.n, c.place]), [["Exact", 1], ["Margin", 2], ["Twin", 2], ["Big", 4], ["Draw", 5], ["Loss", 6]]);
  assert.deepEqual(r.map(c => c.exact), [true, false, false, false, false, false]);
  assert.deepEqual(r.map(c => c.right), [true, true, true, true, false, false]);
  assert.ok(r.every(c => !("i" in c)), "no working fields left behind");
  assert.deepEqual(rankCalls([], 1, 0), []); assert.deepEqual(rankCalls(null, 1, 0), []);
  assert.deepEqual(rankCalls([{ n: "A", us: 0, them: 0 }, { n: "B", us: 2, them: 2 }], 1, 1).map(c => c.place), [1, 1], "0–0 and 2–2 are equally close to 1–1");
});
