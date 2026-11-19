// "Other international matches" (scores and tables from the feed) and "Your record" (points for score calls).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../js/core.js");
const { boot, fixture, clone } = require("./helpers/page.cjs");

const B = { cnl: fixture("board-concacaf-nations.json"), uefa: fixture("board-uefa-nations.json"), fr: fixture("board-friendly.json"), wc: fixture("board-world-cup.json"), ww: fixture("board-w-championship.json") };
const T = { uefa: fixture("tables-uefa-nations.json"), none: fixture("tables-none.json") };
const NOW = "2026-11-18T14:00:00Z";     // the morning after the recorded matches of Nov 17
const lgOf = url => /soccer\/([a-z0-9._]+)\/(scoreboard|standings)/.exec(url)[1];

/* ── The pure parts (js/core.js) ── */

test("world: a competition's matches are read from the feed, in order of kickoff", () => {
  const b = core.parseBoard(B.cnl);
  assert.equal(b.name, "Concacaf Nations League");
  assert.equal(b.matches.length, 9);
  assert.deepEqual(b.matches.map(m => m.date), b.matches.map(m => m.date).slice().sort());
  const usa = b.matches.find(m => m.home.id === "660");
  assert.deepEqual(usa, { id: usa.id, date: "2026-11-18T00:00Z", state: "post", clock: "FT", home: { id: "660", name: "United States", score: 2, pens: null }, away: { id: "2654", name: "Haiti", score: 0, pens: null },
    label: "Quarterfinals", note: "2nd Leg - United States win 8-0 on aggregate" });
  assert.equal(b.matches[0].label, "League B, Group D", "the competition's own name is taken off the front of the round label");
  assert.deepEqual(b.matches.slice(0, 2).map(m => m.home.name), ["Belize", "Dominica"], "matches at the same time are in name order");
  assert.equal(b.matches.find(m => m.home.name === "Mexico").note, "2nd Leg - Tied on aggregate - MEX win on away goals");
  assert.deepEqual([...new Set(core.parseBoard(B.fr).matches.map(m => m.label))], [""], "a friendly's label is only the competition's short name, so nothing is left");
  assert.equal(core.parseBoard({ leagues: [{ name: "Africa Cup of Nations Qualifying", abbreviation: "AFCON Qualifying" }], events: [{ id: 1, date: "2026-11-17T13:00Z", status: { type: { state: "post" } },
    competitions: [{ altGameNote: "AFCON Qualifying, Group I", competitors: [{ homeAway: "home", score: "1", team: { id: 1, displayName: "Burundi" } }, { homeAway: "away", score: "1", team: { id: 2, displayName: "Zambia" } }] }] }] }).matches[0].label, "Group I", "the short name is taken off too");
  const w = core.parseBoard(B.ww);
  assert.deepEqual(w.matches.map(m => [m.state, m.home.score, m.away.score]), [["pre", null, null], ["pre", null, null]], "a match not yet played has no score, not 0–0");
});

test("world: odd or missing feed data gives nothing rather than breaking", () => {
  for (const G of [null, undefined, {}, { events: "x" }, { events: [null, {}, { competitions: [] }, { date: "2026-11-17T19:00Z", competitions: [{ competitors: [] }] }, { date: "not a date", competitions: [{ competitors: [{ homeAway: "home", team: { displayName: "A" } }, { homeAway: "away", team: { displayName: "B" } }] }] }] }])
    assert.deepEqual(core.parseBoard(G), { name: "", matches: [] }, JSON.stringify(G));
  const one = core.parseBoard({ leagues: [{ name: "Cup" }], events: [{ id: 7, date: "2026-11-17T19:00Z", status: { type: { state: "weird", shortDetail: "Postponed" } },
    competitions: [{ altGameNote: "Cup Final", competitors: [{ homeAway: "away", score: "", shootoutScore: 3, team: { id: 2, displayName: "B <i>" } }, { homeAway: "home", score: "1", shootoutScore: 4, team: { id: 1, name: "A" } }] }] }] });
  assert.deepEqual(one.matches, [{ id: "7", date: "2026-11-17T19:00Z", state: "pre", clock: "Postponed", home: { id: "1", name: "A", score: null, pens: 4 }, away: { id: "2", name: "B <i>", score: null, pens: 3 }, label: "Final", note: "" }],
    "an unknown state counts as not played, and a match not played has no score");
});

test("world: a competition is active for four days after its matches and two weeks before them", () => {
  const at = iso => [{ date: iso, state: "post" }], now = Date.parse(NOW), day = 864e5;
  assert.equal(core.boardActive(at("2026-11-17T19:00Z"), now), true);
  assert.equal(core.boardActive(at(new Date(now - 4 * day + 6e4).toISOString()), now), true);
  assert.equal(core.boardActive(at(new Date(now - 4 * day - 6e4).toISOString()), now), false);
  assert.equal(core.boardActive(at(new Date(now + 14 * day - 6e4).toISOString()), now), true);
  assert.equal(core.boardActive(at(new Date(now + 14 * day + 6e4).toISOString()), now), false);
  assert.equal(core.boardActive([{ date: "2020-01-01T00:00Z", state: "in" }], now), true, "a match in progress is always active");
  assert.equal(core.boardActive(core.parseBoard(B.wc).matches, now), false, "last summer's World Cup final is not");
  assert.equal(core.boardActive([], now), false); assert.equal(core.boardActive(null, now), false);
});

test("world: which competitions are asked about, the USA's own first", () => {
  assert.equal(core.worldLeagues("men", "concacaf.nations.league")[0], "concacaf.nations.league");
  assert.equal(core.worldLeagues("men", "concacaf.nations.league").length, core.WORLD.men.length, "moved to the front, not added twice");
  assert.deepEqual(core.worldLeagues("women", null), core.WORLD.women);
  assert.deepEqual(core.worldLeagues("men", "fifa.friendly"), core.WORLD.men, "a friendly is not a tournament to put first: friendlies stay last");
  assert.deepEqual(core.worldLeagues("women", "fifa.friendly.w"), core.WORLD.women);
  assert.equal(core.worldLeagues("men", "some.new_cup")[0], "some.new_cup", "a competition the list does not know is still asked about when the USA is in it");
  for (const bad of ["../x", "a/b", "a b", "A.B", "x?y=1", ""]) assert.deepEqual(core.worldLeagues("men", bad), core.WORLD.men, JSON.stringify(bad) + " never reaches an address");
  assert.deepEqual(core.worldLeagues("nobody", null), []);
  for (const t of ["men", "women"]) {
    assert.equal(new Set(core.WORLD[t]).size, core.WORLD[t].length, "no competition listed twice");
    assert.ok(core.WORLD[t].every(s => /^[a-z0-9._]+$/.test(s)));
    assert.ok(/friendly/.test(core.WORLD[t][core.WORLD[t].length - 1]), "friendlies come last");
    assert.ok(!core.WORLD[t].some(s => /u17|u20|u21|u23|\.champions\b|libertadores|cwc/.test(s)), "no youth or club competitions");
  }
  assert.ok(!core.WORLD.men.some(s => core.WORLD.women.includes(s)), "men's and women's lists do not overlap");
});

test("world: tables are read group by group, in rank order", () => {
  const t = core.parseTables(T.uefa);
  assert.equal(t.length, 14);
  assert.equal(t[0].name, "Group A1");
  for (const g of t) { assert.ok(g.rows.length >= 3); assert.deepEqual(g.rows.map(r => r.pts), g.rows.map(r => r.pts).slice().sort((a, b) => b - a), g.name + " is in points order"); }
  assert.deepEqual(Object.keys(t[0].rows[0]), ["id", "name", "p", "w", "d", "l", "gd", "pts"]);
  const back = clone(T.uefa); for (const c of back.children) c.standings.entries.reverse();
  assert.deepEqual(core.parseTables(back), t, "whatever order the feed sends them in");
  const italy = t.flatMap(g => g.rows).find(r => r.name === "Italy");
  assert.deepEqual(italy, { id: "162", name: "Italy", p: 6, w: 3, d: 1, l: 2, gd: 2, pts: 10 });
  for (const G of [T.none, null, {}, { children: "x" }, { children: [null, { name: "G" }, { standings: { entries: [] } }, { standings: { entries: [null, { stats: [] }] } }] }]) assert.deepEqual(core.parseTables(G), [], JSON.stringify(G).slice(0, 60));
  assert.deepEqual(core.parseTables({ children: [{ name: "G", standings: { entries: [{ team: { id: 9, displayName: "X" }, stats: [{ name: "points", value: "7" }, { name: "wins", value: 2 }] }] } }] }),
    [{ name: "G", rows: [{ id: "9", name: "X", p: null, w: 2, d: null, l: null, gd: null, pts: null }] }], "a number that is not a number is left blank, not guessed");
});

test("record: 3 points for the exact score, 1 for the right result, and only finished, locked calls count", () => {
  const pts = (cu, ct, u, t) => core.callPoints({ us: cu, them: ct }, u, t);
  assert.equal(pts(2, 0, 2, 0), 3); assert.equal(pts(1, 1, 1, 1), 3);
  assert.equal(pts(3, 1, 2, 0), 1, "a win called as a win"); assert.equal(pts(0, 0, 2, 2), 1, "a draw called as a draw"); assert.equal(pts(0, 1, 1, 3), 1);
  assert.equal(pts(2, 0, 0, 2), 0); assert.equal(pts(1, 1, 2, 0), 0); assert.equal(pts(2, 0, 1, 1), 0);
  assert.deepEqual(core.callRecord({ a: { us: 2, them: 0, locked: true, fin: [2, 0] }, b: { us: 1, them: 0, locked: true, fin: [3, 1] }, c: { us: 0, them: 0, locked: true, fin: [1, 0] } }), { n: 3, pts: 4, exact: 1, right: 1 });
  assert.deepEqual(core.callRecord({ a: { us: 2, them: 0, locked: false, fin: [2, 0] }, b: { us: 2, them: 0, locked: true }, c: null, d: { us: "2", them: 0, locked: true, fin: [2, 0] }, e: { us: 2, them: 0, locked: true, fin: ["2", 0] }, f: { us: 2, them: 0, locked: true, fin: [2] } }),
    { n: 0, pts: 0, exact: 0, right: 0 }, "not locked, not finished, or not numbers: not counted");
  assert.deepEqual(core.callRecord(null), { n: 0, pts: 0, exact: 0, right: 0 });
});

/* ── On the page ── */
const boards = { "concacaf.nations.league": B.cnl, "uefa.nations": B.uefa, "fifa.friendly": B.fr, "fifa.world": B.wc, "concacaf.womens.championship": B.ww };
const emptyBoard = name => ({ leagues: [{ name }], events: [] });
async function world(opts = {}) {
  const p = await boot({ hash: "#men", now: NOW, board: url => (lgOf(url) in boards ? boards[lgOf(url)] : emptyBoard(lgOf(url))), tables: url => (lgOf(url) === "uefa.nations" ? T.uefa : T.none), ...opts });
  return p;
}
const asked = (p, what) => p.fetched.filter(u => u.includes("/" + what)).map(lgOf);
const comps = p => p.html("world").split('<details class="wxc"').slice(1);
const flat = s => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/* A tournament's match rows as text. Day headings are taken out first: which day a match falls on depends on the
   time zone of the machine running the tests, and a heading must not end up glued to the row before it. */
const rowsOf = c => c.replace(/<div class="wxd">[^<]*<\/div>/g, "").split('<div class="wxm ').slice(1).map(flat);

test("world: the section is folded and asks the feed for nothing until it is opened", async () => {
  const p = await world();
  assert.deepEqual(asked(p, "scoreboard"), [], "nobody who leaves it shut causes a single request");
  assert.match(p.html("world"), /^<div class="card sec"><details  ontoggle="setOpen\('s\.world',this\.open\)">/);
  assert.equal(p.text("world"), "Other international matches Scores, fixtures and tables for the active men's tournaments Loading…");
  assert.ok(p.html("world").length < 600, "one line on the page until then");
});

test("world: opened, it shows each active tournament's matches, the USA's tournament first", async () => {
  const p = await world();
  p.run("setOpen('s.world', true)"); await p.settle();
  assert.deepEqual(asked(p, "scoreboard"), core.worldLeagues("men", "concacaf.nations.league"), "one request per men's competition, no women's, the USA's own first");
  assert.ok(p.fetched.filter(u => u.includes("/scoreboard")).every(u => /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/soccer\/[a-z0-9._]+\/scoreboard$/.test(u)));
  assert.ok(p.tracked.some(x => /open-world/.test(x)));
  assert.match(p.text("world"), /^Other international matches 3 tournaments · 35 matches The latest or next matches in each men's tournament\. Tap one to open it\. Times are your local time\. /);
  const c = comps(p);
  assert.equal(c.length, 3, "last summer's World Cup and the competitions with nothing on are left out");
  assert.match(flat(c[0]), /^open[^>]*> Concacaf Nations League 9 matches /, "the USA's competition is open");
  assert.match(flat(c[1]), /^ontoggle[^>]*> UEFA Nations League 8 matches /, "the others are folded");
  assert.match(flat(c[2]), /> International Friendly 18 matches /);
  const rows = rowsOf(c[0]);
  assert.equal(rows.length, 9);
  assert.match(rows.find(r => /United States/.test(r)), /^me"> United States 2–0 Haiti 2nd Leg · United States win 8-0 on aggregate$/, "the USA's own match stands out, with how the tie ended");
  assert.match(rows.find(r => /Mexico/.test(r)), /^"> Mexico \d–\d Jamaica 2nd Leg · Tied on aggregate · MEX win on away goals$/);
  assert.match(rows[0], /^"> Belize 1–2 Sint Maarten League B, Group D$/, "home, score, away, then which group; a finished match needs no 'FT'");
  assert.match(c[0], /<span class="wxh">Belize<\/span><span class="wxs ">1–2<\/span><span class="wxa won">Sint Maarten<\/span><span class="wxn">League B, Group D<\/span>/, "the score sits between the two teams and the winner is marked");
  assert.match(c[0], /<summary>Concacaf Nations League <small>9 matches · [A-Z][a-z]{2} \d{1,2}( – [A-Z][a-z]{2} \d{1,2})?<\/small><\/summary>/, "the heading says how many matches and when");
  assert.ok((c[0].match(/class="wxd"/g) || []).length >= 1, "matches are headed by their day");
});

test("world: a long list shows ten until asked; friendlies have no tables", async () => {
  const p = await world();
  p.run("setOpen('s.world', true)"); await p.settle();
  let fr = comps(p)[2];
  assert.equal(fr.split('<div class="wxm ').length - 1, 10);
  assert.match(fr, /<button class="btn" onclick="S\.open\['wa\.fifa\.friendly'\]=true;renderWorld\(\)">Show all 18<\/button>/);
  assert.ok(!/Group tables/.test(fr), "a friendly has no table");
  p.run("S.open['wa.fifa.friendly']=true;renderWorld()");
  fr = comps(p)[2];
  assert.equal(fr.split('<div class="wxm ').length - 1, 18); assert.match(fr, /Show fewer/);
  assert.match(comps(p)[1], /<details class="wxtab"  ontoggle="worldTables\('uefa\.nations',this\.open\)"><summary>Group tables<\/summary>/);
});

test("world: a tournament's tables load when its Tables line is opened, once", async () => {
  const p = await world();
  p.run("setOpen('s.world', true)"); await p.settle();
  assert.deepEqual(asked(p, "standings"), [], "no tables are fetched until one is asked for");
  p.run("worldTables('uefa.nations', true)");
  assert.match(comps(p)[1], /<details class="wxtab" open[^>]*><summary>Group tables<\/summary><div class="empty">Loading…<\/div>/);
  await p.settle();
  assert.deepEqual(p.fetched.filter(u => u.includes("/standings")), ["https://site.api.espn.com/apis/v2/sports/soccer/uefa.nations/standings"]);
  const t = comps(p)[1];
  assert.equal((t.match(/<div class="wxg">/g) || []).length, 14, "every group");
  assert.match(t, /<div class="wxg">Group A1<\/div><table class="tbl wxtbl"><tr><th><\/th><th>P<\/th><th>W<\/th><th>D<\/th><th>L<\/th><th>GD<\/th><th>Pts<\/th><\/tr>/);
  assert.match(t, /<tr class=""><td>Italy<\/td><td>6<\/td><td>3<\/td><td>1<\/td><td>2<\/td><td>\+2<\/td><td><b>10<\/b><\/td><\/tr>/, "goal difference carries its sign");
  assert.ok(p.tracked.some(x => /world-tables/.test(x)));
  p.run("worldTables('uefa.nations', true)"); p.run("worldTables('uefa.nations', false)"); p.run("worldTables('uefa.nations', true)"); await p.settle();
  assert.equal(asked(p, "standings").length, 1, "shutting and reopening does not fetch again");
  p.run("worldTables('concacaf.nations.league', true)"); await p.settle();
  assert.match(comps(p)[0], /No tables: this tournament, or this stage of it, is a knockout\./, "a competition with no table says why");
  const q = await world({ tables: () => undefined });
  q.run("setOpen('s.world', true)"); await q.settle(); q.run("worldTables('uefa.nations', true)"); await q.settle();
  assert.match(comps(q)[1], /Couldn't load the tables\./);
});

test("world: the women's side asks about women's competitions and shows matches still to come", async () => {
  const p = await world();
  p.run("setOpen('s.world', true)"); await p.settle();
  const before = p.fetched.length;
  p.run("pickTeam('women')"); await p.settle();
  assert.deepEqual(p.fetched.slice(before).filter(u => u.includes("/scoreboard")).map(lgOf), core.worldLeagues("women", p.run("focus().lg")), "switching team asks again, for the women's list");
  assert.match(p.text("world"), /^Other international matches 1 tournament · 2 matches The latest or next matches in each women's tournament/);
  const rows = rowsOf(comps(p)[0]);
  assert.match(rows[0], /^"> Jamaica \d{1,2}:\d\d [AP]M Costa Rica Quarterfinals$/, "a kickoff time where the score will be, for a match not yet played");
  assert.match(comps(p)[0], /<span class="wxs pre">\d{1,2}:\d\d [AP]M<\/span>/);
  assert.match(flat(comps(p)[0]), /^open[^>]*> Concacaf W Championship 2 matches /);
});

test("world: a match in progress is counted as live and the scores are fetched again a minute later", async () => {
  const live = clone(B.uefa); live.events[0].status.type = { state: "in", shortDetail: "67'" }; live.events[0].competitions[0].status.type = { state: "in", shortDetail: "67'" };
  const p = await world({ board: url => (lgOf(url) === "uefa.nations" ? live : emptyBoard(lgOf(url))) });
  p.run("setOpen('s.world', true)"); await p.settle();
  assert.match(p.text("world"), /^Other international matches 1 tournament · 8 matches · 1 live /);
  assert.match(comps(p)[0], /<small>8 matches · <span class="on">1 live<\/span><\/small>/);
  assert.match(comps(p)[0], /<span class="wxs on">\d–\d<small>67&#39;<\/small><\/span>/, "a live match shows its score in red with the minute under it");
  assert.match(comps(p)[0], /^  ontoggle/, "a tournament the USA is not in starts folded, even when it is the only one");
  const n = asked(p, "scoreboard").length;
  await p.fire(t => t.ms === 6e4); await p.settle();
  assert.equal(asked(p, "scoreboard").length, n * 2, "every competition is asked again after a minute");
  const quiet = await world();
  quiet.run("setOpen('s.world', true)"); await quiet.settle();
  const m = asked(quiet, "scoreboard").length;
  await quiet.fire(t => t.ms === 6e4); await quiet.settle();
  assert.equal(asked(quiet, "scoreboard").length, m, "with nothing live there is no repeat request");
});

test("world: when the feed cannot be reached, or nothing is on, the section says so", async () => {
  const off = await world({ board: () => undefined });
  off.run("setOpen('s.world', true)"); await off.settle();
  assert.match(off.text("world"), /Couldn't load other matches\. Try again$/);
  assert.match(off.html("world"), /<button class="btn" onclick="loadWorld\(\)">Try again<\/button>/);
  const part = await world({ board: url => (lgOf(url) === "uefa.nations" ? B.uefa : undefined) });
  part.run("setOpen('s.world', true)"); await part.settle();
  assert.match(part.text("world"), /1 tournament · 8 matches/, "what could be read is shown");
  const none = await world({ board: url => (lgOf(url) === "fifa.world" ? B.wc : emptyBoard(lgOf(url))) });
  none.run("setOpen('s.world', true)"); await none.settle();
  assert.match(none.text("world"), /No men's international tournament has a match in the last few days or the next two weeks\.$/);
});

test("world: names and notes from the feed are drawn as plain text", async () => {
  const evil = clone(B.uefa);
  evil.leagues[0].name = "Cup <img src=x onerror=alert(1)>";
  evil.events[0].competitions[0].competitors[0].team.displayName = "<script>alert(1)</script>";
  evil.events[0].competitions[0].notes = [{ headline: "<b>note</b>" }]; evil.events[1].competitions[0].altGameNote = "<i>round</i>";
  evil.events[0].status.type.shortDetail = "<u>FT</u>"; evil.events[0].competitions[0].status.type.shortDetail = "<u>FT</u>";
  const t = clone(T.uefa); t.children[0].name = "<b>Group</b>"; t.children[0].standings.entries[0].team.displayName = "<img src=x>";
  const p = await world({ board: url => (lgOf(url) === "uefa.nations" ? evil : emptyBoard(lgOf(url))), tables: () => t });
  p.run("setOpen('s.world', true)"); await p.settle(); p.run("worldTables('uefa.nations', true)"); await p.settle();
  const html = p.html("world");
  assert.ok(!/<script>|<img|<b>note|<i>round|<u>FT|<b>Group/.test(html), "nothing from the feed becomes markup");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.match(html, /Cup &lt;img src=x onerror=alert\(1\)&gt;/);
});

/* ── Your record ── */
const KEY = "wc2026.usa.v1.calls";
const callsIn = p => JSON.parse(p.store[KEY]);

test("record: a locked call is graded once its match is in the results, and the tally shows with the score call", async () => {
  // In the recorded data the men beat Canada 1–0 (401905188), Mexico 3–0 (401905202) and Chile 4–2 (401905189).
  const calls = { "401905188": { us: 1, them: 0, locked: true }, "401905202": { us: 2, them: 0, locked: true }, "401905189": { us: 0, them: 1, locked: true }, "401905203": { us: 4, them: 1, locked: false }, "999": { us: 1, them: 1, locked: true } };
  const p = await boot({ hash: "#men", storage: { [KEY]: JSON.stringify(calls) } });
  const saved = callsIn(p);
  assert.deepEqual([saved["401905188"].fin, saved["401905202"].fin, saved["401905189"].fin], [[1, 0], [3, 0], [4, 2]], "the final scores are kept with the calls, on the device");
  assert.equal(saved["999"].fin, undefined, "a call for a match not in the results waits");
  assert.equal(saved["401905203"].fin, undefined, "a call that was never locked in is not graded, even though it would have been exact");
  assert.match(p.text("hero"), /Lock in my call Your record: 4 points from 3 calls · 1 exact score 3 for the exact score, 1 for the right result\. Kept on this phone\./);
  assert.match(p.html("hero"), /<div class="rec">Your record: <b>4 points<\/b> from 3 calls · 1 exact score/);
  p.run("setOpen('s.results', true)");
  const t = p.text("results");
  assert.match(t, /vs Canada Friendly You called USA 1–0 Canada · 3 points 1–0 W /); assert.match(t, /You called USA 2–0 Mexico · 1 point /); assert.match(t, /You called USA 0–1 Chile · 0 points/);
  assert.equal((t.match(/You called/g) || []).length, 3, "only matches with a locked call say so");
});

test("record: the tally survives a match leaving the results list, stays with a locked call, and is absent with nothing to show", async () => {
  const men = clone(fixture("data-men.json")); men.results = men.results.filter(r => r.id !== "401905188");
  const kept = await boot({ hash: "#men", data: { men }, storage: { [KEY]: JSON.stringify({ "401905188": { us: 1, them: 0, locked: true, fin: [1, 0] }, "401929710": { us: 3, them: 1, locked: true } }) } });
  assert.match(kept.text("hero"), /Your call Haiti 1–3 USA .*Your record: 3 points from 1 call · 1 exact score/, "shown under a locked call too, and one call is not 'calls'");
  const none = await boot({ hash: "#men" });
  assert.ok(!/Your record/.test(none.text("hero")), "no calls yet: no record line");
  assert.equal(none.store[KEY], undefined, "and nothing is written");
  const zero = await boot({ hash: "#men", storage: { [KEY]: JSON.stringify({ "401905189": { us: 0, them: 3, locked: true } }) } });
  assert.match(zero.text("hero"), /Your record: 0 points from 1 call 3 for the exact score/, "a wrong call still counts as a call");
});

test("world and record: the files the tests use are small", () => {
  for (const f of fs.readdirSync(path.join(__dirname, "fixtures")).filter(f => /^(board|tables)-/.test(f))) assert.ok(fs.statSync(path.join(__dirname, "fixtures", f)).size < 20e3, f + " stays small");
});

test("world: what goes under the score, and when a team is marked as the winner", async () => {
  const b = clone(B.uefa), ev = b.events;
  const set = (i, state, detail, hs, as, pens) => { const c = ev[i].competitions[0]; ev[i].status.type = c.status.type = { state, shortDetail: detail };
    c.competitors.find(t => t.homeAway === "home").score = hs; c.competitors.find(t => t.homeAway === "away").score = as;
    if (pens) { c.competitors.find(t => t.homeAway === "home").shootoutScore = pens[0]; c.competitors.find(t => t.homeAway === "away").shootoutScore = pens[1]; } };
  set(0, "post", "AET", "2", "1"); set(1, "post", "FT-Pens", "1", "1", [4, 3]); set(2, "post", "Postponed", "", ""); set(3, "in", "HT", "0", "0"); set(4, "post", "FT", "1", "1");
  const p = await world({ board: url => (lgOf(url) === "uefa.nations" ? b : emptyBoard(lgOf(url))) });
  p.run("setOpen('s.world', true)"); await p.settle();
  const html = comps(p)[0], rows = rowsOf(html), row = name => rows.find(r => r.includes(name));
  const parsed = core.parseBoard(b).matches, home = i => parsed.find(m => m.id === String(ev[i].id)).home.name;
  assert.match(row(home(0)), new RegExp("^\"> " + home(0) + " 2–1 AET "), "extra time is said under the score");
  assert.match(row(home(1)), /1–1 FT-Pens .* · 4–3 on penalties$/, "a shootout's score is in the line underneath");
  assert.match(row(home(2)), new RegExp(home(2) + " Postponed "), "a match that was not played says why, with no score");
  assert.match(row(home(3)), /0–0 HT /);
  assert.ok(!/ FT /.test(row(home(4))), "a plain full-time result needs no label");
  assert.match(html, new RegExp('<span class="wxh won">' + home(0) + "</span>"), "the winner is marked");
  const drawn = html.split('<div class="wxm ').slice(1).find(r => r.includes(home(4)));
  assert.ok(!/ won"/.test(drawn), "nobody is marked in a draw");
  const live = html.split('<div class="wxm ').slice(1).find(r => r.includes(home(3)));
  assert.ok(!/ won"/.test(live), "nor while a match is still being played");
});
