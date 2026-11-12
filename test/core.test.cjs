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

test("parseSummary: a broken or empty payload returns null instead of throwing", () => {
  assert.equal(core.parseSummary({}, USA), null);
  assert.equal(core.parseSummary({ header: {} }, USA), null);
});
