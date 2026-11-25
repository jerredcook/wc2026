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

/* A PNG's pixels, read with nothing but Node (8-bit RGB, not interlaced: what the icon files are). */
function pixels(file) {
  const b = fs.readFileSync(path.join(root, file)), w = b.readUInt32BE(16), h = b.readUInt32BE(20), idat = [];
  assert.equal([b[24], b[25], b[28]].join("/"), "8/2/0", file + " should be plain 8-bit colour with no see-through parts (a phone paints those black)");
  for (let o = 8; o < b.length;) { const len = b.readUInt32BE(o); if (b.toString("latin1", o + 4, o + 8) === "IDAT") idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = require("node:zlib").inflateSync(Buffer.concat(idat)), row = w * 3, out = Buffer.alloc(h * row);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)], line = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1));
    for (let x = 0; x < row; x++) {
      const a = x >= 3 ? out[y * row + x - 3] : 0, up = y ? out[(y - 1) * row + x] : 0, c = x >= 3 && y ? out[(y - 1) * row + x - 3] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * row + x] = v & 255;
    }
  }
  return { w, h, at: (x, y) => [out[y * row + x * 3], out[y * row + x * 3 + 1], out[y * row + x * 3 + 2]] };
}

test("ao: the app's picture is the chapter's crest, on every page and in the install details", () => {
  const NAVY = [11, 42, 91], navy = p => p.every((v, i) => Math.abs(v - NAVY[i]) <= 3);
  const man = JSON.parse(read("ao.webmanifest")), cap = ["icon-192.png", "icon-512.png", "apple-touch-icon.png"];
  assert.deepEqual(man.icons.map(i => i.sizes + " " + i.purpose).sort(), ["192x192 any", "512x512 any", "512x512 maskable"], "a small icon, a large one, and one Android can cut to its own shape");
  for (const i of [...man.icons, { src: "ao-touch-icon.png", sizes: "180x180", purpose: "any" }]) {
    assert.ok(!cap.includes(i.src), i.src + " is Cap Day's picture");
    const px = pixels(i.src), mid = px.w / 2;
    assert.equal(px.w + "x" + px.h, i.sizes, i.src + " is not the size it is listed as");
    for (const [x, y] of [[0, 0], [px.w - 1, 0], [0, px.h - 1], [px.w - 1, px.h - 1]]) assert.ok(navy(px.at(x, y)), i.src + " should be navy to its corners: the phone rounds them off itself");
    let drawn = 0, outside = 0;
    for (let y = 0; y < px.h; y += 2) for (let x = 0; x < px.w; x += 2) if (!navy(px.at(x, y))) { drawn++; if (Math.hypot(x - mid, y - mid) > px.w * 0.4) outside++; }
    assert.ok(drawn > px.w * px.h / 4 * 0.2, i.src + " has no crest on it");
    // Android keeps only a circle 80% as wide as the picture: on the icon made for it, nothing of the crest may be outside.
    if (i.purpose === "maskable") assert.equal(outside, 0, "part of the crest would be cut off on Android");
    else assert.ok(outside > 0, i.src + " shows the crest as large as the square allows");
  }
  for (const f of ["ao.html", "worldcup.html", "privacy.html", "ao-sign.html"]) {
    const html = read(f);
    for (const c of cap) assert.ok(!html.includes('"' + c + '"'), f + " still uses Cap Day's " + c);
    assert.match(html, /<link rel="icon" href="ao-icon-192\.png">/, f + " has no icon for the browser tab");
  }
  for (const f of ["ao.html", "worldcup.html"]) assert.match(read(f), /<link rel="apple-touch-icon" href="ao-touch-icon\.png">/, f + " has no icon for an iPhone home screen");
  const shell = /const SHELL = (\[[^\]]*\])/.exec(read("sw.js"))[1];
  for (const f of ["ao-icon-192.png", "ao-touch-icon.png"]) assert.ok(shell.includes(`"./${f}"`), f + " is not kept for offline use");
  assert.ok(pixels("ao-og.png").at(220, 300).some((v, i) => Math.abs(v - NAVY[i]) > 40), "the share picture has nothing where the crest goes");
});

test("ao: the sign for the bar points at the AO page and can be printed", () => {
  const sign = read("ao-sign.html");
  assert.match(sign, /<img class="qr" id="qr" src="ao-qr\.svg" alt="[^"]+"/);
  assert.match(sign, /jerredcook\.github\.io\/wc2026\/ao\.html/);
  assert.match(sign, /@media print/); assert.match(sign, /window\.print\(\)/);
  assert.match(sign, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(read("ao.html"), /<a href="ao-sign\.html">Print a sign for the bar<\/a>/, "the QR dialog on the AO page links to it");
  assert.match(sign, /if \(!m \|\| m\[1\] === "middlesex-county"\) return;/, "without a chapter in the address its script does nothing: the plain sign stands");
  assert.match(sign, /\}\)\.catch\(show\);/, "and if the chapter list cannot be read, the plain sign is shown rather than a blank page");
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
  // Reminders: the day before and two hours before, inside each event; the USA calendars carry none.
  const events = flat.split("BEGIN:VEVENT").slice(1);
  assert.equal(events.length, 2);
  for (const e of events) {
    assert.deepStrictEqual([...e.matchAll(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:([^\r]+)\r\nTRIGGER:([^\r]+)\r\nEND:VALARM\r\n/g)].map(m => m[2]), ["-P1D", "-PT2H"]);
    assert.ok(e.lastIndexOf("END:VALARM") < e.indexOf("END:VEVENT"), "the reminders sit inside the event");
    assert.match(e, /DESCRIPTION:US[MW]NT vs [^\r]+ watch party\r\nTRIGGER/, "a reminder says which watch party");
  }
  assert.ok(!/VALARM/.test(read("data/usa/all.ics")), "the USA match calendars are unchanged");

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

test("ao: search engines may list the page, and are pointed at it from Cap Day's old address", () => {
  const ao = read("ao.html"), hub = read("index.html"), base = "https://jerredcook.github.io/wc2026/";
  for (const [what, html] of [["the AO page", ao], ["Cap Day", hub]]) assert.ok(!/<meta name="robots"[^>]*noindex/i.test(html), what + " is not kept out of search");
  const canon = html => (html.match(/<link rel="canonical" href="([^"]+)">/g) || []).join();
  assert.equal(canon(ao), `<link rel="canonical" href="${base}ao.html">`, "the AO page names its own address, once");
  assert.equal(canon(hub), `<link rel="canonical" href="${base}ao.html">`, "and the retired front page points at it too");
  assert.match(ao, /<meta name="description" content="American Outlaws Central New Jersey[^"]{40,140}">/, "the description spells the chapter out and fits a search result");
  assert.match(read("privacy.html"), /<a href="ao\.html">/, "the privacy page links to it");
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes(base + "ao.html") && !locs.includes(base), "the sitemap lists the AO page, and not the address that only sends people on");
  for (const u of locs) {
    assert.ok(u.startsWith(base), u + " is on this site");
    const f = u.slice(base.length) || "index.html";
    assert.ok(fs.existsSync(path.join(root, f)), "the sitemap names a missing page: " + f);
    assert.ok(!/<meta name="robots"[^>]*noindex/i.test(read(f)), "the sitemap names a page that is kept out of search: " + f);
  }
});

test("retired: nothing a visitor reaches still says Cap Day, and every way back leads to AO Matchday", () => {
  const ao = read("ao.html"), hub = read("index.html"), wc = read("worldcup.html");
  for (const f of ["ao.html", "worldcup.html", "privacy.html", "usa.html", "ao-sign.html", "ao.webmanifest", "sitemap.xml"]) assert.ok(!/Cap Day/.test(read(f)), f + " still says Cap Day");
  for (const f of ["women", "men", "all"]) assert.match(read("data/usa/" + f + ".ics"), /^X-WR-CALNAME:AO Matchday — USA /m, f + ".ics is named for the app people have");

  // The old address sends people on, before anything is drawn, and the AO page does not send them on again.
  const send = hub.match(/<script>\/\* Cap Day is retired for now[^\n]*<\/script>/);
  assert.ok(send && hub.indexOf(send[0]) < hub.indexOf("<style"), "the front page redirects from its head");
  assert.ok(!/location\.replace\("ao\.html"/.test(ao), "the AO page must not redirect to itself");
  const went = (search, hash, standalone) => {
    let to = null;
    new Function("location", "window", "matchMedia", send[0].replace(/^<script>|<\/script>$/g, ""))({ search, hash, replace: u => { to = u; } }, { matchMedia: true }, () => ({ matches: standalone }));
    return to;
  };
  assert.equal(went("", "", false), "ao.html");
  assert.equal(went("", "#men", false), "ao.html#men", "a link to one team still opens that team");
  assert.equal(went("?test=x:1", "#women", true), "ao.html?test=x:1#women");
  assert.equal(went("", "", true), "ao.html#app", "an installed Cap Day opens AO Matchday as an app, not as a web page inside one");
  assert.equal(went("?capday", "", false), null, "?capday still shows Cap Day, which the AO page is built from");
  assert.equal(went("?x=1&capday", "#men", true), null);
  assert.equal(went("?capdayz", "", false), "ao.html?capdayz");

  // The World Cup page: both ways back, its name, its install details and its share picture.
  assert.ok(!/href="\.\/"|href="index\.html/.test(wc), "the World Cup page no longer links to the old front page");
  assert.equal((wc.match(/href="ao\.html"/g) || []).length, 2, "the back link and the next-match banner both lead to AO Matchday");
  assert.match(wc, /&larr; AO Matchday<\/a>/); assert.match(wc, /<link rel="manifest" href="ao\.webmanifest">/);
  for (const [what, html] of [["the AO page", ao], ["the World Cup page", wc]]) {
    assert.ok(!/og-image\.png/.test(html), what + " still shares the Cap Day picture");
    assert.match(html, /<meta property="og:image" content="https:\/\/jerredcook\.github\.io\/wc2026\/ao-og\.png">/);
  }
  const png = fs.readFileSync(path.join(root, "ao-og.png"));
  assert.equal(png.readUInt32BE(16) + "x" + png.readUInt32BE(20), "1200x630", "the share picture is the size the tags say");
  assert.match(read("usa.html"), /location\.replace\("ao\.html" \+ location\.hash\)/, "the oldest address goes straight there");
  assert.match(read("sw.js"), /caches\.match\("\.\/ao\.html"\)/, "offline, the app falls back to the AO page");
});

/* ── A chapter's own link, its sign, and the band ── */
async function aoLinked(search, storage) {
  const p = await boot({ hash: "#men", search, storage, share: true });
  p.el("aoBandW").textContent = "AO Central New Jersey"; p.el("aoBandP").textContent = "The matchday app of AO Central New Jersey.";     // what the page's own markup says
  p.run(AO_JS); await p.settle();
  p.run("aoLoaded(" + JSON.stringify(LIST) + ")");
  return p;
}

test("ao page: a chapter's own link opens the app on that chapter and keeps it for a newcomer", async () => {
  const p = await aoLinked("?chapter=nyc");
  assert.match(p.text("aoWatch"), /Your chapter · official watch party AO NYC Long Acre/);
  assert.match(p.text("aoChapters"), /Find your crew AO NYC · 13 American Outlaws chapters/);
  assert.equal(p.store["ao.home"], "nyc", "someone who has never picked a chapter keeps the one on the sign they scanned");
  assert.ok(p.tracked.some(x => /ao-concept: chapter-link nyc/.test(x)));
  assert.equal(p.el("aoBandW").textContent, "AO NYC", "the band names the chapter the app is set to");
  assert.equal(p.el("aoBandP").textContent, "AO Matchday, set to AO NYC. Built by a member of AO Central New Jersey; not a product of American Outlaws national.");
  p.run("aoSetHome('middlesex-county')");
  assert.deepStrictEqual([p.el("aoBandW").textContent, p.el("aoBandP").textContent], ["AO Central New Jersey", "The matchday app of AO Central New Jersey."], "our own chapter gets the page's own words back");
});

test("ao page: a chapter link does not overwrite a chapter the person picked, and an unknown one changes nothing", async () => {
  const mine = await aoLinked("?x=1&chapter=nyc", { "ao.home": "seattle" });
  assert.match(mine.text("aoWatch"), /Your chapter · official watch party AO NYC/, "the link's chapter is shown for this visit");
  assert.equal(mine.store["ao.home"], "seattle", "but the saved choice stands");
  assert.ok(!mine.tracked.some(x => /chapter-link/.test(x)));

  for (const [search, storage, want] of [["?chapter=atlantis", undefined, "Central New Jersey"], ["?chapter=atlantis", { "ao.home": "seattle" }, "Seattle"],
    ["?chapter=%3Cscript%3E", undefined, "Central New Jersey"], ["?chapter=NYC", undefined, "Central New Jersey"], ["?mychapter=nyc", undefined, "Central New Jersey"], ["", { "ao.home": "gone-chapter" }, "Central New Jersey"]]) {
    const p = await aoLinked(search, storage);
    assert.match(p.text("aoChapters"), new RegExp("^Find your crew AO " + want + " · "), search + " should leave the app on AO " + want);
    assert.equal(p.store["ao.home"], storage && storage["ao.home"], search + " must not save anything");
  }
});

test("ao page: sharing a chapter's link, and the way to its sign", async () => {
  const p = await aoLinked("?chapter=nyc");
  const html = p.html("aoChapters");
  assert.match(html, /<a href="#" onclick="aoShare\(\);return false">Share this chapter's link<\/a>/);
  assert.match(html, /<a href="ao-sign\.html\?chapter=nyc">Print a sign for the bar<\/a>/);
  p.run("aoShare()");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.shared)), [{ title: "AO Matchday", text: "AO NYC on AO Matchday: when the USA plays and where we watch.", url: "http://test.local/wc2026/ao.html?chapter=nyc" }]);
  assert.ok(p.tracked.some(x => /ao-concept: share-chapter/.test(x)));

  // No share sheet (a desktop browser): the link is copied, and the page says so.
  const q = await boot({ hash: "#men" });
  q.run(AO_JS); await q.settle();
  q.run("var copiedText = null; navigator.clipboard = { writeText: t => { copiedText = t; return Promise.resolve(); } }; aoLoaded(" + JSON.stringify(LIST) + "); aoShare()");
  await q.settle();
  assert.equal(q.run("copiedText"), "http://test.local/wc2026/ao.html?chapter=middlesex-county");
  assert.match(q.text("aoChapters"), /Link copied/);
});

/* ── What the chapter's leaders wrote: notes on the watch party card, and the songbook ── */
const WRITTEN = { "middlesex-county": {
  notes: [{ text: "Members get $1 off drafts." }, { date: "2026-11-14", text: "Doors <b>at</b> 6 & we're \"upstairs\"" }, { date: "2026-11-18", text: "for another match" }, { text: "a third note" }],
  songs: [{ title: "I Believe", words: "I believe\nI believe that\n<i>we</i> will win!" }, { title: "U-S-A <img src=x>", words: "" }] },
  dothan: { notes: [{ text: "We are still looking for a bar. Message us." }], songs: [] } };
async function aoWritten(home, written) {
  const p = await boot({ hash: "#men" });
  p.run(AO_JS); await p.settle();
  p.run((home ? "AO.home = '" + home + "'; " : "") + "AO.notes = " + JSON.stringify(written === undefined ? WRITTEN : written) + "; aoLoaded(" + JSON.stringify(LIST) + ")");
  return p;
}

test("ao page: the leaders' note for this match shows on the watch party card, as plain text", async () => {
  const p = await aoWritten(), html = p.html("aoWatch"), t = p.text("aoWatch");
  assert.match(t, /Hailey's Harp & Pub 400 Main St, Metuchen, NJ From the chapter Doors &lt;b&gt;at&lt;\/b&gt; 6 & we're "upstairs" Members get \$1 off drafts\. 📍 Directions/, "the note for the match day first, then the standing one, above the buttons");
  assert.ok(!/<b>at<\/b>/.test(html), "what leaders type is never treated as markup");
  assert.ok(!/another match|third note/.test(t), "not another match's note, and two at most");
  assert.equal((html.match(/class="aonote"/g) || []).length, 2);
  assert.ok(html.indexOf('class="aonotes"') < html.indexOf('class="aoacts"') && html.indexOf('class="aonotes"') < html.indexOf("<details"), "inside the chapter's own block, not in the folded list");
});

test("ao page: when the leaders say a match has no official watch party, the card keeps the place and drops the word official", async () => {
  const say = notes => ({ "middlesex-county": { notes, songs: [] }, nyc: { notes: [{ date: "2026-11-14", official: false }], songs: [] } });
  const p = await aoWritten(null, say([{ date: "2026-11-14", text: "There is no official watch party due to the holiday weekend.", official: false }])), t = p.text("aoWatch");
  assert.match(t, /Your chapter AO Central New Jersey Hailey's Harp & Pub 400 Main St, Metuchen, NJ From the chapter There is no official watch party due to the holiday weekend\. 📍 Directions/, "the card, the place, the note and the buttons all stay");
  assert.ok(!/official watch party AO/.test(t), "the label is gone");
  assert.equal((p.html("aoWatch").match(/class="aonote"/g) || []).length, 1);

  const bare = await aoWritten(null, say([{ date: "2026-11-14", official: false }])), bt = bare.text("aoWatch");
  assert.match(bt, /Your chapter AO Central New Jersey Hailey's Harp & Pub/, "a no without a note still drops the label");
  assert.ok(!/From the chapter|undefined/.test(bt), "and draws no empty note");

  // Only that match's day, only a real `false`, and only the chapter that said it.
  for (const notes of [[{ date: "2026-11-15", text: "tomorrow's match", official: false }], [{ text: "no date", official: false }], [{ date: "2026-11-14", text: "x", official: "false" }],
    [{ date: "2026-11-14", text: "x", official: 0 }], [{ date: "2026-11-14", text: "x" }], [null, { date: 20261114, official: false }]]) {
    const q = await aoWritten(null, say(notes));
    assert.match(q.text("aoWatch"), /Your chapter · official watch party AO Central New Jersey/, JSON.stringify(notes));
  }
  const other = await aoWritten(null, { "middlesex-county": { notes: [], songs: [] }, nyc: { notes: [{ date: "2026-11-14", official: false }], songs: [] } });
  assert.match(other.text("aoWatch"), /Your chapter · official watch party AO Central New Jersey/, "another chapter's no does not touch ours");
});

test("ao page: a note belongs to the match's day in U.S. Eastern time", async () => {
  const p = await aoWritten();
  assert.equal(p.run("aoEtDay('2026-11-18T00:00Z')"), "2026-11-17", "a 7 PM Eastern kickoff is the next day in UTC");
  assert.equal(p.run("aoEtDay('2026-11-28T01:30Z')"), "2026-11-27");
  assert.equal(p.run("aoEtDay('2026-07-04T03:59Z')"), "2026-07-03"); assert.equal(p.run("aoEtDay('2026-07-04T04:00Z')"), "2026-07-04");
  assert.deepStrictEqual(JSON.parse(p.run("JSON.stringify(aoNotes({ date: '2026-11-19T00:30Z' }).map(n => n.text))")), ["for another match", "Members get $1 off drafts."]);
  assert.deepStrictEqual(JSON.parse(p.run("JSON.stringify(aoNotes({ date: '2026-12-25T20:00Z' }).map(n => n.text))")), ["Members get $1 off drafts.", "a third note"]);
});

test("ao page: notes are the chosen chapter's only, and show even before a place is posted", async () => {
  const nyc = await aoWritten("nyc");
  assert.ok(!/From the chapter/.test(nyc.text("aoWatch")), "another chapter's members do not see our notes");
  assert.ok(!/Songbook/.test(nyc.text("aoChapters")));
  const d = await aoWritten("dothan");
  assert.match(d.text("aoWatch"), /AO Dothan hasn't posted a watch party for this match yet\. From the chapter We are still looking for a bar\. Message us\./);
  assert.ok(!/Songbook/.test(d.text("aoChapters")), "no songs, no songbook");
});

test("ao page: the songbook is a folding section of the chapter's chants", async () => {
  const p = await aoWritten(), html = p.html("aoChapters");
  const book = html.split('<div class="card sec">')[2];
  assert.ok(book, "a second folding section under Find your crew");
  assert.match(book, /^<details  ontoggle="setOpen\('s\.songs',this\.open\)"><summary><span class="sh"><span class="st">Songbook<\/span><span class="ss">2 chants and songs from AO Central New Jersey<\/span>/, "closed until asked for, with a one-line preview");
  assert.match(book, /<details class="aosong"><summary>I Believe<\/summary><div class="aowords">I believe\nI believe that\n&lt;i&gt;we&lt;\/i&gt; will win!<\/div><\/details><details class="aosong"><summary>U-S-A &lt;img src=x&gt;<\/summary>/, "each chant folds; its name and words are plain text, and the words keep their lines");
  p.run("setOpen('s.songs', true)");
  assert.ok(p.tracked.some(x => /ao-concept: open-songs/.test(x)));
  const one = await aoWritten(null, { "middlesex-county": { notes: [], songs: [{ title: "Only", words: "one" }] } });
  assert.match(one.text("aoChapters"), /Songbook 1 chant from AO Central New Jersey/);
});

test("ao page: a notes file that is missing, empty or malformed draws nothing and breaks nothing", async () => {
  for (const written of [null, {}, { "middlesex-county": null }, { "middlesex-county": { notes: "x", songs: 7 } }, { "middlesex-county": { notes: [null, 5, { text: 9 }, { date: "2026-11-14" }], songs: [null, { title: 1, words: "w" }, "s"] } }, { toString: { notes: [{ text: "inherited name" }] } }]) {
    const p = await aoWritten(null, written), what = JSON.stringify(written);
    assert.match(p.text("aoWatch"), /Your chapter · official watch party AO Central New Jersey/, what);
    assert.ok(!/From the chapter|aonote/.test(p.html("aoWatch")), what);
    assert.match(p.text("aoChapters"), /^Find your crew/, what);
    assert.ok(!/Songbook/.test(p.text("aoChapters")), what);
  }
  const odd = await aoWritten("toString", { toString: { notes: [{ text: "x" }] } });
  assert.match(odd.text("aoChapters"), /^Find your crew AO Central New Jersey/, "a chapter name that is not a chapter falls back to ours");
});

/* ── Matches within driving distance of the chapter ── */
const { fixture: aoFixture, clone: aoClone } = require("./helpers/page.cjs");
const HARRISON = { lat: 40.7369, lng: -74.1503 }, FLORIDA = { lat: 26.1933, lng: -80.1606 };     // about 17 miles from Metuchen, and about 1,050
async function aoDrive(change, home) {
  const men = aoClone(aoFixture("data-men.json"));
  Object.assign(men.fixtures[1].vinfo, HARRISON); Object.assign(men.fixtures[2].vinfo, FLORIDA);     // Nov 18 v Haiti (home), Dec 13 v Jamaica (home)
  if (change) change(men);
  const p = await boot({ hash: "#men", data: { men } });
  p.run(AO_JS); await p.settle();
  assert.equal(p.run("fixtureNote({ ha: 'H', vinfo: { lat: 40.7, lng: -74.1 } })"), "", "before the chapter list arrives there is nothing to measure from, and nothing breaks");
  p.run((home ? "AO.home = '" + home + "'; " : "") + "aoLoaded(" + JSON.stringify(LIST) + ")");
  return p;
}
const nearRows = p => p.html("fixtures").split('<div class="m tap"').slice(1).map(r => r.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(r => /🚗/.test(r));

test("ao page: a home match within driving distance of the chapter is flagged in the calendar", async () => {
  const p = await aoDrive();
  const rows = nearRows(p);
  assert.equal(rows.length, 1, "the match near New Jersey, not the one in Florida");
  assert.match(rows[0], /vs Haiti .* 🚗 About 1[5-9] mi from your chapter/);
  assert.match(p.html("fixtures"), /<div class="aonear">🚗 About \d+ mi from your chapter<\/div>/);
  assert.equal(nearRows(await aoDrive(null, "seattle")).length, 0, "nothing is near Seattle");
  p.run("aoSetHome('seattle')");
  assert.equal(nearRows(p).length, 0, "changing chapter redraws the calendar");
  p.run("aoSetHome('nyc')");
  assert.match(nearRows(p)[0], /🚗 About \d mi from your chapter/);
});

test("ao page: only a home match with a known stadium position counts, out to about four hours' drive", async () => {
  const p = await aoDrive();
  const near = m => p.run("aoNear(" + JSON.stringify(m) + ")");
  assert.equal(near({ ha: "H", vinfo: HARRISON }) > 14 && near({ ha: "H", vinfo: HARRISON }) < 20, true);
  assert.equal(near({ ha: "A", vinfo: HARRISON }), null, "an away match is not a trip to suggest");
  for (const vinfo of [undefined, null, {}, { lat: "40.7", lng: "-74.1" }, { lat: 40.7 }, { lng: -74.1 }]) assert.equal(near({ ha: "H", vinfo }), null, JSON.stringify(vinfo));
  assert.equal(near({ ha: "H", vinfo: { lat: 40.54 + 3.6, lng: -74.36 } }), 249, "just inside 250 miles");
  assert.equal(near({ ha: "H", vinfo: { lat: 40.54 + 3.65, lng: -74.36 } }), null, "just outside");
  assert.equal(p.run("fixtureNote(" + JSON.stringify({ ha: "H", vinfo: { lat: 40.55, lng: -74.36 } }) + ")"), '<div class="aonear">🚗 In town</div>');
  p.run("AO.here = { lat: 39.0, lng: -77.0 }; renderAO()");
  assert.match(p.run("fixtureNote(" + JSON.stringify({ ha: "H", vinfo: HARRISON }) + ")"), /About 1\d\d mi from you</, "once location is shared, distance is from the person");
});

test("ao page: the watch party card says when the match itself is within reach", async () => {
  const far = await aoDrive();
  assert.ok(!/You could go/.test(far.text("aoWatch")), "the match on the card is away, in another country");
  const p = await aoDrive(men => { men.fixtures[0].ha = "H"; men.fixtures[0].venue = "Sports <Illustrated> Stadium"; Object.assign(men.fixtures[0].vinfo, HARRISON); });
  assert.match(p.text("aoWatch"), /🚗 You could go: Sports &lt;Illustrated&gt; Stadium is about 1[5-9] mi from your chapter\. /);
  assert.ok(p.html("aoWatch").indexOf("You could go") < p.html("aoWatch").indexOf('class="aohome"'), "above the chapter's own block");
});
