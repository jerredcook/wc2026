/* What each section actually puts on screen, in every state the app can be in.
   The page's own code runs against recorded data with a fixed clock
   (see helpers/page.cjs). Run: node --test */
process.env.TZ = "America/New_York";   // kickoff times in the assertions are Eastern
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, fixture, clone, summaryAs } = require("./helpers/page.cjs");

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
  before(t, "What is this match?", "Win expectancy");
  assert.ok(!/Call the score|Lock in my call/.test(t), "the score call is not in the match card");
  assert.match(p.text("call"), /^Call the score Just for fun/, "it has its own card");
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
  assert.equal(p.html("call"), "", "with no call locked in, the score-call card disappears at kickoff");
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
  assert.equal(p.html("call"), "");
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
  assert.match(p.text("call"), /Call the score Just for fun.* Haiti − 0 \+ USA − 2 \+ Lock in my call/);
  const heroBefore = p.html("hero");
  p.run(`bump('${id}','us',-1)`);                    // 1–0 to the USA
  p.run(`lockCall('${id}',true)`);
  assert.match(p.text("call"), /^Your call Haiti 0–1 USA/);
  assert.match(p.text("call"), /Share my call Change/);
  assert.equal(p.html("hero"), heroBefore, "making a call leaves the match card alone");
  assert.deepEqual(JSON.parse(p.store["wc2026.usa.v1.calls"])[id], { us: 1, them: 0, locked: true }, "the call is saved on the device");
  assert.ok(p.tracked.includes("capday: call-locked"));
  p.setSummary(summaryAs("in", "67'")); await p.refresh();
  assert.match(p.text("call"), /Your call Haiti 0–1 USA 🎯 On the money right now\./);
  assert.ok(!/Change/.test(p.text("call")), "a call cannot be changed once the match has started");
  p.setSummary(summaryAs("post")); await p.refresh();
  assert.match(p.text("call"), /🎯 Spot on — exact score!/);
});

test("a saved call survives a reload", async () => {
  const p = await boot({ storage: { "wc2026.usa.v1.calls": JSON.stringify({ "401929710": { us: 3, them: 1, locked: true } }) } });
  assert.match(p.text("call"), /Your call Haiti 1–3 USA/);
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
