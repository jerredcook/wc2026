/* What each section actually puts on screen, in every state the app can be in.
   The page's own code runs against recorded data with a fixed clock
   (see helpers/page.cjs). Run: node --test */
process.env.TZ = "America/New_York";   // kickoff times in the assertions are Eastern
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, fixture, clone, summaryAs, replay } = require("./helpers/page.cjs");
const core = require("../js/core.js");

const SECTIONS = ["nextup", "hero", "stories", "pool", "oppo", "fixtures", "results", "poll"];
const NOTICE = "couldn't be shown";
const before = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b); assert.ok(i >= 0, `"${a}" is missing`); assert.ok(j >= 0, `"${b}" is missing`); assert.ok(i < j, `"${a}" should come before "${b}"`); };

test("first load: every section fills in, nothing fails, nothing is reported", async () => {
  const p = await boot();
  for (const id of SECTIONS) {
    assert.ok(p.text(id).length > 40, `#${id} is empty`);
    assert.ok(!p.text(id).includes(NOTICE), `#${id} shows the failure notice`);
    assert.ok(!/undefined|NaN|\[object Object\]/.test(p.text(id)), `#${id} shows a raw value: ${(/.{20}(undefined|NaN|\[object Object\]).{20}/.exec(p.text(id)) || [""])[0]}`);
  }
  assert.deepEqual(p.tracked.filter(t => /error/.test(t)), []);
});

test("both teams are up top, women first, and the page opens on the sooner match", async () => {
  const p = await boot();
  const t = p.text("nextup");
  before(t, "Women · next", "Men · next");
  assert.match(t, /vs El Salvador/); assert.match(t, /at Haiti/);
  assert.match(t, /Qualifier/); assert.match(t, /Competitive/);
  assert.match(t, /In 2 days/);
  assert.equal(p.run("S.team"), "men", "Haiti (Nov 14) comes before El Salvador (Nov 27)");
  assert.equal((p.html("nextup").match(/class="nu on"/g) || []).length, 1, "exactly one team card is selected");
});

test("a link that names a team opens on that team", async () => {
  const p = await boot({ hash: "#women" });
  assert.equal(p.run("S.team"), "women");
  assert.match(p.text("hero"), /El Salvador/);
  assert.match(p.text("pool"), /^Women — player pool/);
  assert.match(p.text("results"), /^Women — results/);
});

test("before kickoff: when, where to watch and what it is for come first", async () => {
  const p = await boot({ summary: fixture("summary-prematch-haiti-usa.json") });
  const t = p.text("hero");
  assert.match(t, /^Next match · Concacaf Nations League · Quarterfinals · 1st Leg/);
  before(t, "Haiti", "United States");                  // away match: the home side is on the left
  assert.match(t, /Sat, Nov 14 · 4:30 PM/);
  assert.match(t, /02 days 06 hrs 30 min/);
  assert.match(t, /Nu Stadium · Miami, Florida/);
  assert.match(t, /Watch on TBS truTV Universo HBO Max Peacock/);
  assert.match(t, /What is this match\? Competitive/);
  assert.match(t, /Competition Concacaf Nations League\./);
  assert.match(t, /This match Quarterfinal, the first of two matches against Haiti/);
  assert.match(t, /At stake STAKES: the winner goes to the finals\./);
  before(t, "4:30 PM", "Watch on"); before(t, "Watch on", "What is this match?");
  before(t, "What is this match?", "Win expectancy"); before(t, "Win expectancy", "Call the score");
  assert.match(t, /16% 84%/, "Haiti (home, left) 16%, USA 84%");
  assert.match(t, /FIFA #84/); assert.match(t, /FIFA #16/);
  assert.match(t, /USA leads series/);
  assert.match(t, /Lineups appear here about an hour before kickoff/);
  assert.match(t, /Add to calendar/);
  assert.ok(!/LIVE|Full time/.test(t));
});

test("the deeper story: how it works, history, and how each side got here", async () => {
  const p = await boot();
  const t = p.text("hero");
  assert.match(t, /More about the Concacaf Nations League/);
  assert.match(t, /How it works HOW it works text\./);
  assert.match(t, /History HISTORY text\./);
  assert.match(t, /How the USA got here USROAD text\./);
  assert.match(t, /How Haiti got here Haiti finished 2nd of 6 in League A, Group A \(3 won, 0 drawn, 1 lost\)\./);
  assert.match(t, /3–2 v Trinidad and Tobago/);
  assert.match(t, /What comes next NEXT text\./);
});

test("where the round stands: all four ties, the USA's first", async () => {
  const p = await boot();
  const t = p.text("hero");
  assert.match(t, /Quarterfinals — where it stands/);
  for (const tie of ["Haiti v United States", "Curaçao v Panama", "Guatemala v Canada", "Jamaica v Mexico"]) assert.ok(t.includes(tie), tie);
  before(t, "Haiti v United States", "Curaçao v Panama");
});

test("the stadium: capacity, opening year, home team", async () => {
  const p = await boot();
  assert.match(p.text("hero"), /The stadium — Nu Stadium 26,700 seats · opened 2026 · home of Inter Miami/);
});

test("live: score the right way round, minute, timeline, stats, no countdown", async () => {
  const p = await boot({ summary: summaryAs("in", "67'") });
  const t = p.text("hero");
  assert.match(t, /^Live now ·/);
  assert.match(t, /Haiti FIFA #84 0 : 1 LIVE 67' United States/, "USA is away, so its goal is on the right");
  assert.match(t, /29' ⚽ Justin Ellis \(assist Alex Freeman\)/);
  assert.match(t, /Possession/); assert.match(t, /Shots/);
  assert.ok(!/02 days|Call the score|Add to calendar|Win expectancy/.test(t), "pre-match items are gone once it is live");
  assert.match(p.text("nextup"), /Men · next at Haiti .* LIVE/);
  assert.match(p.html("hero"), /class="card hero live/);
});

test("live: a goal since the last update flashes the card", async () => {
  const noGoal = summaryAs("in", "20'");
  noGoal.header.competitions[0].competitors.forEach(c => { c.score = "0"; });
  const p = await boot({ summary: noGoal });
  assert.ok(!/class="card hero live flash/.test(p.html("hero")));
  p.setSummary(summaryAs("in", "30'"));
  await p.refresh();
  assert.match(p.html("hero"), /class="card hero live flash/);
});

test("live: when updates stop arriving the last score stays and the card says so", async () => {
  const p = await boot({ summary: summaryAs("in", "67'") });
  p.setSummary(null);                               // the feed goes away
  p.run("S.liveOk = Date.now() - 5 * 60 * 1000");   // and has been away for five minutes
  await p.refresh();
  const t = p.text("hero");
  assert.match(t, /0 : 1/, "the last known score is still shown");
  assert.match(t, /Connection lost\. Retrying/);
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), [], "a dropped connection is not an error");
});

test("full time: final score, no live badge", async () => {
  const p = await boot({ summary: summaryAs("post") });
  const t = p.text("hero");
  assert.match(t, /^Full time ·/);
  assert.match(t, /0 : 1 Full time/);
  assert.ok(!/LIVE|Watch on|Call the score/.test(t));
});

test("second leg: the first-leg result is carried into the explanation", async () => {
  const men = fixture("data-men.json");
  const first = men.fixtures.shift();               // the first leg has been played…
  men.results.unshift({ ...first, state: "post", us: 2, them: 0 });
  const p = await boot({ data: { men }, now: "2026-11-16T15:00:00Z" });
  const t = p.text("hero");
  assert.match(t, /2nd Leg/);
  before(t, "United States", "Haiti");               // home this time: USA on the left
  assert.match(t, /the second of two matches against Haiti\. The USA leads 2–0 from the first/);
  assert.match(t, /First leg USA 2–0 Haiti/);
  assert.match(t, /84% 16%/, "home side on the left: USA 84%");
});

test("a friendly says so, with no competition lecture", async () => {
  const men = fixture("data-men.json");
  men.fixtures = men.fixtures.filter(m => /Friendly/.test(m.comp));
  const p = await boot({ data: { men }, hash: "#men" });
  const t = p.text("hero");
  assert.match(t, /What is this match\? Friendly/);
  assert.match(t, /This match A friendly against Jamaica\./);
  assert.match(t, /At stake Nothing but form/);
  assert.ok(!/Competition /.test(t) && !/More about/.test(t));
});

test("no match scheduled: the card and the team tile say so instead of breaking", async () => {
  const women = fixture("data-women.json"); women.fixtures = []; women.opp = null;
  const p = await boot({ data: { women }, hash: "#women" });
  assert.match(p.text("hero"), /No match on the schedule yet/);
  assert.match(p.text("nextup"), /Women · next No match scheduled/);
  assert.equal(p.text("oppo"), "");
  assert.ok(p.text("pool").length > 100, "the squad still shows");
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), []);
});

test("calendar: both teams in date order, with dates further ahead and no past ones", async () => {
  const p = await boot();
  const t = p.text("fixtures");
  before(t, "at Haiti", "vs Haiti"); before(t, "vs Haiti", "vs El Salvador"); before(t, "vs El Salvador", "vs Jamaica");
  assert.match(t, /Add all matches to my calendar/);
  assert.match(t, /Further ahead/);
  assert.match(t, /W W Championship final · Houston/);
  assert.match(t, /M Gold Cup If they qualify/);
  assert.ok(!t.includes("Long past"));
});

test("calendar subscription links point at the feed", async () => {
  const p = await boot();
  p.run("openSub()");
  assert.equal(p.els.subApple.href, "webcal://test.local/wc2026/data/usa/all.ics");
  assert.equal(p.els.subGoogle.href, "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent("http://test.local/wc2026/data/usa/all.ics"));
  assert.equal(p.els.sub.open, true);
  assert.ok(p.tracked.includes("capday: calendar-opened"));
});

test("players: called-up and recent call-ups are separate, with caps and plain-word statuses", async () => {
  const p = await boot();
  const t = p.text("pool");
  assert.match(t, /In the squad \(25\)/);
  assert.match(t, /Recent call-ups, not in this squad \(31\)/, "32 on the list, minus one retired");
  before(t, "In the squad (25)", "Recent call-ups");
  assert.match(t, /Christian Pulisic 90 caps · 33 goals/);
  assert.match(t, /AC Milan · age 28 · played 3 of last 3 for club/);
  assert.match(t, /Auston Trusty 14 caps · 1 goal Celtic · age 28 · played 0 of last 3 for club/);
  assert.match(t, /Left out of Celtic's matchday squad/);
  assert.match(t, /last called up: /);
  assert.ok(!t.includes("Tim Ream"), "retired players are not part of the pool");
  assert.match(t, /Caps \(international appearances\) and goals as of October 6, 2026/);
});

test("players: filters and expanding a row", async () => {
  const p = await boot();
  p.run("setPos('G')");
  let t = p.text("pool");
  assert.match(t, /Goalkeepers/); assert.ok(!/Defenders|Forwards/.test(t));
  p.run("setPos('cur')");
  t = p.text("pool");
  assert.ok(!t.includes("Recent call-ups, not in this squad"));
  const id = p.run("S.data.men.pool.find(x => x.name === 'Christian Pulisic').id");
  p.run(`togglePlayer('${id}')`);
  assert.match(p.text("pool"), /\(Serie A\)/, "the expanded row lists each club match with its competition");
});

test("storylines: the run, form, minutes and the opponent's threat, all from the data", async () => {
  const p = await boot({ summary: fixture("summary-prematch-haiti-usa.json") });
  const t = p.text("stories");
  assert.match(t, /The USA has won 4 straight , outscoring opponents 12–3\./);
  assert.match(t, /USA leads series 3-0-2\. Last meeting: USA 2–1 in the 2025 Concacaf Gold Cup\./);
  assert.match(t, /arrives in form: /);
  assert.match(t, /Short of club minutes: Auston Trusty/);
  assert.match(t, /Watch Haiti's /);
  assert.ok(!t.includes("Tim Ream"));
});

test("results: newest first, each with a result and a purpose tag; a row expands to its timeline", async () => {
  const p = await boot({ summary: summaryAs("post") });
  const t = p.text("results");
  before(t, "vs Canada", "vs Mexico");
  assert.match(t, /vs Canada Friendly 1–0 W/);
  p.run("toggleMatch(S.data.men.results[0].id)");
  await p.settle();
  assert.match(p.text("results"), /29' ⚽ Justin Ellis/);
});

test("call the score: adjust, lock, share, and it is graded live and at full time", async () => {
  const p = await boot({ summary: fixture("summary-prematch-haiti-usa.json") });
  const id = "401929710";
  assert.match(p.text("hero"), /Call the score Haiti − 0 \+ USA − 2 \+ Lock in my call/);
  p.run(`bump('${id}','us',-1)`);                    // 1–0 to the USA
  p.run(`lockCall('${id}',true)`);
  assert.match(p.text("hero"), /Your call Haiti 0–1 USA/);
  assert.match(p.text("hero"), /Challenge a friend Change/);
  assert.deepEqual(JSON.parse(p.store["wc2026.usa.v1.calls"])[id], { us: 1, them: 0, locked: true }, "the call is saved on the device");
  assert.ok(p.tracked.includes("capday: call-locked"));
  p.setSummary(summaryAs("in", "67'")); await p.refresh();
  assert.match(p.text("hero"), /Your call Haiti 0–1 USA 🎯 On the money right now\./);
  assert.match(p.text("hero"), /Share my call/); assert.ok(!/Challenge a friend|Change/.test(p.text("hero")), "after kickoff a call can be shared but not changed or used to challenge");
  p.setSummary(summaryAs("post")); await p.refresh();
  assert.match(p.text("hero"), /🎯 Spot on — exact score!/);
});

test("a saved call survives a reload", async () => {
  const p = await boot({ storage: { "wc2026.usa.v1.calls": JSON.stringify({ "401929710": { us: 3, them: 1, locked: true } }) } });
  assert.match(p.text("hero"), /Your call Haiti 1–3 USA/);
});

test("feedback: two questions, then thanks, counted as events and remembered", async () => {
  const p = await boot();
  assert.match(p.text("poll"), /Would you use Cap Day/);
  p.run("pollUseful('yes')");
  assert.match(p.text("poll"), /What would make it better\?/);
  p.run("pollWant('reminders')");
  assert.match(p.text("poll"), /Thanks/);
  assert.deepEqual(p.tracked.filter(x => /poll/.test(x)), ["capday: poll-useful-yes", "capday: poll-want-reminders"]);
  const again = await boot({ storage: p.store });
  assert.match(again.text("poll"), /Thanks/, "answered once, not asked again");
});

test("news: headlines for the selected team, and only plain https links become links", async () => {
  const p = await boot({ news: { articles: [
    { headline: "Real story", published: "2026-11-11T10:00Z", type: "Story", links: { web: { href: "https://www.espn.com/soccer/story/1" } } },
    { headline: "Video item", published: "2026-11-11T09:00Z", type: "Media", links: { web: { href: "https://www.espn.com/video/2" } } },
    { headline: "Bad link", published: "2026-11-11T08:00Z", type: "Story", links: { web: { href: "javascript:alert(1)" } } },
    { headline: "No link", published: "2026-11-11T07:00Z", type: "Story" },
  ] } });
  const t = p.text("news");
  assert.match(t, /^Men — news/);
  assert.match(t, /Real story/); assert.match(t, /▶ Video item/);
  assert.ok(!t.includes("Bad link") && !t.includes("No link"));
  assert.ok(!p.html("news").includes("javascript:"));
});

test("text from the feeds is always escaped, never run as HTML", async () => {
  const evil = '<img src=x onerror="alert(1)">';
  const men = fixture("data-men.json");
  men.fixtures[0].opp.name = evil; men.fixtures[0].venue = evil; men.fixtures[0].tv = [evil];
  men.pool[0].name = evil; men.pool[0].club.name = evil; men.results[0].opp.name = evil; men.squadNote = evil;
  men.opp.pool[0].name = evil;
  const live = summaryAs("in"); live.keyEvents.forEach(k => (k.participants || []).forEach(x => { if (x.athlete) x.athlete.displayName = evil; }));
  live.rosters.forEach(r => r.roster.forEach(x => { x.athlete.displayName = evil; }));
  const p = await boot({ data: { men }, hash: "#men", summary: live, editorial: { "401929710": { stakes: evil }, comps: { "concacaf.nations.league": { how: evil, history: evil } } },
    news: { articles: [{ headline: evil, published: "2026-11-11T10:00Z", links: { web: { href: "https://www.espn.com/x" } } }] } });
  for (const id of [...SECTIONS, "news"]) {
    assert.ok(!p.html(id).includes("<img src=x"), `#${id} let raw HTML from a feed through`);
    assert.ok(!p.text(id).includes(NOTICE), `#${id} failed on unusual text`);
  }
  assert.ok(p.html("hero").includes("&lt;img src=x"), "the text is shown, escaped");
});

test("one broken section shows a notice, the rest carry on, and the error is reported", async () => {
  const p = await boot();
  p.run("S.data.men.pool = null; render()");
  assert.match(p.text("pool"), /couldn't be shown just now/);
  for (const id of ["nextup", "hero", "fixtures", "results"]) { assert.ok(p.text(id).length > 40); assert.ok(!p.text(id).includes(NOTICE)); }
  assert.ok(p.tracked.some(x => /^capday: error players: .+ \[v\d+\.\d+\.\d+(-pre)?\]$/.test(x)), "the report names the section and the app version");
});

test("the data files failing to load: the page says so, keeps trying, and fills in when they come back", async () => {
  const p = await boot({ data: { men: null, women: null } });
  assert.match(p.text("hero"), /Couldn't load the schedule.*trying again/);
  assert.match(p.text("nextup"), /Couldn't load/);
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), []);
  const retry = t => t.ms === 5000;
  assert.equal(p.timers.filter(retry).length, 1, "a retry is scheduled");

  assert.equal(await p.fire(retry), 1);                       // still unreachable
  assert.match(p.text("hero"), /Couldn't load the schedule/);
  assert.equal(p.timers.filter(t => t.ms === 10000 && !/refreshLive/.test(t.fn.name)).length >= 1, true, "the next retry waits longer");

  p.setData("men", fixture("data-men.json")); p.setData("women", fixture("data-women.json"));
  await p.fire(t => t.ms === 10000 && !/refreshLive/.test(t.fn.name));
  assert.match(p.text("hero"), /Haiti/, "the match card fills in once the data arrives");
  for (const id of SECTIONS) assert.ok(!p.text(id).includes(NOTICE), `#${id}`);
});

test("a data file that is not the expected shape is treated as not loaded", async () => {
  const p = await boot({ data: { men: { hello: "world" }, women: { fixtures: "nope" } } });
  assert.match(p.text("hero"), /Couldn't load the schedule/);
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), []);
});

test("a request that hangs is given up on after ten seconds", async () => {
  const p = await boot({ hang: /\/summary\?event=/ });
  const giveUp = t => t.ms === 10000;
  assert.match(p.text("hero"), /Haiti/, "the card shows what the data file has while the live feed hangs");
  assert.equal(p.timers.filter(t => /refreshLive/.test(t.fn.name)).length, 0, "the live check is still waiting");
  assert.ok(p.timers.filter(giveUp).length >= 1, "a time limit is running");
  await p.fire(giveUp);
  assert.equal(p.timers.filter(t => /refreshLive/.test(t.fn.name)).length, 1, "after giving up, the next live check is scheduled");
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), []);

  const q = await boot({ hang: /data\/usa\/(men|women)\.json/ });
  assert.match(q.text("hero"), /Loading/);
  await q.fire(giveUp); await q.fire(giveUp);
  assert.match(q.text("hero"), /Couldn't load the schedule/, "a hung data file ends as a clear message, not endless loading");
});

test("old information is flagged: a notice when the data job has not checked for over 30 hours", async () => {
  const at = hoursAgo => new Date(Date.parse("2026-11-12T15:00:00Z") - hoursAgo * 36e5).toISOString();
  const withChecked = hrs => { const m = fixture("data-men.json"), w = fixture("data-women.json"); if (hrs != null) { m.checked = at(hrs); w.checked = at(hrs); } return { men: m, women: w }; };

  const fresh = await boot({ data: withChecked(3) });
  assert.equal(fresh.el("stale").hidden, true);
  assert.match(fresh.el("stamp").textContent, /checked Nov 12/);

  const old = await boot({ data: withChecked(31) });
  assert.equal(old.el("stale").hidden, false);
  assert.match(old.el("stale").textContent, /last checked 31 hours ago and may be out of date\. Live scores are not affected/);
  assert.equal(old.tracked.filter(x => x === "capday: stale-data").length, 1, "counted once, so it can be noticed");

  const ancient = await boot({ data: withChecked(24 * 9) });
  assert.match(ancient.el("stale").textContent, /last checked 9 days ago/);

  const unknown = await boot({ data: withChecked(null) });
  assert.equal(unknown.el("stale").hidden, true, "no claim either way when the file does not say when it was checked");
});

test("a newer build: a refresh is offered when the app's code has changed since the page opened", async () => {
  const p = await boot({ build: { code: "aaa" } });
  assert.equal(p.el("update").hidden, true);
  const recheck = async () => { p.run("buildChecked = 0; checkBuild()"); await p.settle(); };

  await recheck();
  assert.equal(p.el("update").hidden, true, "same build: nothing to offer");

  p.setBuild("<html>not json</html>"); await recheck();
  p.setBuild(null); await recheck();
  assert.equal(p.el("update").hidden, true, "an unreadable or missing answer changes nothing");

  p.setBuild({ code: "bbb" }); await recheck();
  assert.equal(p.el("update").hidden, false);
  assert.equal(p.tracked.filter(x => x === "capday: update-offered").length, 1);
  await recheck();
  assert.equal(p.tracked.filter(x => x === "capday: update-offered").length, 1, "offered once");
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), []);

  const before = p.fetched.filter(u => u.includes("build.json")).length;
  p.run("checkBuild(); checkBuild()"); await p.settle();
  assert.equal(p.fetched.filter(u => u.includes("build.json")).length, before, "it does not ask again within five minutes");

  const none = await boot();
  assert.equal(none.el("update").hidden, true, "no build file (opened from a folder): the feature stays quiet");
});

test("the live feed being unreachable before kickoff still shows everything the data file has", async () => {
  const p = await boot({ summary: null });
  const t = p.text("hero");
  assert.match(t, /Sat, Nov 14 · 4:30 PM/); assert.match(t, /Watch on TBS/); assert.match(t, /What is this match\?/);
  assert.deepEqual(p.tracked.filter(x => /error/.test(x)), []);
});

test("the iPhone tip shows on an iPhone, once, and never on Android", async () => {
  const android = await boot();
  assert.equal(android.el("iosTip").hidden, true);
  const iphone = await boot({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  assert.equal(iphone.el("iosTip").hidden, false);
  const dismissed = await boot({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", storage: { "wc2026.usa.v1.iostip": "1" } });
  assert.equal(dismissed.el("iosTip").hidden, true);
});

test("test mode points the card at another match, with the home side standing in", async () => {
  const p = await boot({ search: "?test=fifa.friendly:401905188", summary: summaryAs("in", "67'") });
  const t = p.text("hero");
  assert.match(t, /TEST MODE/);
  assert.match(t, /United States .* 1 : 0 LIVE 67' Canada/);
});

test("polling: every 30 seconds while live, and it stops at full time", async () => {
  const live = await boot({ summary: summaryAs("in") });
  assert.equal(live.timers.filter(t => /refreshLive/.test(t.fn.name)).pop().ms, 30000);
  const done = await boot({ summary: summaryAs("post") });
  assert.equal(done.timers.filter(t => /refreshLive/.test(t.fn.name)).length, 0);
});

test("rows that act as buttons are announced as buttons and reachable by keyboard", async () => {
  const p = await boot({ summary: summaryAs("post") });
  p.run("toggleMatch(S.data.men.results[0].id)"); await p.settle();
  for (const id of ["pool", "oppo", "fixtures", "results"]) {
    const rows = p.html(id).match(/<(div|span|li)[^>]*onclick=[^>]*>/g) || [];
    assert.ok(rows.length > 0, `#${id} should have tappable rows`);
    for (const r of rows) assert.ok(/role="button"/.test(r) && /tabindex="0"/.test(r), `in #${id}: ${r.slice(0, 90)}`);
  }
  assert.match(p.html("results"), /aria-expanded="true"/, "an opened result says it is expanded");
});

test("the footer says which version this is", async () => {
  const { VERSION } = require("../js/core.js");
  const p = await boot();
  assert.equal(p.el("ver").textContent, "Cap Day v" + VERSION);
});

/* ── Challenge a friend ── */
const MATCH = "401929710";                                   // Haiti v USA in the recorded data
const LOCKED = us => ({ "wc2026.usa.v1.calls": JSON.stringify({ [MATCH]: { us, them: 0, locked: true } }) });
const qrText = svg => { assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/); return svg; };

test("challenge: lock a call, give a first name once, and get a QR code and a link that carry it", async () => {
  const p = await boot({ storage: LOCKED(2), share: true });
  p.run(`openDuel('${MATCH}')`);
  assert.equal(p.el("duel").open, true);
  assert.equal(p.el("duelName").hidden, false, "first it asks for a name");
  assert.equal(p.el("duelBody").hidden, true);

  p.el("duelInput").value = "   "; p.run("saveName()");
  assert.equal(p.el("duelBody").hidden, true, "an empty name is not accepted");

  p.el("duelInput").value = "  Jerred <b>  "; p.run("saveName()");
  assert.equal(p.store["wc2026.usa.v1.name"], "Jerred b", "the name is cleaned and remembered on the device");
  assert.equal(p.el("duelName").hidden, true); assert.equal(p.el("duelBody").hidden, false);
  assert.equal(p.el("duelText").textContent, "Jerred b says Haiti 0–2 USA");
  qrText(p.el("duelQr").innerHTML);

  p.run("sendChallenge()"); await p.settle();
  assert.equal(p.shared.length, 1);
  assert.equal(p.shared[0].url, "http://test.local/wc2026/#men&c=401929710~Jerred%20b:2-0");
  assert.equal(p.shared[0].text, "Jerred b says Haiti 0–2 USA. What's your call?");
  assert.deepEqual(p.tracked.filter(x => /challenge/.test(x)), ["capday: challenge-started", "capday: challenge-sent"]);
  assert.ok(!p.fetched.some(u => /Jerred/.test(u)), "the name never appears in a request");

  /* The code drawn is the code for that link. */
  const { qrSvg } = require("../js/qr.js");
  assert.equal(p.el("duelQr").innerHTML, qrSvg(p.shared[0].url, { label: "QR code for your challenge" }));

  /* Second time: no question, and the name can be changed. */
  const q = await boot({ storage: { ...LOCKED(1), "wc2026.usa.v1.name": "Jerred" }, share: true });
  q.run(`openDuel('${MATCH}')`);
  assert.equal(q.el("duelBody").hidden, false); assert.equal(q.el("duelText").textContent, "Jerred says Haiti 0–1 USA");
  q.run("editName()");
  assert.equal(q.el("duelName").hidden, false); assert.equal(q.el("duelInput").value, "Jerred");
  q.el("duelInput").value = "Jay"; q.run("saveName(); sendChallenge()"); await q.settle();
  assert.match(q.shared[0].url, /~Jay:1-0$/);
});

test("challenge: opening a friend's link shows their call above the picker, and the address is tidied", async () => {
  const p = await boot({ hash: "#men&c=401929710~Jerred:2-0" });
  assert.equal(p.location.hash, "#men", "the call is taken out of the address, so a reload or a plain share does not carry it");
  assert.match(p.text("hero"), /Jerred says Haiti 0–2 USA\. What's your call\? Call the score Haiti − 0 \+ USA − 2 \+ Lock in my call/);
  assert.deepEqual(JSON.parse(p.store["wc2026.usa.v1.rivals"]), { [MATCH]: [{ n: "Jerred", us: 2, them: 0 }] });
  assert.deepEqual(p.tracked.filter(x => /challenge/.test(x)), ["capday: challenge-opened"]);
  assert.ok(p.el("callBox").scrolled >= 1, "the page moves to the challenge");
  assert.ok(!p.fetched.some(u => /Jerred/.test(u)), "the friend's name never appears in a request");

  p.run(`bump('${MATCH}','us',-1); lockCall('${MATCH}',true)`);
  assert.match(p.text("hero"), /Your call Haiti 0–1 USA The challenge You Haiti 0–1 USA Jerred Haiti 0–2 USA 🆚 Challenge a friend Change/);

  /* Passing it on carries both calls. */
  const q = await boot({ hash: "#men&c=401929710~Jerred:2-0", storage: { ...LOCKED(1), "wc2026.usa.v1.name": "Sam" }, share: true });
  q.run(`openDuel('${MATCH}'); sendChallenge()`); await q.settle();
  assert.equal(q.shared[0].url, "http://test.local/wc2026/#men&c=401929710~Sam:1-0~Jerred:2-0");
});

test("challenge: calls are ranked while the match is on and at full time", async () => {
  /* The recorded match ends 1–0 to the USA. You said 1–0, Jerred 2–0, Pat a 1–1 draw. */
  const p = await boot({ hash: "#men&c=401929710~Jerred:2-0~Pat:1-1", storage: LOCKED(1), summary: summaryAs("in", "67'") });
  assert.match(p.text("hero"), /The challenge 1 You Haiti 0–1 USA 🎯 2 Jerred Haiti 0–2 USA ✓ 3 Pat Haiti 1–1 USA Closest right now: You\./);
  p.setSummary(summaryAs("post")); await p.refresh();
  assert.match(p.text("hero"), /🏆 You called it best — that's you\./);

  const lost = await boot({ hash: "#men&c=401929710~Jerred:1-0", storage: LOCKED(3), summary: summaryAs("post") });
  assert.match(lost.text("hero"), /1 Jerred Haiti 0–1 USA 🎯 2 You Haiti 0–3 USA ✓ 🏆 Jerred called it best\./);

  const level = await boot({ hash: "#men&c=401929710~Jerred:2-0", storage: LOCKED(2), summary: summaryAs("post") });
  assert.match(level.text("hero"), /1 You Haiti 0–2 USA ✓ 1 Jerred Haiti 0–2 USA ✓ All level: nobody called it better\./);

  const watching = await boot({ hash: "#men&c=401929710~Jerred:2-0~Pat:1-0", summary: summaryAs("post") });
  assert.match(watching.text("hero"), /The challenge 1 Pat Haiti 0–1 USA 🎯 2 Jerred Haiti 0–2 USA ✓ 🏆 Pat called it best\./, "friends' calls are still ranked if you never made one");
  assert.ok(!/Your call/.test(watching.text("hero")));
});

test("challenge: a hostile or broken link is harmless", async () => {
  const evil = "#men&c=401929710~" + encodeURIComponent('<img src=x onerror="alert(1)">') + ":2-0";
  const p = await boot({ hash: evil });
  assert.ok(!p.html("hero").includes("<img src=x"), "markup in a name is never drawn");
  assert.ok(!/alert\(|onerror="alert/.test(p.html("hero")), "nor any handler from it");
  assert.match(p.text("hero"), /img srcx onerror says Haiti 0–2 USA/, "what is left of the name is shown as plain text");
  assert.equal(p.location.hash, "#men");
  for (const id of SECTIONS) assert.ok(!p.text(id).includes(NOTICE), `#${id}`);

  for (const hash of ["#men&c=", "#men&c=garbage", "#men&c=401929710", "#men&c=401929710~:1-0", "#men&c=401929710~Sam:99-0", "#men&c=401929710~Sam:1-0:2", "#men&c=%E0%A4%A", "#men&c=" + "9".repeat(2000)]) {
    const q = await boot({ hash });
    assert.equal(q.location.hash, "#men", `${hash.slice(0, 30)}: the address is tidied`);
    assert.ok(!/says/.test(q.text("hero")), `${hash.slice(0, 30)}: nothing is shown`);
    assert.equal(q.store["wc2026.usa.v1.rivals"], undefined, `${hash.slice(0, 30)}: nothing is stored`);
    assert.deepEqual(q.tracked.filter(x => /error|challenge/.test(x)), []);
  }
});

test("challenge: your own link, another match's link, and a link arriving while the app is open", async () => {
  const own = await boot({ hash: "#men&c=401929710~Jerred:2-0", storage: { "wc2026.usa.v1.name": "jerred" } });
  assert.ok(!/says/.test(own.text("hero")), "you are not shown your own call as a rival");

  const other = await boot({ hash: "#men&c=123456~Jerred:2-0" });
  assert.ok(!/says/.test(other.text("hero")), "a call for a different match is not shown on this one");

  const women = await boot({ hash: "#women&c=401870040~Sam:3-0" });
  assert.match(women.text("hero"), /Sam says USA 3–0 El Salvador\. What's your call\?/, "the link opens the right team");

  /* Already open on the women's team; a men's challenge link is tapped. */
  const p = await boot({ hash: "#women" });
  assert.match(p.text("hero"), /El Salvador/);
  p.location.hash = "#men&c=401929710~Jerred:2-0~Sam:1-1";
  p.run("takeChallenge(); S.team = 'men'; render()");
  assert.match(p.text("hero"), /Jerred says Haiti 0–2 USA · Sam says Haiti 1–1 USA\. What's your call\?/);
  assert.equal(p.location.hash, "#men");
});

test("challenge: a long chain still fits a QR code, and at most eight friends are kept", async () => {
  const names = ["Bartholomew-Jean", "Zoë Müller-Lüden", "Çağla Öztürkoğlu", "Władysław Żółć", "Ñandú Peñalosa", "Þórður Æsgeirs", "Élodie Lefèvre", "Søren Kjærgård", "Ninth Person"];
  const hash = "#men&c=401929710" + names.map((n, i) => "~" + encodeURIComponent(n) + ":" + (i % 4) + "-" + (i % 3)).join("");
  const p = await boot({ hash, storage: { ...LOCKED(1), "wc2026.usa.v1.name": "Maximilian-Josef" }, share: true });
  assert.equal(JSON.parse(p.store["wc2026.usa.v1.rivals"])[MATCH].length, 8);
  p.run(`openDuel('${MATCH}'); sendChallenge()`); await p.settle();
  qrText(p.el("duelQr").innerHTML);
  const { parseChallenge } = require("../js/core.js"), { qrMatrix } = require("../js/qr.js");
  const url = p.shared[0].url, sent = parseChallenge(url.split("&c=")[1]);
  assert.ok(qrMatrix(url), "the link fits in a QR code");
  assert.equal(sent.calls[0].n, "Maximilian-Josef", "your own call always goes");
  assert.ok(sent.calls.length >= 2 && sent.calls.length <= 9, `it carries as many friends as fit (${sent.calls.length - 1})`);
});

/* ── A real match, replayed ──
   Curaçao 0–0 Panama, recorded from the live feed on Nov 12 2026 and played
   back here in test mode (Curaçao, at home, stands in for the USA). Unlike the
   finished match relabelled as live above, this is what the feed sent while
   the match was going on. */
const NIGHT = replay("replay-curacao-panama.json");
async function replayNight() {
  const home = NIGHT.frames[0].summary.header.competitions[0].competitors.find(x => x.homeAway === "home").id;
  let cur = NIGHT.frames[0];
  const p = await boot({ search: `?test=${NIGHT.league}:${NIGHT.event}`, summary: () => cur.summary, now: cur.at });
  const polls = () => p.timers.filter(t => /refreshLive/.test(t.fn.name));
  return {
    p, polls,
    /* Jump to the first moment the feed's answer matches, with the clock at the time it was recorded. */
    async to(match, what) {
      const f = NIGHT.frames.find(x => match(core.parseSummary(x.summary, home)));
      assert.ok(f, "the recording has a moment where " + what);
      cur = f; p.setNow(f.at); await p.refresh();
      return p.text("hero");
    },
    async at(iso) { p.setNow(iso); await p.refresh(); return p.text("hero"); },
  };
}

test("replay: the hours before kickoff, lineups arriving, and the wait for the feed to say it has started", async () => {
  const r = await replayNight();
  let t = r.p.text("hero");
  assert.match(t, /TEST MODE/);
  assert.match(t, /Next match · Concacaf Nations League · Quarterfinals · 1st Leg Curaçao vs Panama/);
  assert.match(t, /07 hrs 48 min/);
  assert.match(t, /Stadion Ergilio Hato · Willemstad/);
  assert.match(t, /Lineups appear here about an hour before kickoff/);
  assert.match(t, /Series PAN leads series 2-0-1/);
  assert.equal(r.polls().pop().ms, 6 * 36e5, "hours out, it looks again in six hours at most");

  t = await r.to(L => L.state === "pre" && L.xi.length === 2, "the lineups are in");
  assert.match(t, /00 hrs 47 min/);
  assert.match(t, /Lineups Curaçao 4-2-3-1 1 Eloy Room/);
  assert.match(t, /Panama 5-4-1/);
  assert.ok(!/Lineups appear here/.test(t));
  assert.equal(r.polls().pop().ms, 60e3, "inside the last hour it looks every minute");

  /* Kickoff was listed for 00:30Z; the feed first said "live" at 00:32:48Z. */
  assert.ok(Date.parse(NIGHT.wentLive) - Date.parse(NIGHT.scheduled) > 2 * 60e3, "the recording has a gap between the listed kickoff and the feed going live");
  t = await r.at("2026-11-13T00:31:30Z");
  assert.match(t, /Curaçao vs Panama/);
  assert.match(t, /Kicking off…/);
  assert.ok(!/LIVE|Full time|-\d+ (hrs|min|sec)/.test(t), "no score, no badge and no negative countdown while waiting");
  assert.equal(r.polls().pop().ms, 60e3);
});

test("replay: kickoff, cards as they come, half time, and a card the feed takes back", async () => {
  const r = await replayNight();
  let t = await r.to(L => L.state === "in", "the match has started");
  assert.match(t, /Live now · Concacaf Nations League · Quarterfinals · 1st Leg Curaçao 0 : 0 LIVE 1' Panama/);
  assert.match(r.p.html("hero"), /class="card hero live/);
  assert.ok(!/Possession|Shots/.test(t), "the feed's numbers are all zero in the first minute: no table of zeros");
  assert.ok(!/Call the score|hrs|Kicking off/.test(t), "pre-match items are gone");
  assert.equal(r.polls().pop().ms, 30e3);

  t = await r.to(L => L.state === "in" && L.stats && parseFloat(L.stats.us.possessionPct) > 0, "the numbers have started");
  assert.match(t, /36% Possession 64%/);

  t = await r.to(L => L.events.length === 1, "the first card is shown");
  assert.match(t, /LIVE 21' Panama .* 19' 🟨 Tahith Chong/);

  t = await r.to(L => L.clock === "Half time", "it is half time");
  assert.match(t, /Curaçao 0 : 0 LIVE Half time Panama/);
  assert.ok(!t.includes("45'"), "not the minute the half ended on, which the feed's clock sticks at");
  assert.equal(r.polls().pop().ms, 30e3, "still looking every 30 seconds through the break");

  t = await r.to(L => L.clock === "46'", "the second half is under way");
  assert.match(t, /LIVE 46' Panama/);

  t = await r.to(L => L.events.length === 4, "four cards are listed");
  assert.match(t, /19' 🟨 Tahith Chong 22' 🟨 Édgar Yoel Bárcenas 58' 🟨 Jorge Gutiérrez 83' 🟨 Livano Comenencia/);

  /* Around the 90th minute the feed withdrew the 19th-minute card, then booked the same player. */
  t = await r.to(L => L.clock === "90'+1'", "the feed has taken a card back");
  assert.ok(!t.includes("19' 🟨"), "a card the feed withdraws leaves the list");
  assert.match(t, /22' 🟨 Édgar Yoel Bárcenas 58' 🟨 Jorge Gutiérrez 83' 🟨 Livano Comenencia 89' 🟨 Victor Griffith/);
  t = await r.to(L => L.clock === "90'+2'", "he is booked again");
  assert.match(t, /90' 🟨 Tahith Chong/);
});

test("replay: the last minutes, full time, and nothing flashing in a match without a goal", async () => {
  const r = await replayNight();
  const home = "11678";
  let flashed = 0;
  for (const f of NIGHT.frames) {
    const L = core.parseSummary(f.summary, home);
    const t = await r.to(x => JSON.stringify(x) === JSON.stringify(L), "this frame is found");
    if (/class="card hero live flash/.test(r.p.html("hero"))) flashed++;
    assert.ok(!/undefined|NaN|null/.test(t), `nothing unfilled on the card at ${f.at}`);
    for (const id of SECTIONS) assert.ok(!r.p.html(id).includes(NOTICE), `${id} drew without an error at ${f.at}`);
  }
  assert.equal(flashed, 0, "the card flashes for goals only");

  const r2 = await replayNight();
  /* The feed's last answer before full time had no running clock at all. */
  let t = await r2.to(L => L.clock === "90'+5'", "stoppage time is nearly up");
  assert.match(t, /Curaçao 0 : 0 LIVE 90'\+5' Panama/);
  const before = r2.polls().length;
  t = await r2.to(L => L.state === "post", "the match is over");
  assert.match(t, /Full time · Concacaf Nations League · Quarterfinals · 1st Leg Curaçao 0 : 0 Full time Panama/);
  assert.ok(!/LIVE|Watch on/.test(t));
  assert.match(t, /39% Possession 61% 6 Shots 17/);
  assert.equal(r2.polls().length, before, "it stops asking once the match is over");
});
