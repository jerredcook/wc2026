/* The whole app in a real browser: serve the site, open it in headless Chrome,
   and check that it boots and every section fills in from the committed data.
   This is the one test that exercises the real DOM, the script tags, the file
   paths and the redirect together. (It reads the page's structure, not its
   pixels: whether a rule in the stylesheet overrides [hidden] is checked in
   site.test.cjs.)

   It needs no packages: it uses whatever Chrome is installed (GitHub's runners
   have one) and is skipped where there is none. The live score feed may or may
   not be reachable from the test machine; nothing here depends on it. */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CHROME = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
  .find(p => p && fs.existsSync(p));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ics": "text/calendar" };
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let server, base;
test.before(async () => {
  if (!CHROME) return;
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(() => { if (server) server.close(); });

/* The page as the browser built it, with script source removed so the
   assertions only see what is on screen. Chrome must run asynchronously: the
   test's own web server lives in this process and has to keep answering. */
function chrome(url, ua) {
  return new Promise(resolve => {
    execFile(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--user-agent=" + (ua || ANDROID),
      "--window-size=1000,3400", "--virtual-time-budget=12000", "--dump-dom", url], { encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ stdout: stdout || "", note: String((err && err.message) || stderr || "").slice(0, 300) }));
  });
}
async function open(urlPath, ua) {
  let r = await chrome(base + urlPath, ua);
  if (r.stdout.length < 500) r = await chrome(base + urlPath, ua);   // one retry: a cold browser start can time out
  assert.ok(r.stdout.length > 500, "the browser produced no page: " + r.note);
  return r.stdout.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
}
const section = (dom, id) => { const i = dom.indexOf(`id="${id}"`); assert.ok(i >= 0, `#${id} is not in the page`); return dom.slice(i, i + 60000); };
const opts = { skip: CHROME ? false : "no Chrome on this machine", timeout: 240000 };

test("the app boots in a real browser and every section fills in", opts, async () => {
  const dom = await open("/");
  assert.ok(!dom.includes("couldn't be shown"), "a section failed to draw");
  assert.equal((dom.match(/class="nu ?(on)?"/g) || []).length, 2, "both team tiles are drawn");
  assert.ok(dom.indexOf("Women &middot; next") < dom.indexOf("Men &middot; next") || dom.indexOf("Women · next") < dom.indexOf("Men · next"), "women first");
  for (const [id, mark] of [["hero", "What is this match?"], ["fixtures", "every upcoming match"], ["pool", "player pool"], ["results", "results"], ["poll", "Cap Day"]]) {
    assert.ok(section(dom, id).includes(mark), `#${id} does not contain "${mark}"`);
  }
  assert.match(section(dom, "hero"), /class="cd"|LIVE|Full time/, "the match card shows a countdown, a live badge or a final score");
  assert.match(dom, /<div class="card iostip" id="iosTip" hidden="">/, "the iPhone tip stays hidden on Android");
});

test("an iPhone gets the Add to Home Screen tip", opts, async () => {
  const dom = await open("/", IPHONE);
  assert.match(dom, /<div class="card iostip" id="iosTip">/);
  assert.ok(dom.includes("Add to Home Screen"));
});

test("old links still land on the app, and the other pages load", opts, async () => {
  assert.ok((await open("/usa.html")).includes('id="nextup"'), "usa.html should redirect to the app");
  const wc = await open("/worldcup.html");
  assert.ok(wc.includes("World Cup") && wc.includes("Back to matchday"));
  assert.ok((await open("/privacy.html")).includes("What Cap Day does not do"));
});

/* ── Layout, measured in the browser (helpers/probe.html) ── */
async function probe(query) {
  const dom = await chrome(base + "/test/helpers/probe.html?" + query);
  const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom.stdout);
  assert.ok(m && m[1] !== "pending", "the layout probe did not finish: " + dom.note);
  const r = JSON.parse(m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
  assert.ok(!r.error, "the layout probe failed: " + r.error);
  return r;
}
function checkLayout(r) {
  assert.equal(r.pageOverflow, 0, "the page scrolls sideways");
  assert.deepEqual(r.offScreen, [], "something sticks out past the edge of the screen");
  assert.deepEqual(r.hiddenButShown, [], "something marked hidden is visible");
  assert.deepEqual(r.smallTargets, [], "a button is too small to tap comfortably (under 32px)");
  assert.deepEqual(r.unreachableRows, [], "a tappable row cannot be reached by keyboard or screen reader");
  assert.deepEqual(r.brokenLocalImages, [], "one of the app's own images is broken");
  assert.equal(r.unlabelledImages, 0, "an image has no alt text");
  assert.equal(r.notices, 0, "a section shows the failure notice");
  for (const [id, hgt] of Object.entries(r.sections)) assert.ok(hgt > 20, `#${id} is empty or missing (height ${hgt})`);
}
for (const w of [320, 360, 390, 768]) {
  test(`layout holds at ${w}px wide`, opts, async () => checkLayout(await probe("url=/&w=" + w)));
}
test("layout holds for the women's view", opts, async () => checkLayout(await probe("url=/%23women&w=360")));
/* The World Cup page keeps most of its sections collapsed: measure it as it opens, and again with everything opened. */
const WC_OPEN = "rs-body,bk-body,sy-body,sc-body,sg-body,nw-body", WC_ALL = WC_OPEN + ",st-body,rk-body,hx-body,th-body,fr-body,sd-body,cd-body";
test("World Cup page: layout holds as it opens on a small phone", opts, async () => checkLayout(await probe("url=/worldcup.html&w=360&sections=" + WC_OPEN)));
for (const w of [320, 360, 390, 768]) {
  test(`World Cup page: layout holds at ${w}px wide with every section opened`, opts, async () => checkLayout(await probe("url=/worldcup.html&w=" + w + "&expand=1&sections=" + WC_ALL)));
}
test("layout holds on a small phone with the 'newer version' and 'out of date' bars showing", opts, async () => {
  const r = await probe("url=/&w=320&notices=1");
  const bar = id => r.noticeBars.find(b => b.id === id);
  assert.ok(bar("update").shown, "the refresh offer is visible");
  assert.match(bar("update").text, /newer version of Cap Day is ready.*Refresh/);
  assert.ok(bar("stale").shown, "the out-of-date notice is visible");
  assert.match(bar("stale").text, /last checked 31 hours ago/);
  checkLayout(r);
});
test("layout holds with a live match on a small phone (timeline, stats, lineups open)", opts, async () => {
  const r = await probe("url=/&w=320&live=1");
  if (r.noMatch) return;   // nothing scheduled for either team: there is no card to put into a live state
  assert.match(r.state, /^Live now/);
  checkLayout(r);
});
