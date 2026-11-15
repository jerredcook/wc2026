// The American Outlaws concept page (ao.html, js/ao.js, data/ao/chapters.json).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("ao: the chapter snapshot is well formed", () => {
  const d = JSON.parse(read("data/ao/chapters.json"));
  assert.match(d.captured, /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
  assert.ok(d.chapters.length > 150, "the whole chapter list is there");
  const slugs = new Set();
  for (const c of d.chapters) {
    assert.ok(c.slug && c.name && c.state, "every chapter has a slug, name and state");
    assert.ok(!slugs.has(c.slug), "duplicate chapter " + c.slug); slugs.add(c.slug);
    if (c.lat != null) assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, c.slug + " has sane coordinates");
    for (const p of c.parties || []) {
      assert.match(p.date, /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/, c.slug + " watch party dates match the fixture feed's format");
      assert.ok(p.title, c.slug + " watch party has a title");
    }
  }
  assert.ok(d.chapters.some(c => c.slug === "middlesex-county"), "the default chapter is in the list");   // it may have no watch party posted: the file is refreshed from AO's site every day, quiet months included
});

test("ao: the page loads its script after the hub", () => {
  const html = read("ao.html");
  assert.ok(html.indexOf('src="js/ao.js"') > html.indexOf("function render()"), "js/ao.js loads after the main script");
  assert.match(html, /id="aoWatch"/); assert.match(html, /id="aoChapters"/);
  for (const m of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|png|svg|webmanifest|json))"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), "missing file: " + m[1]);
});

test("ao: the concept page is up to date with the front page it is generated from", () => {
  const r = require("node:child_process").spawnSync(process.execPath, [path.join(root, "scripts/build-ao.mjs"), "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr || "build-ao --check failed");
});

/* ── Reading the chapters from AO's site (scripts/build-ao-chapters.mjs) ── */
const reader = () => import("../scripts/build-ao-chapters.mjs");
/* A chapter page with the parts the reader looks for, laid out the way the site lays them out. */
const PAGE = ({ name = "Central New Jersey", state = "New Jersey", num = 174, rebuilding = false, kind = "Official", bars = [{ lng: -74.360926, lat: 40.54141, official: true, name: "Hailey's Harp & Pub", address: "400 Main St, Metuchen, NJ, 08840" }], events = [], follow = `<a href="https://www.instagram.com/americanoutlawscnj/">Instagram</a>`, logo = "https://theamericanoutlaws.com/rails/active_storage/blobs/redirect/abc/Logo.png" } = {}) => `
<nav><a href="/chapters">← All chapters</a></nav><div><div></div><div class="x">${state}</div><h1 class="y"> ${name.replace(/&/g, "&amp;")} </h1>
<div>${num ? `<span>Chapter #${num}</span>` : ""}${rebuilding ? `<span><i></i> Rebuilding </span>` : ""}</div><div><img class="w" src="${logo}" /></div>
<div>About</div><h2>Upcoming Watch Parties</h2><div>
${events.map(e => `<div><a class="t" href="/events/${e.id}">${e.title}</a><div><local-time datetime="${e.at}" weekday="short"> text </local-time></div>
  ${e.places.length ? `<div data-event-locations>` + e.places.map(a => `<div><div>Some name</div><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(a)}">Google Maps</a><a href="http://maps.apple.com/?q=${encodeURIComponent(a)}">Apple Maps</a></div>`).join("") + `</div>` : `<div>Watch location to be announced — follow the chapter for updates.</div>`}</div>`).join("")}
</div><h2>Where We Watch</h2><script>const FEATURES = ${JSON.stringify(bars).replace(/&/g, "\\u0026")}; const geojson = {};</script>
<div>Follow along</div><div>${follow}</div><div>Chapter status</div><div><i></i> ${kind} chapter</div>
<footer><a href="https://www.instagram.com/americanoutlaws/">Instagram</a></footer>`;

test("ao reader: a chapter page gives its name, number, status, bar, crest, Instagram and watch parties", async () => {
  const { parseChapter } = await reader();
  const c = parseChapter(PAGE({ events: [{ id: "488-usmnt-vs-haiti", title: "USMNT vs Haiti", at: "2026-11-18T00:00:00Z", places: ["400 Main St, Metuchen, NJ, 08840"] }] }), "middlesex-county");
  assert.deepStrictEqual(c, {
    slug: "middlesex-county", name: "Central New Jersey", state: "New Jersey", num: 174, status: "Official",
    bar: { name: "Hailey's Harp & Pub", address: "400 Main St, Metuchen, NJ, 08840" }, detail: true, lat: 40.54141, lng: -74.36093,
    ig: "https://www.instagram.com/americanoutlawscnj/", logo: "https://theamericanoutlaws.com/rails/active_storage/blobs/redirect/abc/Logo.png",
    parties: [{ date: "2026-11-18T00:00Z", title: "USMNT vs Haiti", venue: "Hailey's Harp & Pub", address: "400 Main St, Metuchen, NJ, 08840", official: true, lat: 40.54141, lng: -74.36093 }],
  });
});

test("ao reader: a match with no place named is left out; different bars for different matches are kept apart", async () => {
  const { parseChapter } = await reader();
  const bars = [{ lng: -73.99, lat: 40.74, official: true, name: "Long Acre", address: "146 W 47th St, New York" }, { lng: -73.98, lat: 40.72, official: false, name: "Wilka's", address: "241 Bowery, New York" }];
  const c = parseChapter(PAGE({ name: "NYC", state: "New York", num: 16, bars, events: [
    { id: "1-a", title: "USMNT vs Haiti", at: "2026-11-18T00:00:00Z", places: ["146 W 47th St, New York"] },
    { id: "2-b", title: "USWNT vs El Salvador", at: "2026-11-28T01:30:00Z", places: ["241 Bowery, New York"] },
    { id: "3-c", title: "USMNT vs Jamaica", at: "2026-12-13T20:30:00Z", places: [] },
    { id: "4-d", title: "Both bars", at: "2026-12-20T20:30:00Z", places: ["146 W 47th St, New York", "241 Bowery, New York", "146 W 47th St, New York"] },
    { id: "5-e", title: "A place that is not one of the chapter's bars", at: "2026-12-21T20:30:00Z", places: ["1 Unknown Rd"] },
  ] }), "nyc");
  assert.deepStrictEqual(c.parties.map(p => [p.date, p.venue, p.official]), [
    ["2026-11-18T00:00Z", "Long Acre", true], ["2026-11-28T01:30Z", "Wilka's", false], ["2026-12-20T20:30Z", "Long Acre", true], ["2026-12-20T20:30Z", "Wilka's", false]]);
  assert.deepStrictEqual(c.bar, { name: "Long Acre", address: "146 W 47th St, New York" }, "the first bar is the chapter's own");
});

test("ao reader: a chapter with no bar, a rebuilding chapter, and links that are not what they claim", async () => {
  const { parseChapter } = await reader();
  const bare = parseChapter(PAGE({ name: "Dothan", state: "Alabama", num: 0, kind: "Unofficial", bars: [], follow: "", logo: "/images/placeholder.png", events: [{ id: "1-a", title: "USMNT vs Haiti", at: "2026-11-18T00:00:00Z", places: [] }] }), "dothan");
  assert.deepStrictEqual(bare, { slug: "dothan", name: "Dothan", state: "Alabama", status: "Unofficial" }, "nothing is invented, and the site-wide Instagram in the footer is not the chapter's");
  assert.equal(parseChapter(PAGE({ rebuilding: true }), "x").status, "Rebuilding");
  const odd = parseChapter(PAGE({ name: "Tom & Jerry's", follow: `<a href="javascript:alert(1)">Instagram</a><a href="http://instagram.com/plain">Instagram</a><a href="https://instagram.com.evil.example/x">Instagram</a>`, logo: "https://evil.example/x.png" }), "x");
  assert.equal(odd.name, "Tom & Jerry's");
  assert.ok(!("ig" in odd) && !("logo" in odd), "only https links to Instagram and to AO's own site are kept");
  assert.equal(parseChapter("<html><body>Not found</body></html>", "x"), null);
});

test("ao reader: the chapter list, and putting fresh pages together with the old file", async () => {
  const { parseList, merge, problems } = await reader();
  assert.deepStrictEqual(parseList(`<a href="/chapters/nyc">x</a><a href="/chapters">all</a><a href="/chapters/auburn">y</a><a href="/chapters/nyc">again</a><a href="/chapters/nyc/signup">join</a>`), ["auburn", "nyc"]);
  const old = { captured: "2026-11-14T00:30Z", chapters: [{ slug: "auburn", name: "Auburn", state: "Alabama", lat: 32.58, lng: -85.49 }, { slug: "nyc", name: "NYC", state: "New York", lat: 40.7, lng: -74, bar: { name: "Old bar", address: "1 Old St" } }] };
  const fresh = { auburn: { slug: "auburn", name: "Auburn", state: "Alabama" }, nyc: null };
  const r = merge(["auburn", "nyc"], fresh, old, "2026-11-15T20:00Z");
  assert.deepStrictEqual(r.failed, ["nyc"]);
  assert.deepStrictEqual(r.data.chapters, old.chapters, "a page that could not be read keeps its old entry; a chapter with no bar keeps its rough position");
  assert.equal(r.data.captured, "2026-11-14T00:30Z", "nothing changed, so the time it was captured does not move");
  assert.equal(r.same, true);
  const r2 = merge(["auburn", "nyc"], { ...fresh, nyc: { slug: "nyc", name: "NYC", state: "New York", lat: 40.74, lng: -73.99, bar: { name: "Long Acre", address: "146 W 47th St" } } }, old, "2026-11-15T20:00Z");
  assert.equal(r2.data.captured, "2026-11-15T20:00Z");
  assert.equal(r2.data.chapters[1].bar.name, "Long Acre");

  /* A page in the list that is not a chapter is not a failure, unless a chapter used to be there. A chapter abroad has no state on its page. */
  const r3 = merge(["auburn", "nyc", "start"], { auburn: fresh.auburn, nyc: false, start: false, }, old, "n");
  assert.deepStrictEqual(r3.failed, ["nyc"]);
  assert.deepStrictEqual(r3.data.chapters.map(c => c.slug), ["auburn", "nyc"]);
  const abroad = merge(["london", "auburn"], { london: { slug: "london", name: "London", state: "" }, auburn: fresh.auburn }, old, "n").data.chapters;
  assert.deepStrictEqual(abroad.map(c => [c.slug, c.state]), [["auburn", "Alabama"], ["london", "International"]], "listed last, under International");

  /* A thin answer from the site must not replace a good file. */
  const big = { chapters: Array.from({ length: 280 }, (_, i) => ({ slug: "c" + i, name: "C" + i, state: "S", parties: i < 150 ? [{ date: "2026-11-18T00:00Z", title: "t", venue: "v" }] : undefined })) };
  const slugs = big.chapters.map(c => c.slug), ok = Object.fromEntries(big.chapters.map(c => [c.slug, { ...c }]));
  assert.deepStrictEqual(problems(merge(slugs, ok, big, "n"), slugs, big), []);
  assert.match(problems(merge(slugs.slice(0, 100), ok, big, "n"), slugs.slice(0, 100), big).join(), /chapter list has 100 chapters/);
  const half = Object.fromEntries(slugs.map((s, i) => [s, i % 5 === 0 ? null : ok[s]]));
  assert.match(problems(merge(slugs, half, big, "n"), slugs, big).join(), /56 of 280 chapter pages could not be read/);
  const none = Object.fromEntries(big.chapters.map(c => [c.slug, { slug: c.slug, name: c.name, state: "S" }]));
  assert.match(problems(merge(slugs, none, big, "n"), slugs, big).join(), /only 0 chapters list a watch party/);
});

/* ── The AO cards on the page (js/ao.js), run on top of the hub in the sandbox ── */
const { boot } = require("./helpers/page.cjs");
const AO_JS = read("js/ao.js");
const LIST = { captured: "2026-11-15T20:00Z", chapters: [
  { slug: "middlesex-county", name: "Central New Jersey", state: "New Jersey", lat: 40.54, lng: -74.36, parties: [{ date: "2026-11-14T21:30Z", title: "t", venue: "Hailey's Harp & Pub", address: "400 Main St, Metuchen, NJ", official: true }] },
  { slug: "seattle", name: "Seattle", state: "Washington", lat: 47.6, lng: -122.33, parties: [{ date: "2026-11-14T21:30Z", title: "t", venue: "The Atlantic Crossing", address: "6508 Roosevelt Way NE, Seattle, WA", official: true }] },
  { slug: "nyc", name: "NYC", state: "New York", lat: 40.74, lng: -73.99, parties: [{ date: "2026-11-14T22:00Z", title: "t", venue: "Long Acre", address: "146 W 47th St, New York, NY", official: true }, { date: "2026-11-28T01:30Z", title: "t", venue: "Wilka's", address: "241 Bowery" }] },
  { slug: "austin", name: "Austin", state: "Texas", lat: 30.27, lng: -97.74, parties: [{ date: "2026-11-15T03:00Z", title: "another night", venue: "Too Late Bar", address: "x" }, { date: "2026-11-14T21:30Z", title: "t", venue: "", address: "" }] },
  { slug: "dothan", name: "Dothan", state: "Alabama", lat: 31.2, lng: -85.4 },
  ...Array.from({ length: 8 }, (_, i) => ({ slug: "far" + i, name: "Far " + i, state: "Hawaii", lat: 21 + i / 10, lng: -157, parties: [{ date: "2026-11-14T21:30Z", title: "t", venue: "Bar " + i, address: i + " Beach Rd, Honolulu, HI" }] })),
] };
async function aoPage() {
  const p = await boot({ hash: "#men" });
  p.run(AO_JS); await p.settle();
  p.run("AO.data = " + JSON.stringify(LIST) + "; renderAO()");
  return p;
}

test("ao page: the watch party card lists every chapter's party for the match, nearest first", async () => {
  const p = await aoPage(), t = p.text("aoWatch");
  assert.match(t, /Your chapter · official watch party AO Central New Jersey Hailey's Harp & Pub 400 Main St, Metuchen, NJ/);
  assert.match(t, /10 more watch parties across the country/, "Seattle, NYC and eight in Hawaii; not the chapter with no place named, nor another night's party");
  const rows = p.html("aoWatch").split('<div class="aor">').slice(1).map(r => r.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  assert.equal(rows.length, 5, "the nearest five until asked for more");
  assert.match(rows[0], /^AO NYC Long Acre 146 W 47th St, New York, NY \d+ mi Map$/, "a kickoff time half an hour apart on the two sites is still the same match");
  assert.match(rows[1], /^AO Seattle The Atlantic Crossing .* 2\d{3} mi Map$/);
  assert.ok(!/Too Late Bar|Wilka/.test(t));
  assert.ok(!/<img/.test(p.html("aoWatch").split("<details")[1]), "no crest images in the long list");
  p.run("AO.all = true; renderWatch()");
  assert.equal(p.html("aoWatch").split('<div class="aor">').length - 1, 10);
  assert.match(p.text("aoWatch"), /Show the nearest five/);
});

test("ao page: searching the watch parties by city, state or bar", async () => {
  const p = await aoPage();
  const find = q => p.run(`AO.wq = ${JSON.stringify(q)}; aoWatchList(aoParties(aoMatch()).filter(x => x.c.slug !== AO.home))`).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.match(find("hawaii"), /^8 matches AO Far 7 Bar 7 /);
  assert.match(find("ATLANTIC"), /^1 match AO Seattle The Atlantic Crossing/);
  assert.match(find("honolulu"), /^8 matches/);
  assert.match(find("<b>nowhere"), /^0 matches No watch party matches “&lt;b&gt;nowhere”\.$/);
  assert.match(p.html("aoWatch"), /<input class="aoq" id="aoWQ" type="search"/);
});

test("ao page: a chapter that has posted nothing says so, and the rest are still listed", async () => {
  const p = await boot({ hash: "#men" });
  p.run(AO_JS); await p.settle();
  p.run("AO.home = 'dothan'; AO.data = " + JSON.stringify(LIST) + "; renderAO()");
  const t = p.text("aoWatch");
  assert.match(t, /AO Dothan hasn't posted a watch party for this match yet\./);
  assert.match(t, /11 more watch parties across the country/);
  assert.match(p.html("aoChapters"), /<div class="card sec">/, "the chapter finder is a folding section");
  assert.match(p.text("aoChapters"), /Find your crew AO Dothan · 13 American Outlaws chapters/);
});

test("ao: what the privacy page says about location matches what the page does", () => {
  const js = read("js/ao.js"), privacy = read("privacy.html");
  assert.match(js, /navigator\.geolocation/, "the AO page can ask for the visitor's position");
  assert.match(js, /onclick="aoLocate\(\)"/, "and only from a button the visitor taps");
  assert.equal((js.match(/getCurrentPosition/g) || []).length, 1, "there is one place that asks");
  assert.match(privacy, /only if you ask[\s\S]*Sort by my location[\s\S]*not sent anywhere/, "the privacy page says so");
  assert.ok(!/No access to your location, contacts/.test(privacy), "and no longer says the app never uses location");
  assert.match(privacy, /theamericanoutlaws\.com/, "the crests' source is named");
});

test("ao: the page is the chapter's app in every place it names itself", () => {
  const html = read("ao.html"), man = JSON.parse(read("ao.webmanifest"));
  assert.match(html, /<title>AO Matchday — American Outlaws Central New Jersey<\/title>/);
  assert.equal(man.name, "AO Matchday");
  for (const [what, text] of [["the page", html.replace(/ao-concept/g, "")], ["the install details", JSON.stringify(man)], ["the sign", read("ao-sign.html")]]) assert.ok(!/concept/i.test(text), what + " still says concept");
  assert.equal((html.match(/not a product of American Outlaws national/gi) || []).length, 2, "the band and the footer both say whose app it is not");
});

test("ao: the sign for the bar points at the AO page and can be printed", () => {
  const sign = read("ao-sign.html");
  assert.match(sign, /<img class="qr" src="ao-qr\.svg" alt="[^"]+"/);
  assert.match(sign, /jerredcook\.github\.io\/wc2026\/ao\.html/);
  assert.match(sign, /@media print/); assert.match(sign, /window\.print\(\)/);
  assert.match(sign, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(read("ao.html"), /<a href="ao-sign\.html">Print a sign for the bar<\/a>/, "the QR dialog on the AO page links to it");
  assert.ok(!/<script/.test(sign), "it is a plain page");
});

test("ao: every chapter has a calendar feed, and it carries the bar", async () => {
  const { chapterCal, writeCals } = await reader();
  const d = JSON.parse(read("data/ao/chapters.json"));
  for (const c of d.chapters) assert.equal(read("data/ao/cal/" + c.slug + ".ics"), chapterCal(c), c.slug + ": the calendar on disk is the one the listings give");
  const cal = chapterCal({ slug: "x-y", name: "Tom, Dick & Harry", parties: [
    { date: "2026-11-28T01:30Z", title: "USWNT vs El Salvador", venue: "Wilka's; Bar", address: "241 Bowery, New York", official: false },
    { date: "2026-11-18T00:00Z", title: "USMNT vs Haiti", venue: "Long Acre", address: "146 W 47th St, New York, NY 10036, a very long address that has to be folded onto a second line", official: true }] });
  const lines = cal.split("\r\n");
  assert.ok(lines.every(l => l.length <= 75), "no line is longer than calendars allow");
  const flat = cal.replace(/\r\n /g, "");
  assert.match(flat, /X-WR-CALNAME:AO Tom\\, Dick & Harry watch parties/);
  assert.ok(flat.indexOf("USMNT vs Haiti") < flat.indexOf("USWNT vs El Salvador"), "in order of kickoff");
  assert.match(flat, /UID:ao-x-y-20261118T0000Z-1@capday\r\nDTSTAMP:20261118T000000Z\r\nDTSTART:20261118T000000Z\r\nDTEND:20261118T020000Z\r\nSUMMARY:USMNT vs Haiti · AO Tom\\, Dick & Harry watch party/);
  assert.match(flat, /LOCATION:Wilka's\\; Bar\\, 241 Bowery\\, New York/);
  assert.match(flat, /DESCRIPTION:Official American Outlaws watch party\.\\nhttps:\/\/theamericanoutlaws\.com\/chapters\/x-y/);
  assert.equal((chapterCal({ slug: "quiet", name: "Quiet" }).match(/BEGIN:VEVENT/g) || []).length, 0, "a chapter with nothing posted has an empty calendar, not a missing one");

  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "aocal-"));
  try {
    assert.equal(writeCals([{ slug: "a", name: "A" }, { slug: "../evil", name: "E" }], dir), 1, "an odd address on the site cannot write outside the folder");
    assert.deepStrictEqual(fs.readdirSync(dir), ["a.ics"]);
    assert.equal(writeCals([{ slug: "a", name: "A" }], dir), 0, "an unchanged calendar is not rewritten");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ao page: Add to calendar subscribes to the chosen chapter's feed, and the hub's own calendar keeps its words", async () => {
  const p = await boot({ hash: "#men" });
  p.el("subHead").textContent = "Never miss a match"; p.el("subText").textContent = "the hub's words";     // what the page's own markup says
  p.run(AO_JS); await p.settle();
  p.run("AO.data = " + JSON.stringify(LIST) + "; renderAO()");
  assert.match(p.html("aoWatch"), /<button class="btn" onclick="aoSub\(\)">📅 Add to calendar<\/button>/);
  p.run("aoSub()");
  assert.equal(p.el("sub").open, true);
  assert.equal(p.el("subApple").href, "webcal://test.local/wc2026/data/ao/cal/middlesex-county.ics");
  assert.equal(p.el("subGoogle").href, "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent("http://test.local/wc2026/data/ao/cal/middlesex-county.ics"));
  assert.equal(p.el("subHead").textContent, "AO Central New Jersey watch parties");
  assert.match(p.el("subText").textContent, /with the bar and its address/);
  assert.ok(p.tracked.some(x => /ao-concept: calendar-chapter/.test(x)));
  p.run("openSub()");
  assert.equal(p.el("subApple").href, "webcal://test.local/wc2026/data/usa/all.ics");
  assert.deepStrictEqual([p.el("subHead").textContent, p.el("subText").textContent], ["Never miss a match", "the hub's words"]);
});

test("ao: search engines may list the page, and can tell it from Cap Day", () => {
  const ao = read("ao.html"), hub = read("index.html"), base = "https://jerredcook.github.io/wc2026/";
  for (const [what, html] of [["the AO page", ao], ["Cap Day", hub]]) assert.ok(!/<meta name="robots"[^>]*noindex/i.test(html), what + " is not kept out of search");
  const canon = html => (html.match(/<link rel="canonical" href="([^"]+)">/g) || []).join();
  assert.equal(canon(ao), `<link rel="canonical" href="${base}ao.html">`, "the AO page names its own address, once");
  assert.equal(canon(hub), `<link rel="canonical" href="${base}">`, "and Cap Day names its own");
  assert.match(ao, /<meta name="description" content="American Outlaws Central New Jersey[^"]{40,140}">/, "the description spells the chapter out and fits a search result");
  assert.match(read("privacy.html"), /<a href="ao\.html">AO Matchday<\/a>/, "a listed page links to it, so it can be reached by following links");
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes(base) && locs.includes(base + "ao.html"), "the sitemap lists both");
  for (const u of locs) {
    assert.ok(u.startsWith(base), u + " is on this site");
    const f = u.slice(base.length) || "index.html";
    assert.ok(fs.existsSync(path.join(root, f)), "the sitemap names a missing page: " + f);
    assert.ok(!/<meta name="robots"[^>]*noindex/i.test(read(f)), "the sitemap names a page that is kept out of search: " + f);
  }
});
